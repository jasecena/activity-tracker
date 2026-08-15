import type { Segment, StaySegment } from './types';

/**
 * Why you were somewhere.
 *
 * **The stay's counterpart to a `JourneyLabel`**, and deliberately the same
 * shape: a record of something you told the app, kept on its own and applied
 * over a freshly derived timeline rather than written into it.
 *
 * What it adds is the one thing neither the engine nor the place list can
 * answer. The engine knows you stopped at a coordinate for fifty minutes. The
 * place list knows those coordinates are called "the shopping centre", and it
 * knows that every time you go. Neither knows you went for groceries — and that
 * changes per visit, which is exactly why it cannot live on the `Place`: the
 * haircut on Saturday would overwrite the groceries on Tuesday.
 *
 * It is also not a `DayNote`, and the distinction is worth keeping sharp. A
 * diary entry is about a *day*: it lives in the diary indexed by the date,
 * several per day, with a title, a recording, a picture and a life of its own.
 * A purpose is one line about one stop, and its entire value is that it appears
 * beside that stop wherever the stop appears — the timeline row, the visit list
 * under the place, the `label` column of the export. Filing it in the diary
 * would put it somewhere you would have to go and look for it.
 *
 * Stored as a **time range, never a segment id**, for the reason
 * `core/segments/manual.ts` gives at length: segments are re-derived from the
 * fix buffer whenever they are needed, and a different tracking preset folds the
 * same fixes into different stays, so an id would be orphaned by a settings
 * change. A range is re-matched against whatever the day looks like now.
 */
export interface VisitPurpose {
  /**
   * Derived from `startedAt`, never generated — the same rule as segment ids,
   * so saying why twice about one stop updates one record rather than making
   * two.
   */
  readonly id: string;
  /** What you were there for. Never empty: `purposeFrom` returns null instead. */
  readonly purpose: string;
  readonly startedAt: number;
  readonly endedAt: number;
}

export function visitPurposeId(startedAt: number): string {
  return `v-${startedAt}`;
}

/**
 * A purpose made from the stop it is about, or null when nothing was said.
 *
 * Made *from* a stay, as a `JourneyLabel` is made from a journey, so it has both
 * ends and always had something behind it. Blank is the absence of a purpose
 * rather than an empty one — which is how clearing the field deletes the record
 * instead of storing a row that says nothing.
 */
export function purposeFrom(stay: StaySegment, purpose: string): VisitPurpose | null {
  const said = purpose.trim();
  if (said.length === 0) return null;
  return { id: visitPurposeId(stay.startedAt), purpose: said, startedAt: stay.startedAt, endedAt: stay.endedAt };
}

/**
 * The middle of a range.
 *
 * Matching on the **midpoint** rather than on either end is what makes this
 * survive the timeline being re-cut underneath it, which happens for three
 * ordinary reasons: a stationary claim merges several stops into one, a journey
 * label splits one, or a change of preset re-folds the lot. An end-to-end
 * comparison breaks under all three; a midpoint lands inside exactly one of
 * whatever the stays have become.
 */
function midpoint(range: { readonly startedAt: number; readonly endedAt: number }): number {
  return range.startedAt + (range.endedAt - range.startedAt) / 2;
}

/**
 * Every purpose that belongs to this stay.
 *
 * Usually none or one. Several happens when a stationary claim has merged the
 * stops they were written about — "I was here the whole time" over an afternoon
 * that was three stays with three reasons — and all of them are returned rather
 * than the first, because silently dropping two of somebody's sentences to make
 * a display tidier is not a trade this app makes.
 *
 * Oldest first, so a joined line reads in the order the afternoon happened.
 */
export function purposesForStay(purposes: readonly VisitPurpose[], stay: StaySegment): readonly VisitPurpose[] {
  return purposes
    .filter((purpose) => {
      const at = midpoint(purpose);
      return at >= stay.startedAt && at <= stay.endedAt;
    })
    .sort((a, b) => a.startedAt - b.startedAt);
}

/** What several purposes read as on one row. */
export const PURPOSE_SEPARATOR = ' · ';

/**
 * Put every purpose onto the stay it belongs to.
 *
 * No clock, like everything else in `core`: a purpose has both ends, so this
 * gives the same answer for a live day and a frozen one.
 *
 * **A purpose matching no stay emits nothing**, which is the same rule
 * `applyJourneyLabels` learned the hard way — it does not invent a row from its
 * own bounds. A purpose whose stop is gone (the fixes were pruned, a new preset
 * folded them differently) is silent rather than fabricated, and it stays in the
 * store: the stop may well come back, and a sentence somebody wrote is not
 * something to discard because a threshold moved.
 *
 * Moves pass through untouched. Saying why is a thing you do to a *stop* — the
 * drive there is the drive there, and it has `label` for what it was.
 */
export function applyVisitPurposes(
  segments: readonly Segment[],
  purposes: readonly VisitPurpose[],
): readonly Segment[] {
  if (purposes.length === 0) return segments;

  return segments.map((segment) => {
    if (segment.kind !== 'stay') return segment;

    const found = purposesForStay(purposes, segment);
    if (found.length === 0) return segment;

    return { ...segment, purpose: found.map((one) => one.purpose).join(PURPOSE_SEPARATOR) };
  });
}
