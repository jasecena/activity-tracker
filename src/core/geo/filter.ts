import { distanceM } from './distance';
import type { Fix } from './types';

/**
 * Why a fix was thrown away.
 *
 * Named rather than boolean because the counts are worth showing: a day where
 * two thirds of the fixes were `inaccurate` is a day spent indoors, and the
 * gaps in the timeline are explained rather than mysterious.
 */
export type RejectionReason =
  /** Accuracy circle too wide to say anything about movement. */
  | 'inaccurate'
  /** Not newer than the fix before it. iOS replays cached fixes on wake. */
  | 'out-of-order'
  /** Arrived sooner than the minimum sampling interval. */
  | 'too-soon'
  /** Implies a speed no ground vehicle reaches. A bad fix, not a journey. */
  | 'teleport'
  /** Coordinates outside the valid range, or not finite. */
  | 'malformed';

export type FixVerdict = { readonly ok: true } | { readonly ok: false; readonly reason: RejectionReason };

const ACCEPTED: FixVerdict = { ok: true };

export interface FixFilterConfig {
  /** Fixes with a wider accuracy circle than this are dropped. */
  readonly maxAccuracyM: number;
  /** A step implying more than this ground speed is a bad fix. */
  readonly maxSpeedMps: number;
  /** Minimum time between two accepted fixes. */
  readonly minIntervalMs: number;
}

function isFiniteNumber(value: number): boolean {
  return Number.isFinite(value);
}

/**
 * Should this fix be allowed to reach the segmenter?
 *
 * Runs before anything else, and its rejections are the reason the engine can
 * treat every fix it sees as real. Three of the five reasons are not
 * hypothetical — they are what an iPhone actually does:
 *
 * - **`inaccurate`.** Indoors, iOS falls back to Wi-Fi and cell positioning and
 *   reports accuracy of 65 m to 3 km. Sitting at a desk, consecutive readings
 *   land hundreds of metres apart, and a naive segmenter records a lunchtime
 *   run around the building. Dropping them costs nothing: a wide fix cannot
 *   tell you whether you moved, so it has no information to contribute.
 * - **`out-of-order`.** When iOS wakes the app it can deliver a batch that
 *   includes readings already seen, and occasionally one older than the last.
 *   A negative time delta makes every derived speed negative or infinite.
 * - **`teleport`.** A first fix after a cold start is often the last known
 *   position from wherever the phone was hours ago, timestamped *now*. The step
 *   from it to reality is a straight line across a city at 400 km/h. Left in,
 *   it adds tens of kilometres to the day's distance — the single most common
 *   way a tracker lies to its owner.
 *
 * `previous` is the last **accepted** fix, never a rejected one. Comparing
 * against a fix that was itself bad is how one glitch becomes a cascade of
 * them.
 */
export function judgeFix(previous: Fix | null, next: Fix, config: FixFilterConfig): FixVerdict {
  if (
    !isFiniteNumber(next.lat) ||
    !isFiniteNumber(next.lon) ||
    !isFiniteNumber(next.at) ||
    Math.abs(next.lat) > 90 ||
    Math.abs(next.lon) > 180
  ) {
    return { ok: false, reason: 'malformed' };
  }

  // A negative accuracy is how Core Location says "this reading is invalid";
  // `services/location.ts` maps that to Infinity, which lands here.
  if (!(next.accuracyM <= config.maxAccuracyM)) {
    return { ok: false, reason: 'inaccurate' };
  }

  if (previous === null) return ACCEPTED;

  const elapsedMs = next.at - previous.at;
  if (elapsedMs <= 0) return { ok: false, reason: 'out-of-order' };
  if (elapsedMs < config.minIntervalMs) return { ok: false, reason: 'too-soon' };

  const speedMps = (distanceM(previous, next) / elapsedMs) * 1000;
  if (speedMps > config.maxSpeedMps) return { ok: false, reason: 'teleport' };

  return ACCEPTED;
}
