import { averageSpeedMps, type ActivityMode, type Segment } from '../segments';

/**
 * Calories, from the only thing this app measures: how fast you went and for
 * how long.
 *
 * The model is METs — metabolic equivalents, from the Compendium of Physical
 * Activities. One MET is sitting still; walking briskly is about 4. Energy is
 * then `MET × kg × hours`, which is the standard approximation and is roughly
 * as accurate as anything you can get without a heart-rate strap. Treat the
 * number as an indication, not a measurement; it is wrong by a good 20% for any
 * particular person, and it is wrong *consistently*, which is what makes
 * comparing one day to the next worth anything.
 *
 * **Only movement counts.** A stay contributes nothing, even though a body at
 * rest is burning about 1 MET the whole time. Including it would add fifteen
 * hundred calories to every day, most of them for being asleep, and drown the
 * walk that the number is supposed to be about. This is active energy — the
 * same thing a watch's move ring shows — not total daily expenditure.
 */

export const DEFAULT_WEIGHT_KG = 70;

/** kcal burned per kilogram per hour at one MET. The definition of a MET. */
const KCAL_PER_KG_HOUR_AT_1_MET = 1;

const MS_PER_HOUR = 3_600_000;

/** Rung of a MET ladder: at or below `upToMps`, this many METs. */
interface MetRung {
  readonly upToMps: number;
  readonly met: number;
}

interface MetLadder {
  readonly rungs: readonly MetRung[];
  /** Above the last rung. A separate field rather than an `Infinity` rung, so the lookup is total by construction. */
  readonly above: number;
}

/** The ladders, in m/s. Values are the Compendium's, converted from mph. */
const MET_LADDERS: Readonly<Record<ActivityMode, MetLadder>> = {
  // 3.2 / 4.8 / 5.6 / 6.4 km/h and above.
  walk: {
    rungs: [
      { upToMps: 0.9, met: 2.0 },
      { upToMps: 1.35, met: 2.8 },
      { upToMps: 1.55, met: 3.5 },
      { upToMps: 1.8, met: 4.3 },
    ],
    above: 5.0,
  },
  // 8 / 9.7 / 11.3 / 12.9 km/h and above.
  run: {
    rungs: [
      { upToMps: 2.2, met: 8.3 },
      { upToMps: 2.7, met: 9.8 },
      { upToMps: 3.1, met: 11.0 },
      { upToMps: 3.6, met: 11.8 },
    ],
    above: 12.8,
  },
  // Under 16 / to 19 / to 22 / to 25 km/h and above.
  cycle: {
    rungs: [
      { upToMps: 4.4, met: 4.0 },
      { upToMps: 5.3, met: 6.8 },
      { upToMps: 6.1, met: 8.0 },
      { upToMps: 7.0, met: 10.0 },
    ],
    above: 12.0,
  },
  // Sitting, driving a car. Counted because you were in it, not because it cost
  // you anything much.
  drive: { rungs: [], above: 1.3 },
  // Moving, somehow, at a speed we could not place. Light effort is the honest
  // guess and the conservative one.
  unknown: { rungs: [], above: 2.0 },
};

/** METs for travelling in `mode` at `speedMps`. */
export function metFor(mode: ActivityMode, speedMps: number): number {
  const ladder = MET_LADDERS[mode];
  for (const rung of ladder.rungs) {
    if (speedMps <= rung.upToMps) return rung.met;
  }
  return ladder.above;
}

/** kcal for one stretch of movement. */
export function caloriesFor(mode: ActivityMode, speedMps: number, durationMs: number, weightKg: number): number {
  if (!Number.isFinite(durationMs) || durationMs <= 0) return 0;
  if (!Number.isFinite(weightKg) || weightKg <= 0) return 0;
  const hours = durationMs / MS_PER_HOUR;
  return metFor(mode, speedMps) * weightKg * hours * KCAL_PER_KG_HOUR_AT_1_MET;
}

/** kcal for a whole timeline. Stays contribute nothing — see the note above. */
export function activeCalories(segments: readonly Segment[], weightKg: number): number {
  let total = 0;
  for (const segment of segments) {
    if (segment.kind !== 'move') continue;
    total += caloriesFor(segment.mode, averageSpeedMps(segment), segment.endedAt - segment.startedAt, weightKg);
  }
  return total;
}

/** The trust boundary for the one number this module needs from storage. */
export function normalizeWeightKg(input: unknown): number {
  if (typeof input !== 'number' || !Number.isFinite(input)) return DEFAULT_WEIGHT_KG;
  // Clamped rather than rejected: a slider that got away from someone should
  // not silently fall back to 70 kg, and no real weight is outside this.
  return Math.min(300, Math.max(25, input));
}
