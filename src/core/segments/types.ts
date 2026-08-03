import type { LatLon, PathPoint } from '../geo';

/**
 * What the phone was doing during a move segment.
 *
 * `unknown` is a real answer, not a failure: a segment with too little
 * information to classify says so rather than guessing "walk" and being wrong
 * in the timeline forever.
 */
export type ActivityMode = 'walk' | 'run' | 'cycle' | 'drive' | 'unknown';

export const ACTIVITY_MODES: readonly ActivityMode[] = ['walk', 'run', 'cycle', 'drive', 'unknown'];

interface SegmentBase {
  /**
   * Derived from `startedAt`, never generated.
   *
   * The engine has no clock and no entropy source, so re-running it over the
   * same fixes produces byte-identical segments — which is what lets the app
   * fold the same buffer twice (after a crash, say) and merge the result into
   * the log by id without creating duplicates.
   */
  readonly id: string;
  /** Epoch ms of the first fix in the segment. */
  readonly startedAt: number;
  /** Epoch ms of the last fix in the segment. */
  readonly endedAt: number;
  /** How many accepted fixes went into it. Low counts mean a thin, less trustworthy segment. */
  readonly fixCount: number;
}

/** Somewhere you stayed put. */
export interface StaySegment extends SegmentBase {
  readonly kind: 'stay';
  /** Mean of the fixes — where to put the dot. */
  readonly center: LatLon;
  /**
   * How far the fixes wandered from the *first* one, in metres.
   *
   * From the anchor rather than the centre so it can be maintained in constant
   * space as fixes arrive. For a stay — metres of jitter over minutes — the two
   * differ by less than the accuracy of the readings that produced them.
   */
  readonly radiusM: number;
}

/** Somewhere you went. */
export interface MoveSegment extends SegmentBase {
  readonly kind: 'move';
  /** Ground distance actually travelled: the sum of the steps, not start-to-end. */
  readonly distanceM: number;
  readonly mode: ActivityMode;
  /**
   * Set when a manual recording window claimed this segment, and the reason
   * manual recording exists: the engine can tell a bike ride from a bus, but it
   * cannot know that this one was the commute.
   */
  readonly label: string | null;
  /** True when a manual window set `mode`, so the classifier must not overrule it. */
  readonly modeIsManual: boolean;
  /** Route, thinned to `pathResolutionM`. Always holds at least the two endpoints. */
  readonly path: readonly PathPoint[];
  /** Fastest step in the segment, derived from consecutive positions. */
  readonly topSpeedMps: number;
}

export type Segment = StaySegment | MoveSegment;

/** Average ground speed over a move segment, in m/s. Zero for a segment of no duration. */
export function averageSpeedMps(segment: MoveSegment): number {
  const durationMs = segment.endedAt - segment.startedAt;
  if (durationMs <= 0) return 0;
  return (segment.distanceM / durationMs) * 1000;
}

export function durationMs(segment: Segment): number {
  return segment.endedAt - segment.startedAt;
}
