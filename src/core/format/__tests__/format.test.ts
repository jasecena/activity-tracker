import { formatClockTime, formatDistance, formatDuration, formatPace, formatSpeed, modeLabel } from '../index';

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
