import type { ActivityMode } from '../segments';

/**
 * Every string the UI shows for a number.
 *
 * In `core` rather than beside the components that use them, because they are
 * decisions rather than presentation: whether 940 m is "0.9 km" or "940 m"
 * changes what the timeline says about your day, and it should be asserted in a
 * test that runs in a second, not eyeballed in a simulator.
 *
 * Deliberately not `Intl`. It is available in Hermes, but its output shifts
 * with the device locale, which would make every one of these assertions depend
 * on the runner's settings — the same class of problem the UTC pin in
 * jest.config.js solves for dates.
 */

const MS_PER_SECOND = 1000;
const MS_PER_MINUTE = 60 * MS_PER_SECOND;
const MS_PER_HOUR = 60 * MS_PER_MINUTE;

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * Distance, at the precision the reading deserves.
 *
 * Under a kilometre it is whole metres — a GPS fix is not accurate to a
 * decimetre, and "847.3 m" claims a precision the hardware does not have. Over
 * a kilometre it is two decimals, because 1.42 km and 1.4 km are a
 * meaningfully different answer to "how far was that walk".
 */
export function formatDistance(metres: number): string {
  if (!Number.isFinite(metres) || metres < 0) return '—';
  if (metres < 1000) return `${Math.round(metres)} m`;
  return `${(metres / 1000).toFixed(2)} km`;
}

/**
 * Duration, in the largest two units that matter.
 *
 * "1h 24m", not "1h 24m 09s": the seconds are noise at that scale and they make
 * the row jitter as it updates. Under a minute they are all there is, so they
 * are shown.
 */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  if (totalSeconds < 60) return `${totalSeconds}s`;

  const hours = Math.floor(ms / MS_PER_HOUR);
  const minutes = Math.floor((ms % MS_PER_HOUR) / MS_PER_MINUTE);
  if (hours === 0) return `${minutes}m`;
  return `${hours}h ${pad(minutes)}m`;
}

/** Wall-clock time of day, 24-hour, in the zone the caller names. See `core/day` on the sign of the offset. */
export function formatClockTime(at: number, tzOffsetMinutes: number): string {
  const local = new Date(at + tzOffsetMinutes * MS_PER_MINUTE);
  return `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}`;
}

/** Speed in km/h, one decimal. */
export function formatSpeed(metresPerSecond: number): string {
  if (!Number.isFinite(metresPerSecond) || metresPerSecond < 0) return '—';
  return `${((metresPerSecond * 3600) / 1000).toFixed(1)} km/h`;
}

/**
 * Pace as mm'ss" per kilometre — how a walk or a run is actually measured.
 *
 * Meaningless above a certain speed, and worse than meaningless at zero, where
 * it is infinite. Both return a dash rather than a number.
 */
export function formatPace(metresPerSecond: number): string {
  if (!Number.isFinite(metresPerSecond) || metresPerSecond <= 0.1) return '—';
  const secondsPerKm = 1000 / metresPerSecond;
  if (secondsPerKm > 99 * 60) return '—';
  const minutes = Math.floor(secondsPerKm / 60);
  const seconds = Math.round(secondsPerKm % 60);
  // Rounding 59.6 s up must carry into the minutes, not print 12'60".
  if (seconds === 60) return `${minutes + 1}'00"/km`;
  return `${minutes}'${pad(seconds)}"/km`;
}

const MODE_LABELS: Readonly<Record<ActivityMode, string>> = {
  walk: 'Walk',
  run: 'Run',
  cycle: 'Ride',
  drive: 'Drive',
  unknown: 'Moving',
};

/** What to call a mode in the timeline. `unknown` becomes "Moving" — true, and admits nothing more. */
export function modeLabel(mode: ActivityMode): string {
  return MODE_LABELS[mode];
}
