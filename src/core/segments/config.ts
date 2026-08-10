import type { FixFilterConfig } from '../geo';

/**
 * Every threshold the segmenter uses, in one place.
 *
 * These are the knobs that decide what your day looks like, so they are data
 * rather than constants buried in the machine — a test can hand the engine a
 * config that makes a scenario reproducible in three fixes instead of three
 * hundred.
 */
export interface SegmentConfig extends FixFilterConfig {
  /**
   * Below this derived ground speed, the phone counts as standing still.
   *
   * 0.5 m/s is 1.8 km/h — slower than an amble, faster than the metre-or-two of
   * jitter a stationary phone produces every few seconds even with a clear sky.
   * Set it much lower and every desk becomes a series of tiny walks.
   */
  readonly stillSpeedMps: number;
  /**
   * How long you must stand still before it counts as having stopped, rather
   * than as a pause within a journey.
   *
   * Three minutes clears a red light and a level crossing. Below about ninety
   * seconds a single commute shatters into a dozen drives.
   */
  readonly minStayMs: number;
  /** A move shorter than this is jitter, and gets folded back into the stay around it. */
  readonly minMoveDistanceM: number;
  /** ...and it must also have lasted this long. Both, not either. */
  readonly minMoveMs: number;
  /**
   * No fix for this long ends whatever was open.
   *
   * The gap is then left as a hole in the timeline. It is never bridged: the
   * app has no idea what happened during it, and drawing a straight line from
   * the fix before to the fix after turns two hours in a building into a
   * four-kilometre walk through it.
   */
  readonly gapMs: number;
  /** Points closer together than this are dropped from a stored route. */
  readonly pathResolutionM: number;
}

export const DEFAULT_SEGMENT_CONFIG: SegmentConfig = {
  stillSpeedMps: 0.5,
  minStayMs: 3 * 60_000,
  minMoveDistanceM: 60,
  minMoveMs: 45_000,
  gapMs: 15 * 60_000,
  pathResolutionM: 25,
  // 60 m is generous enough to keep street-level GPS in a city and strict
  // enough to drop everything Wi-Fi positioning produces indoors.
  maxAccuracyM: 60,
  // 90 m/s is 324 km/h. Above a high-speed train, below every teleport.
  maxSpeedMps: 90,
  minIntervalMs: 1_000,
};

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

/**
 * The trust boundary for the config.
 *
 * Anything read back from storage passes through here first. It was written by
 * an older build with different fields, or truncated by a crash mid-write, and
 * a `stillSpeedMps` of `null` propagates as NaN through every comparison in the
 * machine — where `NaN >= x` is false, so every fix in the day is classified as
 * still and the timeline is simply empty. Silently.
 */
export function normalizeSegmentConfig(input: unknown): SegmentConfig {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Partial<Record<string, unknown>>;
  const fallback = DEFAULT_SEGMENT_CONFIG;
  return {
    stillSpeedMps: positiveNumber(source.stillSpeedMps, fallback.stillSpeedMps),
    minStayMs: positiveNumber(source.minStayMs, fallback.minStayMs),
    minMoveDistanceM: positiveNumber(source.minMoveDistanceM, fallback.minMoveDistanceM),
    minMoveMs: positiveNumber(source.minMoveMs, fallback.minMoveMs),
    gapMs: positiveNumber(source.gapMs, fallback.gapMs),
    pathResolutionM: positiveNumber(source.pathResolutionM, fallback.pathResolutionM),
    maxAccuracyM: positiveNumber(source.maxAccuracyM, fallback.maxAccuracyM),
    maxSpeedMps: positiveNumber(source.maxSpeedMps, fallback.maxSpeedMps),
    minIntervalMs: positiveNumber(source.minIntervalMs, fallback.minIntervalMs),
  };
}
