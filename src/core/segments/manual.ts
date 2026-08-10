import { pathLengthM, type PathPoint } from '../geo';

import { classifyMode } from './classify';
import type { ActivityMode, MoveSegment, Segment, StaySegment } from './types';

/**
 * A journey you named.
 *
 * There is no Record button, and there never was anything to record: tracking
 * runs whenever it is on, every fix is stored, and the timeline is derived from
 * them. A label adds the two things the engine cannot work out for itself —
 * what this journey *was* ("the commute"), and which mode it was, where speed
 * alone cannot separate a slow cycle from a fast walk.
 *
 * **Naming is retrospective, and that is the whole design.** A label is made
 * *from* a journey that already exists, so it has both ends and always has
 * something behind it. The version this replaces wrote down an instant when you
 * pressed a button and left the other end open until you pressed another —
 * which let a label outlive its day, claim time that had not happened yet, and
 * put a row on a timeline it had nothing to do with. Those bugs are not fixed
 * here so much as made unrepresentable.
 *
 * Stored as a **time range**, not a segment id. Segments are re-derived from the
 * fix buffer whenever they are needed, and a different tracking preset folds the
 * same fixes into different journeys — so an id would be orphaned by a settings
 * change. A range is re-cut against whatever the day looks like now.
 */
export interface JourneyLabel {
  /**
   * Derived from `startedAt`, never generated — the same rule as segment ids,
   * so naming the same journey twice updates one label rather than making two.
   */
  readonly id: string;
  /**
   * What you called it, or empty.
   *
   * Empty is a real state, not a missing one: **a mode correction is nameless
   * by design.** Holding a journey and saying it was a cycle rather than a run
   * stores an opinion about the mode and nothing about the name, and the row
   * goes on reading as whatever the engine calls it. Naming it later fills this
   * in without creating a second label.
   */
  readonly label: string;
  /**
   * Your answer, which overrules the classifier for this stretch — or null to
   * let the classifier decide.
   *
   * Null is a real state too, and it is what taking a correction back leaves
   * behind on a journey that still has a name. The detected mode is never
   * stored, so removing the opinion is enough to get the classifier's answer
   * returned — there is nothing to restore.
   *
   * A label that is nameless *and* modeless says nothing at all, and
   * `saysSomething` drops it rather than letting it sit in the store as a row
   * with no content.
   */
  readonly mode: ActivityMode | null;
  readonly startedAt: number;
  readonly endedAt: number;
}

export function journeyLabelId(startedAt: number): string {
  return `j-${startedAt}`;
}

function isMove(segment: Segment): segment is MoveSegment {
  return segment.kind === 'move';
}

/**
 * Position along a path at an instant, linearly interpolated between the two
 * points either side.
 *
 * `before.at < at < after.at` strictly, guaranteed by the only caller, so the
 * span is never zero and this never divides by it.
 */
function interpolate(before: PathPoint, after: PathPoint, at: number): PathPoint {
  const fraction = (at - before.at) / (after.at - before.at);
  return {
    lat: before.lat + (after.lat - before.lat) * fraction,
    lon: before.lon + (after.lon - before.lon) * fraction,
    at,
    // The speed at the cut is the speed of the step being cut — the one that
    // arrived at `after`. Interpolating a speed between two samples would
    // invent a reading that was never taken.
    speedMps: after.speedMps,
  };
}

/**
 * A point at `at` to join two halves of a cut route.
 *
 * Null only when the segment had no route at all, which a segment coalesced
 * from a recording with no fixes behind it genuinely does.
 */
function boundaryPoint(before: readonly PathPoint[], after: readonly PathPoint[], at: number): PathPoint | null {
  const last = before[before.length - 1];
  const first = after[0];
  if (last && first) return interpolate(last, first, at);
  const only = last ?? first;
  return only ? { ...only, at } : null;
}

function moveFrom(base: Omit<MoveSegment, 'kind' | 'id' | 'mode'> & { readonly mode?: ActivityMode }): MoveSegment {
  return {
    kind: 'move',
    id: `seg-${base.startedAt}`,
    startedAt: base.startedAt,
    endedAt: base.endedAt,
    fixCount: base.fixCount,
    distanceM: base.distanceM,
    mode:
      base.mode ??
      classifyMode({
        distanceM: base.distanceM,
        durationMs: base.endedAt - base.startedAt,
        topSpeedMps: base.topSpeedMps,
      }),
    label: base.label,
    modeIsManual: base.modeIsManual,
    path: base.path,
    topSpeedMps: base.topSpeedMps,
  };
}

/**
 * Cut a segment in two at an instant.
 *
 * Returns the segment untouched if the instant is at or outside its bounds, so
 * callers can split at every window edge without checking first.
 *
 * The distance of a split move is **apportioned**, not recomputed. Recomputing
 * each half from its own points would lose whatever the thinning dropped, and
 * the two halves would sum to less than the original — so a day's total would
 * shrink every time you labelled part of it, which is a genuinely confusing
 * thing for an app to do. Splitting therefore preserves total distance by
 * construction, and the split point's share is decided by the shape that
 * survives in the path.
 */
export function splitSegment(segment: Segment, at: number): readonly Segment[] {
  if (at <= segment.startedAt || at >= segment.endedAt) return [segment];

  if (segment.kind === 'stay') {
    const first: StaySegment = { ...segment, id: `seg-${segment.startedAt}`, endedAt: at };
    const second: StaySegment = { ...segment, id: `seg-${at}`, startedAt: at };
    return [first, second];
  }

  const before = segment.path.filter((point) => point.at < at);
  const after = segment.path.filter((point) => point.at > at);

  // Both halves need a point at the cut, or the two routes have a gap between
  // them exactly as wide as one sample. A route thinned to 25 m usually has no
  // sample at the instant asked for, so one is synthesised.
  const boundary = segment.path.find((point) => point.at === at) ?? boundaryPoint(before, after, at);
  if (boundary) {
    before.push(boundary);
    after.unshift(boundary);
  }

  const beforeLength = pathLengthM(before);
  const afterLength = pathLengthM(after);
  const totalLength = beforeLength + afterLength;
  // A route with no length to apportion — a segment coalesced from a recording
  // that caught no fixes — falls back to splitting by time instead.
  const share =
    totalLength > 0 ? beforeLength / totalLength : (at - segment.startedAt) / (segment.endedAt - segment.startedAt);

  const totalMs = segment.endedAt - segment.startedAt;
  const beforeFixes = Math.max(1, Math.round((segment.fixCount * (at - segment.startedAt)) / totalMs));

  return [
    moveFrom({
      startedAt: segment.startedAt,
      endedAt: at,
      fixCount: beforeFixes,
      distanceM: segment.distanceM * share,
      label: segment.label,
      modeIsManual: segment.modeIsManual,
      mode: segment.modeIsManual ? segment.mode : undefined,
      path: before,
      // Kept on both halves: the fastest step happened in one of them, and
      // which one is not recoverable from a thinned path. Over-reporting a peak
      // on one half is the safer error — under-reporting would let a split
      // reclassify a drive as a cycle.
      topSpeedMps: segment.topSpeedMps,
    }),
    moveFrom({
      startedAt: at,
      endedAt: segment.endedAt,
      fixCount: Math.max(1, segment.fixCount - beforeFixes),
      distanceM: segment.distanceM * (1 - share),
      label: segment.label,
      modeIsManual: segment.modeIsManual,
      mode: segment.modeIsManual ? segment.mode : undefined,
      path: after,
      topSpeedMps: segment.topSpeedMps,
    }),
  ];
}

/** Everything in `segments`, cut at `at`. */
function splitAll(segments: readonly Segment[], at: number): Segment[] {
  return segments.flatMap((segment) => splitSegment(segment, at));
}

/**
 * The id of the segment a label produces.
 *
 * Namespaced by the label rather than by an instant, so the UI can find the row
 * a name produced without re-deriving anything: `applyJourneyLabels` emits at
 * most one segment per label.
 */
export function labelledSegmentId(label: JourneyLabel): string {
  return `named-${label.id}`;
}

function coalesce(inside: readonly Segment[], label: JourneyLabel, from: number, to: number): MoveSegment {
  const path: PathPoint[] = [];
  let distance = 0;
  let fixCount = 0;
  let topSpeed = 0;

  for (const segment of inside) {
    fixCount += segment.fixCount;
    if (isMove(segment)) {
      distance += segment.distanceM;
      topSpeed = Math.max(topSpeed, segment.topSpeedMps);
      path.push(...segment.path);
    } else {
      // A stay contributes where it was, once, so the route does not jump
      // straight across the pause. Its speed is zero by definition.
      path.push({ ...segment.center, at: segment.startedAt, speedMps: 0 });
    }
  }

  const name = label.label.trim();

  return {
    kind: 'move',
    id: labelledSegmentId(label),
    startedAt: from,
    endedAt: to,
    fixCount,
    distanceM: distance,
    // No opinion stored means the classifier still owns this row — a name on
    // its own says what the journey was, never what kind of journey it was.
    mode: label.mode ?? classifyMode({ distanceM: distance, durationMs: to - from, topSpeedMps: topSpeed }),
    label: name.length > 0 ? name : null,
    modeIsManual: label.mode !== null,
    path,
    topSpeedMps: topSpeed,
  };
}

/**
 * Apply every name to an automatic timeline.
 *
 * No clock. A label has both ends, so there is nothing here that depends on
 * what time it is now — which is why this can be applied to any day, live or
 * frozen, and give the same answer.
 *
 * **A label covering no segments emits nothing.** That is the rule the reported
 * bug reduces to: the old version invented a row from the window's own bounds
 * whenever it found nothing inside, so a name from one day printed a hollow row
 * on every day after it, at a clock time that had not arrived. A label is made
 * from a journey, so finding nothing means the journey is gone — the fixes were
 * pruned, or a new preset folded them differently. The honest response to that
 * is silence, not a fabricated row.
 */
export function applyJourneyLabels(segments: readonly Segment[], labels: readonly JourneyLabel[]): readonly Segment[] {
  let result = [...segments];

  const ordered = [...labels].sort((a, b) => a.startedAt - b.startedAt);

  for (const label of ordered) {
    if (label.endedAt <= label.startedAt) continue;

    result = splitAll(splitAll(result, label.startedAt), label.endedAt);

    const covered = (segment: Segment) => segment.startedAt >= label.startedAt && segment.endedAt <= label.endedAt;
    const inside = result.filter(covered);
    if (inside.length === 0) continue;

    const outside = result.filter((segment) => !covered(segment));
    // Non-empty by the guard above, so these are assertions for
    // `noUncheckedIndexedAccess` rather than fallbacks that can fire. The
    // label's own bounds are deliberately *not* used as a backstop: inventing a
    // row from them when nothing was covered is the bug this design removes.
    const first = inside[0] as Segment;
    const last = inside[inside.length - 1] as Segment;

    result = [...outside, coalesce(inside, label, first.startedAt, last.endedAt)].sort(
      (a, b) => a.startedAt - b.startedAt,
    );
  }

  return result;
}
