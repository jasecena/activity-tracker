import {
  formatBytes,
  formatClockTime,
  formatDayTitle,
  formatDistance,
  formatDuration,
  formatPace,
  formatSpeed,
  formatTimecode,
  modeLabel,
} from '../index';

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [512, '512 B'],
    [999, '999 B'],
    [1_000, '1 kB'],
    [847_000, '847 kB'],
    [1_000_000, '1.0 MB'],
    [41_900_000, '41.9 MB'],
    [1_000_000_000, '1.0 GB'],
    [4_190_000_000, '4.2 GB'],
  ])('renders %p as %p', (bytes, expected) => {
    expect(formatBytes(bytes)).toBe(expected);
  });

  /**
   * Decimal, so this agrees with Settings › General › iPhone Storage. The
   * binary reading of the same number is 3.9 GB, and a diary that disagrees
   * with the phone about how much of it a diary is using is the wrong one.
   */
  it('counts in powers of ten, as iOS does', () => {
    expect(formatBytes(4_294_967_296)).toBe('4.3 GB');
  });

  it('refuses a number that is not a size', () => {
    expect(formatBytes(-1)).toBe('—');
    expect(formatBytes(Number.NaN)).toBe('—');
    expect(formatBytes(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDistance', () => {
  it.each([
    [0, '0 m'],
    [7, '7 m'],
    [847.3, '847 m'],
    [999.4, '999 m'],
    [1000, '1.00 km'],
    [1420, '1.42 km'],
    [12_500, '12.50 km'],
  ])('renders %p as %p', (metres, expected) => {
    expect(formatDistance(metres)).toBe(expected);
  });

  // A GPS fix is not accurate to a decimetre, and "847.3 m" claims a precision
  // the hardware does not have.
  it('does not claim sub-metre precision below a kilometre', () => {
    expect(formatDistance(847.3)).not.toContain('.');
  });

  it('shows a dash rather than a number it cannot mean', () => {
    expect(formatDistance(Number.NaN)).toBe('—');
    expect(formatDistance(-1)).toBe('—');
    expect(formatDistance(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatDuration', () => {
  it.each([
    [0, '0s'],
    [999, '0s'],
    [45_000, '45s'],
    [59_999, '59s'],
    [60_000, '1m'],
    [18 * 60_000, '18m'],
    [59 * 60_000, '59m'],
    [3_600_000, '1h 00m'],
    [5_040_000, '1h 24m'],
    [26 * 3_600_000, '26h 00m'],
  ])('renders %p as %p', (ms, expected) => {
    expect(formatDuration(ms)).toBe(expected);
  });

  it('shows a dash rather than a number it cannot mean', () => {
    expect(formatDuration(Number.NaN)).toBe('—');
    expect(formatDuration(-1)).toBe('—');
  });
});

describe('formatTimecode', () => {
  it.each([
    [0, '0:00'],
    [999, '0:00'],
    [7_000, '0:07'],
    [45_000, '0:45'],
    [59_999, '0:59'],
    [60_000, '1:00'],
    [107_000, '1:47'],
    [599_000, '9:59'],
    [600_000, '10:00'],
    [20 * 60_000, '20:00'],
    [3_600_000, '1:00:00'],
    [3_753_000, '1:02:33'],
    [26 * 3_600_000, '26:00:00'],
  ])('renders %p as %p', (ms, expected) => {
    expect(formatTimecode(ms)).toBe(expected);
  });

  /**
   * The bug this function was written for. A recording counter driven by
   * `formatDuration` reads "1m" for every millisecond of the second minute, so
   * it appears to stop counting a minute in — and the finished note then claims
   * to be a minute long when it is nearly two.
   */
  it('advances every second where formatDuration stands still for sixty of them', () => {
    const secondMinute = [60_000, 75_000, 90_000, 105_000, 119_000];
    expect(new Set(secondMinute.map(formatDuration)).size).toBe(1);
    expect(new Set(secondMinute.map(formatTimecode)).size).toBe(secondMinute.length);
  });

  it('shows a dash rather than a number it cannot mean', () => {
    expect(formatTimecode(Number.NaN)).toBe('—');
    expect(formatTimecode(-1)).toBe('—');
    expect(formatTimecode(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatClockTime', () => {
  const at = Date.UTC(2026, 0, 5, 22, 5, 0);

  it('reads the clock in the zone it is given', () => {
    expect(formatClockTime(at, 0)).toBe('22:05');
    expect(formatClockTime(at, 600)).toBe('08:05');
    expect(formatClockTime(at, -300)).toBe('17:05');
  });

  it('pads both halves', () => {
    expect(formatClockTime(Date.UTC(2026, 0, 5, 9, 7, 0), 0)).toBe('09:07');
  });
});

describe('formatSpeed', () => {
  it('renders metres per second as km/h', () => {
    expect(formatSpeed(0)).toBe('0.0 km/h');
    expect(formatSpeed(1.4)).toBe('5.0 km/h');
    expect(formatSpeed(13.888)).toBe('50.0 km/h');
  });

  it('shows a dash rather than a number it cannot mean', () => {
    expect(formatSpeed(Number.NaN)).toBe('—');
    expect(formatSpeed(-2)).toBe('—');
  });
});

describe('formatPace', () => {
  it('renders minutes and seconds per kilometre', () => {
    expect(formatPace(1000 / 600)).toBe('10\'00"/km');
    expect(formatPace(1.4)).toBe('11\'54"/km');
  });

  // 59.6 s must carry into the minutes, not print 12'60".
  it('carries a rounded 60 seconds into the minute', () => {
    expect(formatPace(1000 / 719.6)).toBe('12\'00"/km');
  });

  it('refuses to divide by a standstill', () => {
    expect(formatPace(0)).toBe('—');
    expect(formatPace(0.05)).toBe('—');
    expect(formatPace(Number.NaN)).toBe('—');
    expect(formatPace(-1)).toBe('—');
  });

  it('refuses a pace too slow to be meaningful', () => {
    expect(formatPace(0.11)).toBe('—');
  });
});

describe('formatDayTitle', () => {
  it('names the weekday and the date', () => {
    expect(formatDayTitle(Date.UTC(2026, 0, 5, 12), 0)).toBe('Monday 5 Jan');
    expect(formatDayTitle(Date.UTC(2026, 11, 25, 12), 0)).toBe('Friday 25 Dec');
  });

  // 22:00 UTC is already tomorrow in Sydney. The History list and the day page
  // it opens both call this, so if it were wrong they would at least be wrong
  // together — which is exactly why it lives in one place.
  it('names the day in the zone it is given', () => {
    const evening = Date.UTC(2026, 0, 5, 22, 0, 0);
    expect(formatDayTitle(evening, 0)).toBe('Monday 5 Jan');
    expect(formatDayTitle(evening, 600)).toBe('Tuesday 6 Jan');
  });
});

describe('modeLabel', () => {
  it('names every mode', () => {
    expect(modeLabel('walk')).toBe('Walk');
    expect(modeLabel('run')).toBe('Run');
    expect(modeLabel('cycle')).toBe('Ride');
    expect(modeLabel('drive')).toBe('Drive');
  });

  // "Moving" is true and admits nothing more. "Walk" would be a guess printed
  // as a fact.
  it('says only what it knows for an unclassified segment', () => {
    expect(modeLabel('unknown')).toBe('Moving');
  });
});
