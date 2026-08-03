import { averageSpeedMps, DEFAULT_SEGMENT_CONFIG, normalizeSegmentConfig, type MoveSegment } from '../index';

describe('normalizeSegmentConfig', () => {
  it('keeps a config that is already good', () => {
    expect(normalizeSegmentConfig(DEFAULT_SEGMENT_CONFIG)).toEqual(DEFAULT_SEGMENT_CONFIG);
  });

  it('keeps the fields that are usable and replaces the ones that are not', () => {
    const stored = { ...DEFAULT_SEGMENT_CONFIG, stillSpeedMps: 0.8, minStayMs: null };
    const config = normalizeSegmentConfig(stored);

    expect(config.stillSpeedMps).toBe(0.8);
    expect(config.minStayMs).toBe(DEFAULT_SEGMENT_CONFIG.minStayMs);
  });

  it.each([
    ['nothing at all', undefined],
    ['null', null],
    ['a string', 'fast'],
    ['a number', 12],
    ['an array', []],
    ['an empty object', {}],
  ])('falls back to every default given %s', (_name, input) => {
    expect(normalizeSegmentConfig(input)).toEqual(DEFAULT_SEGMENT_CONFIG);
  });

  // This is the failure the trust boundary exists for. A `stillSpeedMps` of
  // null propagates as NaN through every comparison in the machine, where
  // `NaN >= x` is false — so every fix in the day reads as "still", the
  // timeline comes out empty, and nothing anywhere reports an error.
  it.each([null, undefined, Number.NaN, Infinity, -1, 0, '0.5', {}])('refuses %p as a threshold', (bad) => {
    const config = normalizeSegmentConfig({ ...DEFAULT_SEGMENT_CONFIG, stillSpeedMps: bad });
    expect(config.stillSpeedMps).toBe(DEFAULT_SEGMENT_CONFIG.stillSpeedMps);
    expect(Number.isFinite(config.stillSpeedMps)).toBe(true);
  });

  it('produces a config with every field a positive finite number', () => {
    const config = normalizeSegmentConfig({ nonsense: true });
    for (const value of Object.values(config)) {
      expect(Number.isFinite(value)).toBe(true);
      expect(value).toBeGreaterThan(0);
    }
  });
});

describe('averageSpeedMps', () => {
  function move(distanceM: number, durationMs: number): MoveSegment {
    return {
      kind: 'move',
      id: 'seg-1',
      startedAt: 0,
      endedAt: durationMs,
      fixCount: 10,
      distanceM,
      mode: 'walk',
      label: null,
      modeIsManual: false,
      path: [],
      topSpeedMps: 2,
    };
  }

  it('is distance over time', () => {
    expect(averageSpeedMps(move(1_400, 1_000_000))).toBeCloseTo(1.4, 9);
  });

  // Rather than Infinity, which would reach the calorie model and the
  // classifier and turn a whole day's numbers into NaN.
  it('is zero rather than infinite for a segment with no duration', () => {
    expect(averageSpeedMps(move(100, 0))).toBe(0);
    expect(averageSpeedMps(move(100, -5))).toBe(0);
  });
});
