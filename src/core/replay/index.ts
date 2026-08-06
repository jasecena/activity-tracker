import type { LatLon } from '../geo';
import type { Segment } from '../segments';

/**
 * Playing a day back.
 *
 * The timeline says *what* happened and in what order. Replay answers a
 * different question — "where was I at twenty past two" — and it answers it the
 * same way everything else in this app does: by re-deriving it from what is
 * already stored, holding nothing of its own.
 *
 * **The one rule that matters here is that a gap stays a hole.** The
 * segmenter closes whatever is open when the fixes stop, and the reason is in
 * `docs/ARCHITECTURE.md` §2: drawing a straight line across two hours indoors
 * turns a building into a four-kilometre walk through it. A player is where
 * that temptation is strongest, because a moving icon that stops dead looks
 * like a bug and a gliding one looks correct. So `positionAt` returns **null**
 * across a hole, and the screen says so out loud.
 *
 * No clock and no timezone, like the rest of `core`: "when" is a parameter.
 */

/** Where the day was at one instant, and what it was doing. */
export interface Position extends LatLon {
  readonly at: number;
  /** Metres per second, or null where nothing was moving and nothing was measured. */
  readonly speedMps: number | null;
  /** Which timeline row this instant belongs to, for the readout beside the map. */
  readonly segmentId: string;
  readonly kind: 'stay' | 'move';
}

/**
 * A point on the track. Identical to a `Position` — a position is simply one of
 * these, either stored or interpolated between two of them.
 */
type TrackPoint = Position;

export interface Track {
  /** Strictly increasing in `at`. Empty for a day with nothing in it. */
  readonly points: readonly TrackPoint[];
  readonly from: number;
  readonly to: number;
}

/** A day with nothing in it. Every field of a `Track` that has no points. */
const EMPTY_TRACK: Track = { points: [], from: 0, to: 0 };

/**
 * Flatten a day into one ordered path through time.
 *
 * A move contributes its stored route. A stay contributes its centre **twice** —
 * once when it began and once when it ended — which is what makes the icon sit
 * still for the two hours you were in the café rather than teleporting from the
 * arrival to the departure at the moment the next journey starts.
 *
 * Duplicate instants are **kept**, and that is load-bearing. The timeline is
 * contiguous by design — a segment ends exactly where the next begins, and the
 * fix at the transition belongs to both — so every boundary produces two points
 * stamped the same moment. Dropping one would leave the last point of the old
 * segment sitting next to the *second* point of the new one, separated by real
 * time, which is precisely the shape `positionAt` reads as a hole. The timeline
 * would then sprout a gap at every change of activity.
 *
 * Points that go *backwards* are dropped, which nothing should produce and
 * everything should survive.
 */
export function buildTrack(segments: readonly Segment[]): Track {
  const ordered = [...segments].sort((a, b) => a.startedAt - b.startedAt);
  const points: TrackPoint[] = [];

  const push = (point: TrackPoint) => {
    const last = points[points.length - 1];
    if (last && point.at < last.at) return;
    points.push(point);
  };

  for (const segment of ordered) {
    if (segment.kind === 'stay') {
      const { lat, lon } = segment.center;
      push({ lat, lon, at: segment.startedAt, speedMps: 0, segmentId: segment.id, kind: 'stay' });
      push({ lat, lon, at: segment.endedAt, speedMps: 0, segmentId: segment.id, kind: 'stay' });
      continue;
    }

    for (const point of segment.path) {
      push({
        lat: point.lat,
        lon: point.lon,
        at: point.at,
        speedMps: point.speedMps,
        segmentId: segment.id,
        kind: 'move',
      });
    }
  }

  const first = points[0];
  const last = points[points.length - 1];
  if (!first || !last) return EMPTY_TRACK;

  return { points, from: first.at, to: last.at };
}

/**
 * The index of the **last** point at or before `at`.
 *
 * Binary search rather than a scan: the player asks this many times a second,
 * and a day thinned to a point every 25 m is still thousands of them.
 *
 * *Last*, not first, matters at a boundary: the two points stamped the same
 * instant belong to the segment ending and the segment starting, and the useful
 * answer for "what am I doing now" is the one that is starting.
 *
 * Requires a non-empty list and `at >= points[0].at`, which is the only way
 * `positionAt` calls it — hence a plain 0 rather than a not-found sentinel.
 */
function indexAtOrBefore(points: readonly TrackPoint[], at: number): number {
  let low = 0;
  let high = points.length - 1;
  let found = 0;

  while (low <= high) {
    const middle = (low + high) >> 1;
    // `middle` is inside [low, high] ⊆ [0, length), so this is always a point.
    // The assertion is what `noUncheckedIndexedAccess` asks for; there is no
    // runtime case behind it.
    const point = points[middle] as TrackPoint;
    if (point.at <= at) {
      found = middle;
      low = middle + 1;
    } else {
      high = middle - 1;
    }
  }

  return found;
}

/**
 * Where the day was at `at`, or null if it does not know.
 *
 * Null has three causes and the screen treats them alike, because there is
 * nothing else to say about any of them: before the first fix, after the last,
 * and — the one that matters — inside a hole where the fixes stopped.
 *
 * A hole is detected structurally rather than by a threshold: the timeline is
 * contiguous, so two *consecutive* points that belong to different segments and
 * are separated by real time can only mean the segmenter closed one and opened
 * the next with nothing in between. There is no `gapMs` to pass in and no
 * chance of this disagreeing with the config the day was folded under.
 * Interpolating *within* a segment is always legitimate — that is a route that
 * was actually recorded, thinned to `pathResolutionM`.
 */
export function positionAt(track: Track, at: number): Position | null {
  const { points } = track;
  if (points.length === 0 || at < track.from || at > track.to) return null;

  // `at` is inside the span, so there is always a point at or before it, and —
  // unless it landed exactly on one — always one after. Both assertions below
  // are what `noUncheckedIndexedAccess` asks for rather than cases that happen.
  const index = indexAtOrBefore(points, at);
  const before = points[index] as TrackPoint;
  if (before.at === at) return before;

  const after = points[index + 1] as TrackPoint;

  // The hole. Nothing was recorded here, and a straight line across it would be
  // a journey that never happened.
  if (after.segmentId !== before.segmentId) return null;

  const fraction = (at - before.at) / (after.at - before.at);
  return {
    lat: before.lat + (after.lat - before.lat) * fraction,
    lon: before.lon + (after.lon - before.lon) * fraction,
    at,
    // The speed of the step being taken, not a blend of two samples — the same
    // rule `splitSegment` follows, and for the same reason: a blended speed is
    // a reading nobody ever took.
    speedMps: after.speedMps,
    segmentId: before.segmentId,
    kind: before.kind,
  };
}

/** First and last instant a day has anything to show, or null for an empty one. */
export function replaySpan(segments: readonly Segment[]): { readonly from: number; readonly to: number } | null {
  let from = Infinity;
  let to = -Infinity;

  for (const segment of segments) {
    if (segment.startedAt < from) from = segment.startedAt;
    if (segment.endedAt > to) to = segment.endedAt;
  }

  if (!Number.isFinite(from) || !Number.isFinite(to)) return null;
  return { from, to };
}

/**
 * Every stretch of the span where the app has nothing.
 *
 * Drawn as breaks under the scrubber, so a day is honest about what it does not
 * know before you scrub into the middle of it and find the icon gone.
 */
export function holesIn(track: Track): readonly { readonly from: number; readonly to: number }[] {
  const holes: { from: number; to: number }[] = [];
  let before: TrackPoint | null = null;

  for (const after of track.points) {
    // Positive duration required. A contiguous boundary is two points stamped
    // the same instant with different ids, which is a change of activity, not
    // an absence of information.
    if (before && after.segmentId !== before.segmentId && after.at > before.at) {
      holes.push({ from: before.at, to: after.at });
    }
    before = after;
  }

  return holes;
}
