import type { ActivityMode } from './types';

/**
 * Turning "you moved 4.2 km in 26 minutes, peaking at 11 m/s" into "cycle".
 *
 * Speed is the only signal available. There is no accelerometer here and no
 * Core Motion activity type — deliberately, because both would drag the engine
 * onto a device and out of the reach of the test suite. Speed alone is enough
 * to be right most of the time and honest the rest of it, which is why
 * `unknown` exists.
 */

/** Upper bound of each mode's *average* speed, in m/s. */
export const AVERAGE_SPEED_CEILING_MPS = {
  /** 8 km/h. A brisk walk, and the low end of a slow jog — hence the top-speed check. */
  walk: 2.2,
  /** 15 km/h. */
  run: 4.2,
  /** 30 km/h. Above this an average, not just a peak, means an engine. */
  cycle: 8.3,
} as const;

/**
 * A peak above this means a motor, whatever the average says.
 *
 * 14 m/s is 50 km/h. This is the rule that stops a rush-hour commute — twelve
 * kilometres in fifty minutes, averaging a brisk cycle — being filed as a bike
 * ride. Traffic drags the average down; nothing drags the peak down.
 */
export const MOTOR_TOP_SPEED_MPS = 14;

/**
 * Below this average, there is nothing to classify.
 *
 * A "move" this slow is a stay the minimums failed to absorb — someone pacing a
 * kitchen — and calling it a walk would put a 0.2 km/h walk in the timeline.
 */
export const UNKNOWN_FLOOR_MPS = 0.4;

export interface ClassifyInput {
  readonly distanceM: number;
  readonly durationMs: number;
  readonly topSpeedMps: number;
}

/**
 * Classify a move segment.
 *
 * Ordered so that the cheap disqualifications come first and the top-speed
 * override sits above the average-speed ladder rather than inside it.
 */
export function classifyMode({ distanceM, durationMs, topSpeedMps }: ClassifyInput): ActivityMode {
  if (durationMs <= 0 || distanceM <= 0) return 'unknown';

  const averageMps = (distanceM / durationMs) * 1000;
  if (averageMps < UNKNOWN_FLOOR_MPS) return 'unknown';

  if (topSpeedMps >= MOTOR_TOP_SPEED_MPS) return 'drive';

  if (averageMps <= AVERAGE_SPEED_CEILING_MPS.walk) return 'walk';
  if (averageMps <= AVERAGE_SPEED_CEILING_MPS.run) return 'run';
  if (averageMps <= AVERAGE_SPEED_CEILING_MPS.cycle) return 'cycle';
  return 'drive';
}
