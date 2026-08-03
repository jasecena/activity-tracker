import { pathLengthM, type PathPoint } from '../geo';

import { classifyMode } from './classify';
import type { ActivityMode, MoveSegment, Segment, StaySegment } from './types';

/**
 * A stretch of the day you claimed by hand.
 *
 * Manual recording does **not** open a second location subscription. That is
 * the whole design: there is one fix stream, always, and pressing Record
 * declares that this window of it is one named activity. Two subscriptions
 * would mean twice the battery, two answers to "how far did I walk", and a
 * genuinely unresolvable question about which one the day's totals should use.
 *
 * So a manual window is a *lens over the automatic timeline*, applied on read.
 * Nothing about the recorded fixes changes when you press the button, which is
 * also why you can stop a recording you forgot to start — the fixes were being
 * collected either way.
 */
export interface ManualWindow {
  readonly id: string;
  /** What you called it. The reason the feature exists — the engine can tell a ride from a drive, but not a commute from an errand. */
  readonly label: string;
  /** Your answer, which overrules the classifier for this window. */
  readonly mode: ActivityMode;
  readonly startedAt: number;
  /** null while the recording is still running. */
  readonly endedAt: number | null;
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
 * Collapse a run of segments into the single activity a manual window says they
 * were.
 *
 * Stays inside the window are swallowed rather than preserved. That is
 * deliberate: you pressed Record at the start of a walk, so the four minutes
 * waiting at the crossing are part of the walk. They still cost you the time —
 * the coalesced segment spans them — they just do not appear as a separate row
 * saying you stopped.
 */
function coalesce(inside: readonly Segment[], window: ManualWindow, from: number, to: number): MoveSegment {
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

  return {
    kind: 'move',
    // Namespaced by the window, not by the instant: a recording keeps its
    // identity while it is running, even as its end moves with the clock.
    id: `manual-${window.id}`,
    startedAt: from,
    endedAt: to,
    fixCount,
    distanceM: distance,
    mode: window.mode,
    label: window.label,
    modeIsManual: true,
    path,
    topSpeedMps: topSpeed,
  };
}

/**
 * Apply every manual recording to an automatic timeline.
 *
 * `now` closes any window that is still recording. Passing it in rather than
 * reading a clock is what keeps this testable and keeps `src/core` free of
 * ambient state — "what time is it" is an input here, everywhere.
 */
export function applyManualWindows(
  segments: readonly Segment[],
  windows: readonly ManualWindow[],
  now: number,
): readonly Segment[] {
  let result = [...segments];

  const ordered = [...windows].sort((a, b) => a.startedAt - b.startedAt);

  for (const window of ordered) {
    const to = window.endedAt ?? now;
    if (to <= window.startedAt) continue;

    result = splitAll(splitAll(result, window.startedAt), to);

    const inside = result.filter((segment) => segment.startedAt >= window.startedAt && segment.endedAt <= to);
    const outside = result.filter((segment) => !(segment.startedAt >= window.startedAt && segment.endedAt <= to));

    // No fixes at all for the window — location was denied, or the phone was
    // somewhere with no signal. The recording still happened and still gets a
    // row; an empty timeline after deliberately pressing Record reads as a bug.
    const from = inside[0]?.startedAt ?? window.startedAt;
    const until = inside[inside.length - 1]?.endedAt ?? to;

    result = [...outside, coalesce(inside, window, from, until)].sort((a, b) => a.startedAt - b.startedAt);
  }

  return result;
}
