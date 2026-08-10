import type { MoveSegment, Segment, StaySegment } from '../../segments';
import { activeCalories, caloriesFor, DEFAULT_WEIGHT_KG, metFor, normalizeWeightKg } from '../index';

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);

function move(mode: MoveSegment['mode'], distanceM: number, durationMs: number): MoveSegment {
  return {
    kind: 'move',
    id: `seg-${distanceM}`,
    startedAt: T0,
    endedAt: T0 + durationMs,
    fixCount: 50,
    distanceM,
    mode,
    label: null,
    modeIsManual: false,
    path: [],
    topSpeedMps: 3,
  };
}

function stay(durationMs: number): StaySegment {
  return {
    kind: 'stay',
    id: 'seg-stay',
    startedAt: T0,
    endedAt: T0 + durationMs,
    fixCount: 60,
    center: { lat: 0, lon: 0 },
    radiusM: 8,
  };
}

describe('metFor', () => {
  it('climbs with speed within a mode', () => {
    const strolling = metFor('walk', 0.8);
    const walking = metFor('walk', 1.4);
    const marching = metFor('walk', 2.1);

    expect(strolling).toBeLessThan(walking);
    expect(walking).toBeLessThan(marching);
  });

  it('costs more to run than to walk at the same effort scale', () => {
    expect(metFor('run', 3)).toBeGreaterThan(metFor('walk', 2));
  });

  it('charges almost nothing for sitting in a car', () => {
    expect(metFor('drive', 25)).toBeLessThan(2);
  });

  it('makes a conservative guess for movement it could not classify', () => {
    expect(metFor('unknown', 5)).toBe(2);
  });

  // Every ladder has to be total. A speed that falls off the end would return
  // undefined, and one NaN poisons the whole day's number.
  it('returns a real number for any speed at all', () => {
    for (const mode of ['walk', 'run', 'cycle', 'drive', 'unknown'] as const) {
      for (const speed of [0, 0.5, 5, 50, 500, Number.MAX_SAFE_INTEGER]) {
        expect(Number.isFinite(metFor(mode, speed))).toBe(true);
      }
    }
  });
});

describe('caloriesFor', () => {
  it('is MET times kilograms times hours', () => {
    // 1.4 m/s is 5 km/h: 3.5 METs. An hour at 70 kg.
    expect(caloriesFor('walk', 1.4, HOUR, 70)).toBeCloseTo(3.5 * 70, 6);
  });

  it('scales with time and with weight', () => {
    expect(caloriesFor('walk', 1.4, 2 * HOUR, 70)).toBeCloseTo(2 * caloriesFor('walk', 1.4, HOUR, 70), 6);
    expect(caloriesFor('walk', 1.4, HOUR, 140)).toBeCloseTo(2 * caloriesFor('walk', 1.4, HOUR, 70), 6);
  });

  it('is zero when there is nothing to charge for', () => {
    expect(caloriesFor('walk', 1.4, 0, 70)).toBe(0);
    expect(caloriesFor('walk', 1.4, -HOUR, 70)).toBe(0);
    expect(caloriesFor('walk', 1.4, Number.NaN, 70)).toBe(0);
    expect(caloriesFor('walk', 1.4, HOUR, 0)).toBe(0);
    expect(caloriesFor('walk', 1.4, HOUR, Number.NaN)).toBe(0);
  });
});

describe('activeCalories', () => {
  it('adds up the movement in a day', () => {
    const segments: Segment[] = [move('walk', 5_040, HOUR), move('cycle', 20_000, HOUR)];
    expect(activeCalories(segments, 70)).toBeCloseTo(
      caloriesFor('walk', 1.4, HOUR, 70) + caloriesFor('cycle', 20_000 / 3600, HOUR, 70),
      6,
    );
  });

  // Including rest would add fifteen hundred calories to every day, most of
  // them for being asleep, and drown the walk the number is supposed to be
  // about. This is active energy, like a watch's move ring.
  it('charges nothing for standing still', () => {
    expect(activeCalories([stay(8 * HOUR)], 70)).toBe(0);
  });

  it('is zero for a day with nothing in it', () => {
    expect(activeCalories([], 70)).toBe(0);
  });
});

describe('normalizeWeightKg', () => {
  it('keeps a sensible weight', () => {
    expect(normalizeWeightKg(82)).toBe(82);
  });

  it('falls back when the stored value is not a number', () => {
    expect(normalizeWeightKg(undefined)).toBe(DEFAULT_WEIGHT_KG);
    expect(normalizeWeightKg('80')).toBe(DEFAULT_WEIGHT_KG);
    expect(normalizeWeightKg(Number.NaN)).toBe(DEFAULT_WEIGHT_KG);
  });

  // Clamped rather than rejected: a slider that got away from someone should
  // not silently reset them to 70 kg.
  it('clamps a weight nobody has', () => {
    expect(normalizeWeightKg(2)).toBe(25);
    expect(normalizeWeightKg(5_000)).toBe(300);
  });
});
