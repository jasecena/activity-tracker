import { durationMs, type Segment } from '../segments';

export interface DaySummary {
  readonly distanceM: number;
  readonly movingMs: number;
  /**
   * Time inside a stay. Deliberately not "the rest of the day" — see the note
   * on `summarizeDay`, and the test that asserts the two do not add up.
   */
  readonly stillMs: number;
  /** First to last segment, including the pauses. Zero for an empty day. */
  readonly spanMs: number;
  readonly moveCount: number;
  readonly stayCount: number;
}

/**
 * Add up a day.
 *
 * `movingMs` and `stillMs` sum to `spanMs` and not to 24 hours, and the
 * difference is the point: the hours the phone recorded nothing — asleep,
 * indoors, battery flat — are not silently counted as "still". An app that
 * reports sixteen hours stationary because it was in a drawer is lying with
 * arithmetic that is technically correct.
 *
 * **`stillMs` and `spanMs` are the assertion surface for that claim**, which is
 * why they are here although no screen prints either. `properties.test.ts`
 * checks `movingMs + stillMs <= spanMs` over generated fix streams, and
 * `day.test.ts` pins both halves: exactly equal for a contiguous day, strictly
 * less once there is a gap in it. Removing them would remove the only proof
 * that the app does not do the thing described above.
 *
 * There was a `byMode` breakdown here too — distance, duration and a count per
 * activity mode, allocated on every call. It was built for a summary card that
 * no longer exists, nothing read it, and `summarizeDay` runs once per row of
 * the all-days list. Per-mode totals are a fold over `segments` if something
 * wants them again.
 */
export function summarizeDay(segments: readonly Segment[]): DaySummary {
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
  }

  return {
    distanceM,
    movingMs,
    stillMs,
    spanMs: segments.length === 0 ? 0 : latest - earliest,
    moveCount,
    stayCount,
  };
}
