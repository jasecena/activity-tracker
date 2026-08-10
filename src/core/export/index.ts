import { formatIsoWithOffset } from '../format';
import type { Fix } from '../geo';
import { matchPlace, type Place } from '../places';
import { averageSpeedMps, type Segment } from '../segments';

/**
 * CSV, for getting your own data out.
 *
 * Three files rather than one, because the app holds three genuinely different
 * things and flattening them into a single table would lose the distinction:
 *
 * - **fixes** — raw readings, exactly as Core Location gave them, including the
 *   accuracy circle and the platform's own speed estimate. Only exists for the
 *   current window: once a day is frozen, its raw fixes are dropped and only
 *   the derived segments survive.
 * - **points** — every route point the app kept, for all of history. Thinned to
 *   `pathResolutionM`, so roughly one every 25 m, each with the derived speed at
 *   that moment.
 * - **segments** — the timeline itself, one row per stay or journey.
 *
 * All pure string building, in `core`, so the exact bytes are asserted in a test
 * rather than eyeballed in a spreadsheet after the fact.
 */

/** RFC 4180: quote anything containing a comma, quote or newline; double the quotes. */
function cell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return '';
  const text = String(value);
  if (!/[",\r\n]/.test(text)) return text;
  return `"${text.replace(/"/g, '""')}"`;
}

function num(value: number | null | undefined, dp: number): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return value.toFixed(dp);
}

function toCsv(header: readonly string[], rows: readonly (readonly (string | number | null)[])[]): string {
  const lines = [header.map(cell).join(',')];
  for (const row of rows) lines.push(row.map(cell).join(','));
  // Trailing newline: POSIX text files end with one, and its absence is the
  // most common reason a tool reports one row fewer than you expected.
  return `${lines.join('\n')}\n`;
}

/**
 * Raw fixes — everything the platform told us, before any interpretation.
 *
 * `accuracy_m` is the reason most of them are here at all: a reading worse than
 * `maxAccuracyM` never reached the engine, and this is where you can see how
 * many of those there were and how bad they got.
 */
export function fixesToCsv(fixes: readonly Fix[], tzOffsetMinutes: number): string {
  return toCsv(
    ['timestamp', 'epoch_ms', 'latitude', 'longitude', 'accuracy_m', 'reported_speed_mps', 'altitude_m'],
    fixes.map((fix) => [
      formatIsoWithOffset(fix.at, tzOffsetMinutes),
      fix.at,
      num(fix.lat, 7),
      num(fix.lon, 7),
      Number.isFinite(fix.accuracyM) ? num(fix.accuracyM, 1) : 'invalid',
      num(fix.reportedSpeedMps, 2),
      num(fix.altitudeM, 1),
    ]),
  );
}

/**
 * Every route point kept, across the whole diary.
 *
 * `speed_mps` is derived — distance over elapsed time between two accepted
 * fixes — not the platform's estimate, so it can never contradict the distance
 * on the segment it belongs to. The first point of a segment has no step behind
 * it and therefore no speed.
 */
export function pointsToCsv(segments: readonly Segment[], tzOffsetMinutes: number): string {
  const rows: (string | number | null)[][] = [];

  for (const segment of segments) {
    if (segment.kind !== 'move') continue;
    for (const point of segment.path) {
      rows.push([
        segment.id,
        segment.mode,
        segment.label,
        formatIsoWithOffset(point.at, tzOffsetMinutes),
        point.at,
        num(point.lat, 7),
        num(point.lon, 7),
        num(point.speedMps, 3),
      ]);
    }
  }

  return toCsv(['segment_id', 'mode', 'label', 'timestamp', 'epoch_ms', 'latitude', 'longitude', 'speed_mps'], rows);
}

/**
 * The timeline, one row per segment.
 *
 * Stays and moves share a table because they share a spine — an id, a start, an
 * end — and the columns that do not apply are simply blank. Two files would
 * make "what happened between 09:00 and 10:00" a join.
 */
export function segmentsToCsv(segments: readonly Segment[], places: readonly Place[], tzOffsetMinutes: number): string {
  const rows = segments.map((segment) => {
    const shared = [
      segment.id,
      segment.kind,
      formatIsoWithOffset(segment.startedAt, tzOffsetMinutes),
      formatIsoWithOffset(segment.endedAt, tzOffsetMinutes),
      Math.round((segment.endedAt - segment.startedAt) / 1000),
      segment.fixCount,
    ];

    if (segment.kind === 'stay') {
      const place = matchPlace(segment, places);
      return [
        ...shared,
        '', // distance_m
        '', // mode
        '', // label
        '', // manual
        '', // top_speed_mps
        '', // avg_speed_mps
        num(segment.center.lat, 7),
        num(segment.center.lon, 7),
        num(segment.radiusM, 1),
        place?.name ?? '',
      ];
    }

    return [
      ...shared,
      num(segment.distanceM, 1),
      segment.mode,
      segment.label ?? '',
      segment.modeIsManual ? 'yes' : 'no',
      num(segment.topSpeedMps, 3),
      num(averageSpeedMps(segment), 3),
      '', // center_lat
      '', // center_lon
      '', // radius_m
      '', // place
    ];
  });

  return toCsv(
    [
      'id',
      'kind',
      'started',
      'ended',
      'duration_s',
      'fix_count',
      'distance_m',
      'mode',
      'label',
      'manual',
      'top_speed_mps',
      'avg_speed_mps',
      'center_lat',
      'center_lon',
      'radius_m',
      'place',
    ],
    rows,
  );
}

/** `activity-tracker-<what>-2026-08-04.csv`. Sorts chronologically in a file list. */
export function exportFilename(what: string, at: number, tzOffsetMinutes: number): string {
  const day = formatIsoWithOffset(at, tzOffsetMinutes).slice(0, 10);
  return `activity-tracker-${what}-${day}.csv`;
}
