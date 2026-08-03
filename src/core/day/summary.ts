import { ACTIVITY_MODES, durationMs, type ActivityMode, type Segment } from '../segments';

export interface ModeTotals {
  readonly distanceM: number;
  readonly durationMs: number;
  readonly count: number;
}

export const EMPTY_MODE_TOTALS: ModeTotals = { distanceM: 0, durationMs: 0, count: 0 };

export interface DaySummary {
  readonly distanceM: number;
  readonly movingMs: number;
  readonly stillMs: number;
  /** First to last segment, including the pauses. Zero for an empty day. */
  readonly spanMs: number;
  readonly byMode: Readonly<Record<ActivityMode, ModeTotals>>;
  readonly moveCount: number;
  readonly stayCount: number;
}

function emptyByMode(): Record<ActivityMode, ModeTotals> {
  const byMode = {} as Record<ActivityMode, ModeTotals>;
  for (const mode of ACTIVITY_MODES) byMode[mode] = EMPTY_MODE_TOTALS;
  return byMode;
}

/**
 * Add up a day.
 *
 * `movingMs` and `stillMs` sum to `spanMs` and not to 24 hours, and the
 * difference is the point: the hours the phone recorded nothing — asleep,
 * indoors, battery flat — are not silently counted as "still". An app that
 * reports sixteen hours stationary because it was in a drawer is lying with
 * arithmetic that is technically correct.
 */
export function summarizeDay(segments: readonly Segment[]): DaySummary {
  const byMode = emptyByMode();
  let distanceM = 0;
  let movingMs = 0;
  let stillMs = 0;
  let moveCount = 0;
  let stayCount = 0;
  let earliest = Number.POSITIVE_INFINITY;
  let latest = Number.NEGATIVE_INFINITY;

  for (const segment of segments) {
    const elapsed = durationMs(segment);
    earliest = Math.min(earliest, segment.startedAt);
    latest = Math.max(latest, segment.endedAt);

    if (segment.kind === 'stay') {
      stillMs += elapsed;
      stayCount += 1;
      continue;
    }

    moveCount += 1;
    movingMs += elapsed;
    distanceM += segment.distanceM;

    const previous = byMode[segment.mode];
    byMode[segment.mode] = {
      distanceM: previous.distanceM + segment.distanceM,
      durationMs: previous.durationMs + elapsed,
      count: previous.count + 1,
    };
  }

  return {
    distanceM,
    movingMs,
    stillMs,
    spanMs: segments.length === 0 ? 0 : latest - earliest,
    byMode,
    moveCount,
    stayCount,
  };
}
