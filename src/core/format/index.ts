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
 * Bytes on disk, the way iOS says them.
 *
 * **Decimal, not binary**, because this number is compared against the one in
 * Settings › General › iPhone Storage, and Apple has counted in powers of ten
 * since OS X 10.6. A library the phone calls 4.19 GB should not be called
 * 3.9 GB here over a convention nobody outside a terminal uses.
 *
 * It exists because the media total was `Math.round(bytes / 1024)` with a `kB`
 * label — wrong twice over, and unreadable at exactly the size where it starts
 * to matter. Captures are the only store in this app with no bound on them
 * (retention covers days and fixes and deliberately leaves photographs alone),
 * so this is the number that has to stay legible into the gigabytes.
 *
 * One decimal above a megabyte, none below: "847 kB" is precise enough for a
 * thumbnail, and "1.4 GB" is the answer to how much of the phone this is using.
 */
export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  if (bytes < 1_000) return `${Math.round(bytes)} B`;
  if (bytes < 1_000_000) return `${Math.round(bytes / 1_000)} kB`;
  if (bytes < 1_000_000_000) return `${(bytes / 1_000_000).toFixed(1)} MB`;
  return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
}

/**
 * Duration, in the largest two units that matter.
 *
 * "1h 24m", not "1h 24m 09s": the seconds are noise at that scale and they make
 * the row jitter as it updates. Under a minute they are all there is, so they
 * are shown.
 *
 * **A summary of a stretch of a day, never a counter and never a recording's
 * length.** Rounding to the minute is the whole feature here and the whole bug
 * there — see `formatTimecode`.
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

/**
 * A clock that is running, or a length short enough that the seconds are the
 * point: `0:07`, `1:47`, `1:02:33`.
 *
 * **`formatDuration` is a summary and this is a counter, and using the first
 * where the second belongs is a bug that reads as data loss.** That formatter
 * drops the seconds above a minute on purpose — "1h 24m 09s" is noise on a
 * timeline row and makes it jitter as it updates — but it was also driving the
 * recording counter, so a voice note ticked 57s, 58s, 59s and then sat on "1m"
 * for a full minute before moving again. Reported from a phone as the recorder
 * having stopped counting, which is exactly what it looks like: the one part of
 * the screen whose job is to prove the microphone is still listening had
 * stopped moving.
 *
 * The same string then went on the finished note, where a recording of 1m47s is
 * labelled "1m" — so the counter that appeared to freeze at a minute produced a
 * recording that claims to be a minute, and the two agree on a number that is
 * wrong. That is worse than an idle counter: it is the app telling somebody the
 * rest of what they said was not kept.
 *
 * So anywhere a duration is either **advancing** or is **a recording's own
 * length**, the seconds are shown — a live counter, a playback position, the
 * length on the pill. Anywhere it summarises a stretch of a day — a journey, a
 * stay, a total over a place — `formatDuration` still reads better and still
 * rounds. Neither is a general-purpose duration formatter; the question they
 * answer is different.
 *
 * Minutes are unpadded and everything below them is padded, which is how a
 * stopwatch and every media transport write it: `9:59`, then `10:00`. The hour
 * appears only once there is one, so the common case stays the two fields the
 * eye is expecting.
 */
export function formatTimecode(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) return '—';
  const totalSeconds = Math.floor(ms / MS_PER_SECOND);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  if (hours === 0) return `${minutes}:${pad(seconds)}`;
  return `${hours}:${pad(minutes)}:${pad(seconds)}`;
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

/**
 * A full ISO 8601 instant with the offset spelled out: `2026-08-04T10:34:05+10:00`.
 *
 * For export, where a bare local time is ambiguous and a bare `Z` throws away
 * the thing you most want to know about a diary entry — what time it felt like
 * where you were. Spreadsheets, GPX tools and pandas all read this form.
 */
export function formatIsoWithOffset(at: number, tzOffsetMinutes: number): string {
  const local = new Date(at + tzOffsetMinutes * MS_PER_MINUTE);
  const date = `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
  const time = `${pad(local.getUTCHours())}:${pad(local.getUTCMinutes())}:${pad(local.getUTCSeconds())}`;

  const sign = tzOffsetMinutes < 0 ? '-' : '+';
  const total = Math.abs(tzOffsetMinutes);
  return `${date}T${time}${sign}${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * A day's heading: "Monday 5 Jan".
 *
 * Here rather than in the two screens that show it, so the History list and the
 * day page it opens cannot drift into disagreeing about what the same day is
 * called.
 *
 * Reads UTC components off an instant already shifted into local time — the same
 * trick, and the same reason, as `core/day/dayKeyOf`. Asking for local
 * components would apply the runtime's own zone a second time.
 */
export function formatDayTitle(at: number, tzOffsetMinutes: number): string {
  const local = new Date(at + tzOffsetMinutes * MS_PER_MINUTE);
  return `${WEEKDAYS[local.getUTCDay()] ?? ''} ${local.getUTCDate()} ${MONTHS[local.getUTCMonth()] ?? ''}`;
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
