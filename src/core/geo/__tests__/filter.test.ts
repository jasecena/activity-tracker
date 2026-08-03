import { judgeFix, type Fix, type FixFilterConfig } from '../index';

const CONFIG: FixFilterConfig = { maxAccuracyM: 60, maxSpeedMps: 90, minIntervalMs: 1_000 };

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

function fixture(overrides: Partial<Fix> = {}): Fix {
  return { lat: 0, lon: 0, at: T0, accuracyM: 10, reportedSpeedMps: null, altitudeM: null, ...overrides };
}

describe('judgeFix', () => {
  it('accepts the first usable fix with nothing to compare against', () => {
    expect(judgeFix(null, fixture(), CONFIG)).toEqual({ ok: true });
  });

  it('accepts a plausible step', () => {
    const previous = fixture();
    const next = fixture({ at: T0 + 10_000, lat: 0.0001 });
    expect(judgeFix(previous, next, CONFIG)).toEqual({ ok: true });
  });

  describe('rejections', () => {
    it.each([
      ['a wide accuracy circle', fixture({ accuracyM: 500 }), 'inaccurate'],
      ['an invalid reading mapped to Infinity', fixture({ accuracyM: Infinity }), 'inaccurate'],
      ['a latitude off the globe', fixture({ lat: 91 }), 'malformed'],
      ['a longitude off the globe', fixture({ lon: -181 }), 'malformed'],
      ['a NaN coordinate', fixture({ lat: Number.NaN }), 'malformed'],
      ['a NaN timestamp', fixture({ at: Number.NaN }), 'malformed'],
    ])('rejects %s', (_name, candidate, reason) => {
      expect(judgeFix(null, candidate, CONFIG)).toEqual({ ok: false, reason });
    });

    // iOS replays cached fixes when it wakes the app, and occasionally hands
    // back one older than the last. Every derived speed goes negative.
    it('rejects a fix that is not newer than the one before it', () => {
      const previous = fixture({ at: T0 + 60_000 });
      expect(judgeFix(previous, fixture({ at: T0 }), CONFIG)).toEqual({ ok: false, reason: 'out-of-order' });
      expect(judgeFix(previous, fixture({ at: T0 + 60_000 }), CONFIG)).toEqual({ ok: false, reason: 'out-of-order' });
    });

    it('rejects a fix that arrived sooner than the sampling interval', () => {
      const previous = fixture();
      expect(judgeFix(previous, fixture({ at: T0 + 500 }), CONFIG)).toEqual({ ok: false, reason: 'too-soon' });
    });

    // The single most common way a tracker lies: the first fix after a cold
    // start is where the phone was hours ago, stamped `now`.
    it('rejects a step across a city in ten seconds', () => {
      const previous = fixture();
      const next = fixture({ at: T0 + 10_000, lat: 0.2 });
      expect(judgeFix(previous, next, CONFIG)).toEqual({ ok: false, reason: 'teleport' });
    });

    it('accepts that same distance given enough time for it', () => {
      const previous = fixture();
      const next = fixture({ at: T0 + 30 * 60_000, lat: 0.2 });
      expect(judgeFix(previous, next, CONFIG)).toEqual({ ok: true });
    });
  });

  it('checks accuracy before anything that needs a previous fix', () => {
    // A bad fix is bad on its own terms; it must not depend on what came
    // before, or the first fix after a gap would be trusted unconditionally.
    expect(judgeFix(null, fixture({ accuracyM: 5_000 }), CONFIG)).toEqual({ ok: false, reason: 'inaccurate' });
  });
});
