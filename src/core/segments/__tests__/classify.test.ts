import { classifyMode, MOTOR_TOP_SPEED_MPS } from '../index';

const MINUTE = 60_000;

describe('classifyMode', () => {
  it.each([
    ['a stroll', 1_500, 20 * MINUTE, 2, 'walk'],
    ['a brisk walk', 5_000, 45 * MINUTE, 2.5, 'walk'],
    ['a jog', 5_000, 25 * MINUTE, 4.5, 'run'],
    ['a ride', 12_000, 30 * MINUTE, 11, 'cycle'],
    ['a motorway drive', 40_000, 25 * MINUTE, 33, 'drive'],
  ])('reads %s as %s', (_name, distanceM, durationMs, topSpeedMps, expected) => {
    expect(classifyMode({ distanceM, durationMs, topSpeedMps })).toBe(expected);
  });

  // The rule that stops a rush-hour commute — averaging the speed of a bicycle
  // because of the traffic — being filed as a bike ride. Traffic drags the
  // average down; nothing drags the peak down.
  it('calls anything that peaked above 50 km/h a drive, whatever the average', () => {
    const inTraffic = { distanceM: 9_000, durationMs: 35 * MINUTE, topSpeedMps: MOTOR_TOP_SPEED_MPS };
    expect(classifyMode({ ...inTraffic, topSpeedMps: MOTOR_TOP_SPEED_MPS - 0.1 })).toBe('cycle');
    expect(classifyMode(inTraffic)).toBe('drive');
  });

  describe('unknown', () => {
    it('is the answer when there is nothing to classify', () => {
      expect(classifyMode({ distanceM: 0, durationMs: MINUTE, topSpeedMps: 0 })).toBe('unknown');
      expect(classifyMode({ distanceM: 100, durationMs: 0, topSpeedMps: 0 })).toBe('unknown');
      expect(classifyMode({ distanceM: -5, durationMs: MINUTE, topSpeedMps: 0 })).toBe('unknown');
    });

    // Pacing a kitchen for ten minutes is not a walk, and putting "Walk,
    // 0.7 km/h" in the timeline is worse than admitting we do not know.
    it('is the answer for a crawl too slow to be travel', () => {
      expect(classifyMode({ distanceM: 100, durationMs: 30 * MINUTE, topSpeedMps: 0.9 })).toBe('unknown');
    });
  });

  // Either side of each threshold rather than exactly on it. An average speed
  // is a division, and `8.3 * 3600 / 3600000 * 1000` is 8.300000000000002 —
  // pinning the exact boundary would assert a floating-point artifact rather
  // than a decision anybody made.
  it.each([
    [2.15, 'walk'],
    [2.25, 'run'],
    [4.15, 'run'],
    [4.25, 'cycle'],
    [8.25, 'cycle'],
    [8.35, 'drive'],
  ])('reads an average of %p m/s as %s', (averageMps, expected) => {
    const oneHour = 60 * MINUTE;
    // A peak below the motor override, so only the average is under test.
    expect(classifyMode({ distanceM: averageMps * 3600, durationMs: oneHour, topSpeedMps: 12 })).toBe(expected);
  });
});
