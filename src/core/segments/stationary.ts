import { centroid, distanceM, type LatLon } from '../geo';

import { splitSegment, type JourneyLabel } from './manual';
import type { Segment, StaySegment } from './types';

/**
 * "I was here the whole time."
 *
 * A phone sitting still for three hours produces drift; drift produces spurious
 * short moves; and an afternoon at one desk comes out as stay/move/stay/move
 * rather than as one stop. `minMoveDistanceM` absorbs some of that and not all,
 * and no threshold can absorb the other case this answers — a **hole**, where
 * the phone reported nothing for two hours indoors and the timeline honestly
 * stops. The fold is forbidden to guess across that gap, and it should be. This
 * is the one place where the person who was there can say what the app may not
 * infer.
 *
 * **Stored as a claim over a time range, and nothing is deleted.** The obvious
 * implementation — remove the fixes in between — is a documented trap, because
 * two fixes three hours apart do not describe a stay, they describe two moments
 * with a hole between them (see `core/compact`, and § 2's gap rule). But the
 * argument that actually settled the shape was simpler: on a frozen day the raw
 * fixes have been archived and the day's *segments* are what is stored, so
 * anything working by deleting fixes works only on today — and looking back at
 * a finished afternoon is exactly when somebody wants this.
 *
 * So the whole feature is expressed over `Segment[]`, which a freshly folded
 * day and a frozen one both already are. Nothing here reads a fix, an archive
 * or a clock. It is the same shape as `applyJourneyLabels` next door, for the
 * same reasons: a range is re-cut against whatever the day looks like now, so a
 * change of tracking preset cannot orphan it, and taking the claim away is a
 * complete undo because the thing underneath was never overwritten.
 */

/** Somewhere you were, for a stretch you are asserting rather than measuring. */
export interface StationaryClaim {
  /**
   * Derived from `startedAt`, never generated — `core` has no entropy source,
   * and it means claiming the same stretch twice replaces the claim rather than
   * stacking a second one over it.
   */
  readonly id: string;
  readonly startedAt: number;
  readonly endedAt: number;
  /** Where you were. The centre the collapsed stay is drawn at. */
  readonly at: LatLon;
}

export function stationaryClaimId(startedAt: number): string {
  return `stationary-${startedAt}`;
}

/** Why a stretch cannot be called stationary. */
export type MergeRefusal =
  /** Something in the middle took you further than `thresholdM` from the anchor. */
  | 'moved'
  /** A journey in the range already has a name, which is a sentence typed by hand. */
  | 'named'
  /** A photograph inside the range was taken somewhere else. */
  | 'capture-elsewhere'
  /** The two points are the same row, or arrive in the wrong order. */
  | 'no-range';

export interface MergeVerdict {
  readonly ok: boolean;
  readonly refusal: MergeRefusal | null;
  /**
   * How far the range actually got from the anchor, net of what the readings
   * could be wrong by. Reported whether or not the merge is allowed, because a
   * control that silently declines is the failure the transcription button
   * already taught this app: "you moved 400 m in the middle of this" is an
   * answer, and "nothing happened" is not.
   */
  readonly excursionM: number;
}

/** Everything the verdict needs, and deliberately not a fix among them. */
export interface MergeQuestion {
  readonly segments: readonly Segment[];
  readonly startedAt: number;
  readonly endedAt: number;
  /** Ceiling on real movement. `minMoveDistanceM` is the natural reuse. */
  readonly thresholdM: number;
  /**
   * What a single reading could be wrong by, from the **effective** preset —
   * passed in rather than looked up, because `core` reads no settings.
   */
  readonly readingErrorM: number;
  readonly labels?: readonly JourneyLabel[];
  /** Positions of anything captured inside the range: photographs know where they were. */
  readonly captures?: readonly LatLon[];
}

/**
 * Where the claim says you were: the centroid of the stays in range.
 *
 * The stays rather than everything, because a move's path is by definition the
 * part that was not standing still — averaging it in drags the dot along
 * whatever the drift did. Null when the range holds no stay at all, which is
 * the hole case, and the caller supplies the anchor from the row it started on.
 */
export function stationaryCentre(segments: readonly Segment[]): LatLon | null {
  const stays = segments.filter((segment): segment is StaySegment => segment.kind === 'stay');
  return centroid(stays.map((stay) => stay.center));
}

/**
 * How far a segment got from the anchor, net of the error in the readings.
 *
 * **Not `distanceM` for a move**, and that is the crux. Ground distance is the
 * sum of the steps, so a phone jittering in one place for an hour accumulates
 * hundreds of metres without ever having been anywhere else — using it would
 * refuse precisely the case this feature exists for. The question being asked
 * is "how far away did you get", so it is the furthest point on the path.
 *
 * A stay carries its own measured error in `radiusM` — literally how far its
 * fixes wandered from the first one — which is better than any constant. A move
 * has no such figure, so the allowance is the preset's.
 */
function excursionOf(segment: Segment, anchor: LatLon, readingErrorM: number): number {
  if (segment.kind === 'stay') {
    return Math.max(0, distanceM(anchor, segment.center) - segment.radiusM);
  }

  const furthest = segment.path.reduce((worst, point) => Math.max(worst, distanceM(anchor, point)), 0);
  return Math.max(0, furthest - readingErrorM);
}

/**
 * Whether this stretch can be called one stop, and how far it says you went.
 *
 * Pure, and pure over segments: no fixes, no archive, no clock. The refusals
 * are the interesting half — a merge that flattened a real drive would erase a
 * journey that happened, and there is no undo for a thing the app never knew.
 */
export function judgeStationaryClaim({
  segments,
  startedAt,
  endedAt,
  thresholdM,
  readingErrorM,
  labels = [],
  captures = [],
}: MergeQuestion): MergeVerdict {
  if (endedAt <= startedAt) return { ok: false, refusal: 'no-range', excursionM: 0 };

  const inside = segments.filter((segment) => segment.endedAt > startedAt && segment.startedAt < endedAt);
  if (inside.length < 2) return { ok: false, refusal: 'no-range', excursionM: 0 };

  // A name is a sentence somebody typed, and flattening the journey under it
  // would discard the one thing here nothing can reconstruct.
  const named = labels.some(
    (label) => label.endedAt > startedAt && label.startedAt < endedAt && (label.label ?? '').length > 0,
  );
  if (named) return { ok: false, refusal: 'named', excursionM: 0 };

  const anchor = stationaryCentre(inside) ?? (inside[0] as Segment & { center?: LatLon }).center ?? null;
  if (!anchor) return { ok: false, refusal: 'no-range', excursionM: 0 };

  const excursionM = inside.reduce((worst, segment) => Math.max(worst, excursionOf(segment, anchor, readingErrorM)), 0);
  if (excursionM > thresholdM) return { ok: false, refusal: 'moved', excursionM };

  // A photograph stores where it was taken, from a reading the fold never got
  // to reject — so it is evidence in its own right, and a pin somewhere else
  // inside the range contradicts the claim outright.
  const elsewhere = captures.some((at) => distanceM(anchor, at) - readingErrorM > thresholdM);
  if (elsewhere) return { ok: false, refusal: 'capture-elsewhere', excursionM };

  return { ok: true, refusal: null, excursionM };
}

/** Split every segment that straddles `at`, leaving the list contiguous. */
function splitAll(segments: readonly Segment[], at: number): readonly Segment[] {
  return segments.flatMap((segment) =>
    segment.startedAt < at && segment.endedAt > at ? splitSegment(segment, at) : [segment],
  );
}

/**
 * Collapse everything a claim covers into one stay.
 *
 * **A claim covering nothing emits nothing**, which is the rule
 * `applyJourneyLabels` learned the hard way: inventing a row from the claim's
 * own bounds when it found nothing inside is what printed hollow journeys on
 * days they had nothing to do with. A claim is made from rows that existed, so
 * finding none means the day was re-folded and they are gone. Silence is the
 * honest answer.
 *
 * The resulting stay's `radiusM` is the furthest the collapsed rows got from
 * the centre. That keeps it truthful: the claim says you did not leave, not
 * that the readings agreed with each other.
 */
export function applyStationaryClaims(
  segments: readonly Segment[],
  claims: readonly StationaryClaim[],
): readonly Segment[] {
  let result = [...segments];

  for (const claim of [...claims].sort((a, b) => a.startedAt - b.startedAt)) {
    if (claim.endedAt <= claim.startedAt) continue;

    result = [...splitAll(splitAll(result, claim.startedAt), claim.endedAt)];

    const covered = (segment: Segment) => segment.startedAt >= claim.startedAt && segment.endedAt <= claim.endedAt;
    const inside = result.filter(covered);
    if (inside.length === 0) continue;

    const outside = result.filter((segment) => !covered(segment));
    const first = inside[0] as Segment;
    const last = inside[inside.length - 1] as Segment;

    const stay: StaySegment = {
      kind: 'stay',
      // From the claim, so the row is the same row every fold and the id is
      // what carries "this one was merged" back to the screen.
      id: claim.id,
      startedAt: first.startedAt,
      endedAt: last.endedAt,
      fixCount: inside.reduce((total, segment) => total + segment.fixCount, 0),
      center: claim.at,
      radiusM: inside.reduce((worst, segment) => Math.max(worst, spreadOf(segment, claim.at)), 0),
    };

    result = [...outside, stay].sort((a, b) => a.startedAt - b.startedAt);
  }

  return result;
}

/** How far a collapsed row reached from the claimed centre. */
function spreadOf(segment: Segment, centre: LatLon): number {
  if (segment.kind === 'stay') return distanceM(centre, segment.center) + segment.radiusM;
  return segment.path.reduce((worst, point) => Math.max(worst, distanceM(centre, point)), 0);
}

/**
 * Whether a row on screen was made by a claim, which is what makes undo a long
 * press on the row rather than a hunt through a list.
 *
 * The withdrawn merge feature's recorded objection was exactly this: "undoing
 * meant finding the label behind a row by its id". Here the row *is* the
 * claim's id, so the row knows what made it.
 */
export function claimBehind(segment: Segment, claims: readonly StationaryClaim[]): StationaryClaim | null {
  return claims.find((claim) => claim.id === segment.id) ?? null;
}
