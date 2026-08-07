import fc from 'fast-check';

import { RESTORE_ABOVE, SAVE_BELOW, shouldSaveBattery, type PowerReading } from '../index';

function reading(level: number | null, charging = false): PowerReading {
  return { level, charging };
}

describe('shouldSaveBattery', () => {
  it('saves below the threshold', () => {
    expect(shouldSaveBattery(reading(0.19), false)).toBe(true);
    expect(shouldSaveBattery(reading(0.05), false)).toBe(true);
    expect(shouldSaveBattery(reading(0), false)).toBe(true);
  });

  it('does not save on a comfortable charge', () => {
    expect(shouldSaveBattery(reading(0.8), false)).toBe(false);
    expect(shouldSaveBattery(reading(1), true)).toBe(false);
  });

  // The bug this exists to prevent: drop and restore at the same percentage,
  // and a phone sitting at 20% restarts Core Location every time the reading
  // flickers. Restarting is itself expensive, so the naive version spends more
  // battery than it saves at exactly the moment there is none to spare.
  describe('hysteresis', () => {
    it('keeps saving between the two thresholds once it has started', () => {
      expect(shouldSaveBattery(reading(0.22), true)).toBe(true);
      expect(shouldSaveBattery(reading(0.2), true)).toBe(true);
      expect(shouldSaveBattery(reading(0.249), true)).toBe(true);
    });

    it('does not start saving between the two thresholds', () => {
      expect(shouldSaveBattery(reading(0.22), false)).toBe(false);
      expect(shouldSaveBattery(reading(0.2), false)).toBe(false);
    });

    it('restores only once the charge is genuinely back', () => {
      expect(shouldSaveBattery(reading(RESTORE_ABOVE), true)).toBe(false);
      expect(shouldSaveBattery(reading(0.3), true)).toBe(false);
    });

    it('is exactly at the boundary where the comments say it is', () => {
      // Below is strict, restore is inclusive: 20% itself is not "below 20%".
      expect(shouldSaveBattery(reading(SAVE_BELOW), false)).toBe(false);
      expect(shouldSaveBattery(reading(SAVE_BELOW - 0.001), false)).toBe(true);
    });
  });

  describe('charging', () => {
    it('never saves while plugged in, however low', () => {
      expect(shouldSaveBattery(reading(0.02, true), false)).toBe(false);
      expect(shouldSaveBattery(reading(0.02, true), true)).toBe(false);
    });

    it('starts saving again the moment it is unplugged still low', () => {
      expect(shouldSaveBattery(reading(0.1, true), true)).toBe(false);
      expect(shouldSaveBattery(reading(0.1, false), false)).toBe(true);
    });
  });

  describe('when the platform will not say', () => {
    // A simulator reports no level at all, and a device reports none for a
    // moment at launch. "I do not know" is never a reason to record less.
    it('does not save on a missing or nonsense reading', () => {
      expect(shouldSaveBattery(reading(null), false)).toBe(false);
      expect(shouldSaveBattery(reading(null), true)).toBe(false);
      expect(shouldSaveBattery(reading(Number.NaN), true)).toBe(false);
      expect(shouldSaveBattery(reading(Number.POSITIVE_INFINITY), true)).toBe(false);
    });
  });

  // The property that makes the whole thing safe to run on every reading: it
  // settles. Feed it its own answer repeatedly at a fixed charge and it stops
  // changing, so a steady battery cannot produce an endless restart loop.
  it('reaches a fixed point for any steady reading', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.boolean(), fc.boolean(), (level, charging, start) => {
        const once = shouldSaveBattery({ level, charging }, start);
        const twice = shouldSaveBattery({ level, charging }, once);
        return once === twice;
      }),
    );
  });

  it('never saves while charging, at any level', () => {
    fc.assert(
      fc.property(fc.double({ min: 0, max: 1, noNaN: true }), fc.boolean(), (level, wasSaving) => {
        return shouldSaveBattery({ level, charging: true }, wasSaving) === false;
      }),
    );
  });
});
