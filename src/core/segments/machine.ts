import { distanceM, judgeFix, type Fix, type LatLon, type PathPoint, type RejectionReason } from '../geo';

import { classifyMode } from './classify';
import type { SegmentConfig } from './config';
import type { MoveSegment, Segment, StaySegment } from './types';

/**
 * The segmenter: a stream of fixes in, a timeline of stays and moves out.
 *
 * Three properties hold, and everything else in the app is built on them.
 *
 * **It is a fold.** `(state, fix) => state`. No clock is read, no random number
 * is drawn, no I/O happens. Folding the same fixes twice produces byte-identical
 * segments, right down to the ids — which is what lets the app throw its
 * derived timeline away and rebuild it from the fix buffer whenever it likes,
 * rather than carefully migrating a persisted machine state that could be a
 * version behind or half-written by a crash. Recomputing is the recovery story.
 *
 * **The timeline is contiguous.** A segment ends at exactly the instant the
 * next one starts, because the fix at a transition belongs to both: it is the
 * last of the old and the first of the new. Without that, every change of
 * activity leaves a hole a few seconds wide, and a day of errands adds up to
 * minutes that are unaccounted for.
 *
 * **Short segments are absorbed, never emitted.** Deciding "moving" from
 * "still" on a single step is noisy — one 3 m jitter at a desk looks like a
 * walk. Rather than smoothing the input, the machine lets the flip happen and
 * then, when the segment closes, checks whether it earned its place. If it did
 * not, it is merged back into the segment before it. This is why the machine
 * holds one closed-but-unemitted segment (`pending`): the merge target has to
 * still be reachable when the verdict arrives.
 */

interface OpenSegment {
  readonly kind: 'move' | 'stay';
  readonly startedAt: number;
  readonly endedAt: number;
  /** The boundary fix is counted by both the segment it ends and the one it starts. */
  readonly fixCount: number;
  readonly distanceM: number;
  readonly topSpeedMps: number;
  /** Thinned route. Also kept for stays, so a stay absorbed into a move contributes its shape. */
  readonly path: readonly PathPoint[];
  /** First point. `radiusM` is measured from here, which makes it maintainable in constant space. */
  readonly anchor: LatLon;
  readonly radiusM: number;
  readonly sumLat: number;
  readonly sumLon: number;
  /** Last point actually stored in `path`, for the resolution test. */
  readonly lastKept: PathPoint;
  /** Last point seen, kept or not. Where the segment actually ends. */
  readonly lastPoint: PathPoint;
}

const NO_REJECTIONS: Readonly<Record<RejectionReason, number>> = {
  inaccurate: 0,
  'out-of-order': 0,
  'too-soon': 0,
  teleport: 0,
  malformed: 0,
};

export interface SegmenterState {
  /** Closed, but still a candidate to absorb `open` if `open` turns out to be noise. */
  readonly pending: OpenSegment | null;
  readonly open: OpenSegment | null;
  /** The last *accepted* fix. Never a rejected one — see `judgeFix`. */
  readonly lastFix: Fix | null;
  /** Why fixes were dropped, for the diagnostics the Settings screen shows. */
  readonly rejected: Readonly<Record<RejectionReason, number>>;
}

export interface IngestResult {
  readonly state: SegmenterState;
  /** Segments that became final as a result of this fix. Usually empty. */
  readonly emitted: readonly Segment[];
}

export function initialSegmenter(): SegmenterState {
  return { pending: null, open: null, lastFix: null, rejected: NO_REJECTIONS };
}

function pointOf(fix: Fix, speedMps: number | null): PathPoint {
  return { lat: fix.lat, lon: fix.lon, at: fix.at, speedMps };
}

function startOpen(kind: 'move' | 'stay', from: Fix): OpenSegment {
  // No step arrived at the first point, so there is no speed to record for it.
  const point = pointOf(from, null);
  return {
    kind,
    startedAt: from.at,
    endedAt: from.at,
    fixCount: 1,
    distanceM: 0,
    topSpeedMps: 0,
    path: [point],
    anchor: point,
    radiusM: 0,
    sumLat: from.lat,
    sumLon: from.lon,
    lastKept: point,
    lastPoint: point,
  };
}

function extend(open: OpenSegment, fix: Fix, stepM: number, speedMps: number, config: SegmentConfig): OpenSegment {
  const point = pointOf(fix, speedMps);
  const keep = distanceM(open.lastKept, point) >= config.pathResolutionM;
  return {
    kind: open.kind,
    startedAt: open.startedAt,
    endedAt: fix.at,
    fixCount: open.fixCount + 1,
    distanceM: open.distanceM + stepM,
    topSpeedMps: Math.max(open.topSpeedMps, speedMps),
    path: keep ? [...open.path, point] : open.path,
    anchor: open.anchor,
    radiusM: Math.max(open.radiusM, distanceM(open.anchor, point)),
    sumLat: open.sumLat + fix.lat,
    sumLon: open.sumLon + fix.lon,
    lastKept: keep ? point : open.lastKept,
    lastPoint: point,
  };
}

/**
 * Fold `later` into `earlier`, keeping `earlier`'s kind.
 *
 * Used when a segment failed its minimum: it did not happen as far as the
 * timeline is concerned, but its time and its metres still did, and losing them
 * would make the day's totals quietly wrong.
 */
function merge(earlier: OpenSegment, later: OpenSegment): OpenSegment {
  // The boundary point opens `later` and may also have been the last one kept
  // in `earlier`. Dropping the repeat keeps a merged route from acquiring a
  // zero-length step at every join.
  const laterPath = later.path[0]?.at === earlier.lastKept.at ? later.path.slice(1) : later.path;

  // The same boundary fix, for the running total that produces the centre.
  //
  // `fixCount` has always subtracted it. The sums did not, so every merge added
  // one extra copy of the boundary point and the centre came out as the true
  // mean scaled by (n+merges)/n. At the origin — where every fixture in this
  // suite lives, deliberately — that error is zero times something and
  // invisible. On a real phone it put a stay in the Macedon Ranges half way out
  // into the Tasman Sea, 800 km from any reading behind it.
  const boundary = later.path[0];

  return {
    kind: earlier.kind,
    startedAt: earlier.startedAt,
    endedAt: later.endedAt,
    // The boundary fix is in both counts; subtracting it keeps the total honest.
    fixCount: earlier.fixCount + later.fixCount - 1,
    distanceM: earlier.distanceM + later.distanceM,
    topSpeedMps: Math.max(earlier.topSpeedMps, later.topSpeedMps),
    // Both are already thinned. The join may be closer than the resolution;
    // that costs one extra point per merge and keeps the shape honest.
    path: [...earlier.path, ...laterPath],
    anchor: earlier.anchor,
    // An upper bound rather than a recomputation, which would need every fix.
    radiusM: Math.max(earlier.radiusM, distanceM(earlier.anchor, later.anchor) + later.radiusM),
    sumLat: earlier.sumLat + later.sumLat - (boundary?.lat ?? 0),
    sumLon: earlier.sumLon + later.sumLon - (boundary?.lon ?? 0),
    lastKept: later.lastKept,
    lastPoint: later.lastPoint,
  };
}

/** Did this segment earn a place in the timeline, or is it noise to fold away? */
function isSubstantial(open: OpenSegment, config: SegmentConfig): boolean {
  const elapsed = open.endedAt - open.startedAt;
  if (open.kind === 'stay') return elapsed >= config.minStayMs;
  // Both, not either. A 200 m stretch covered in 10 s is a bad fix that slipped
  // the speed filter; 40 m of wandering over 5 minutes is a desk.
  return open.distanceM >= config.minMoveDistanceM && elapsed >= config.minMoveMs;
}

function finalize(open: OpenSegment): Segment {
  // Derived, not generated: see the note on `Segment.id`.
  const id = `seg-${open.startedAt}`;

  if (open.kind === 'stay') {
    const stay: StaySegment = {
      kind: 'stay',
      id,
      startedAt: open.startedAt,
      endedAt: open.endedAt,
      fixCount: open.fixCount,
      center: { lat: open.sumLat / open.fixCount, lon: open.sumLon / open.fixCount },
      radiusM: open.radiusM,
    };
    return stay;
  }

  // The final position is always worth storing even when it is closer than the
  // resolution: without it a route ends wherever the last kept point happened
  // to fall, up to `pathResolutionM` short of where you actually stopped.
  const path = open.lastKept.at === open.endedAt ? open.path : [...open.path, open.lastPoint];
  const move: MoveSegment = {
    kind: 'move',
    id,
    startedAt: open.startedAt,
    endedAt: open.endedAt,
    fixCount: open.fixCount,
    distanceM: open.distanceM,
    mode: classifyMode({
      distanceM: open.distanceM,
      durationMs: open.endedAt - open.startedAt,
      topSpeedMps: open.topSpeedMps,
    }),
    label: null,
    modeIsManual: false,
    path,
    topSpeedMps: open.topSpeedMps,
  };
  return move;
}

/**
 * Close everything the machine is holding.
 *
 * Called at the end of a fold. The last segment it returns is **provisional**
 * while the day is still running — more fixes will extend it, and the next fold
 * will produce a longer one with the same id. That is exactly why ids are
 * derived from `startedAt`: the provisional segment and its final form are the
 * same row, not two.
 */
export function closeOut(state: SegmenterState, config: SegmentConfig): readonly Segment[] {
  const { pending, open } = state;
  // `open` is null only before the first accepted fix, when `pending` is too.
  if (!open) return [];

  if (isSubstantial(open, config)) {
    return pending ? [finalize(pending), finalize(open)] : [finalize(open)];
  }
  if (pending) return [finalize(merge(pending, open))];
  // Too small to stand alone and nothing to fold it into. Emitted anyway: it is
  // the only record that this stretch of the day happened at all, and a
  // timeline with a hole in it is worse than one with a short row.
  return [finalize(open)];
}

function bumpRejection(
  rejected: Readonly<Record<RejectionReason, number>>,
  reason: RejectionReason,
): Readonly<Record<RejectionReason, number>> {
  return { ...rejected, [reason]: rejected[reason] + 1 };
}

/** Feed one fix to the machine. */
export function ingest(state: SegmenterState, fix: Fix, config: SegmentConfig): IngestResult {
  const verdict = judgeFix(state.lastFix, fix, config);
  if (!verdict.ok) {
    return { state: { ...state, rejected: bumpRejection(state.rejected, verdict.reason) }, emitted: [] };
  }

  const previous = state.lastFix;

  // First fix of a run of data. One point cannot be moving, so it opens a stay;
  // if the next steps disagree, the stay is too short to be substantial and
  // gets reinterpreted, keeping its start instant.
  if (previous === null || state.open === null) {
    return { state: { ...state, open: startOpen('stay', fix), lastFix: fix }, emitted: [] };
  }

  const elapsedMs = fix.at - previous.at;

  // A gap means we do not know what happened, and the machine must not pretend
  // otherwise. Everything open is closed at the last fix we actually had, and
  // the timeline simply has a hole in it until the next one.
  if (elapsedMs > config.gapMs) {
    const emitted = closeOut(state, config);
    return {
      state: { pending: null, open: startOpen('stay', fix), lastFix: fix, rejected: state.rejected },
      emitted,
    };
  }

  const stepM = distanceM(previous, fix);
  const speedMps = (stepM / elapsedMs) * 1000;
  const kind = speedMps >= config.stillSpeedMps ? 'move' : 'stay';

  if (state.open.kind === kind) {
    return {
      state: { ...state, open: extend(state.open, fix, stepM, speedMps, config), lastFix: fix },
      emitted: [],
    };
  }

  // --- The activity changed. -------------------------------------------
  const closing = state.open;
  const emitted: Segment[] = [];
  let pending = state.pending;
  let open: OpenSegment;

  if (isSubstantial(closing, config)) {
    // It stands. Whatever was pending is now settled behind it and can go.
    if (pending) emitted.push(finalize(pending));
    pending = closing;
    // The boundary fix starts the new segment, so nothing falls between them.
    open = startOpen(kind, previous);
  } else if (pending) {
    // Noise. Fold it back into what came before — which is necessarily of the
    // kind we are switching to, because kinds alternate — and carry on there.
    open = merge(pending, closing);
    pending = null;
  } else {
    // Noise with nothing behind it: reinterpret it as the segment it turned
    // into, keeping its start instant so no time is lost from the day.
    open = { ...closing, kind };
  }

  return {
    state: { pending, open: extend(open, fix, stepM, speedMps, config), lastFix: fix, rejected: state.rejected },
    emitted,
  };
}

/** Feed many fixes, in order. */
export function ingestAll(state: SegmenterState, fixes: readonly Fix[], config: SegmentConfig): IngestResult {
  let current = state;
  const emitted: Segment[] = [];
  for (const fix of fixes) {
    const result = ingest(current, fix, config);
    current = result.state;
    emitted.push(...result.emitted);
  }
  return { state: current, emitted };
}

export interface SegmentationResult {
  readonly segments: readonly Segment[];
  readonly rejected: Readonly<Record<RejectionReason, number>>;
}

/**
 * The whole engine in one call: fixes in, timeline out.
 *
 * This — not the incremental `ingest` — is what the app uses. It re-derives the
 * day from the fix buffer every time it needs it, which is cheap (a day is a
 * few thousand fixes) and removes an entire category of bug: there is no
 * long-lived machine state to persist, version, migrate or find corrupted.
 */
export function segmentFixes(fixes: readonly Fix[], config: SegmentConfig): SegmentationResult {
  const { state, emitted } = ingestAll(initialSegmenter(), fixes, config);
  // Both halves: `emitted` holds everything a gap or a transition finalised
  // along the way, `closeOut` whatever the machine is still holding at the end.
  return { segments: [...emitted, ...closeOut(state, config)], rejected: state.rejected };
}

/** Where the phone last was, if the fold saw anything at all. Used for the live header. */
export function lastKnownPosition(state: SegmenterState): LatLon | null {
  return state.lastFix ? { lat: state.lastFix.lat, lon: state.lastFix.lon } : null;
}
