import { applyVisitPurposes, purposeFrom, purposesForStay, visitPurposeId, PURPOSE_SEPARATOR } from '../visits';
import type { MoveSegment, Segment, StaySegment, VisitPurpose } from '../index';

/**
 * Why you were somewhere: the stay's counterpart to a journey's name.
 *
 * The engine can say you were at a coordinate for fifty minutes. The place list
 * can say the coordinate is called the shopping centre, and it says that every
 * time you go. Only you can say this visit was for groceries — which is exactly
 * why it cannot live on the `Place`, and why these tests are mostly about the
 * timeline being re-cut underneath a record that has to survive it.
 *
 * Fixtures at the equator, per the repository rule: a coordinate from a real
 * track is a permanent record of where its author was.
 */

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const HOUR = 3_600_000;

function stay(startedAt: number, endedAt: number): StaySegment {
  return {
    kind: 'stay',
    id: `seg-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 20,
    center: { lat: 0, lon: 0 },
    radiusM: 8,
    purpose: null,
  };
}

function move(startedAt: number, endedAt: number): MoveSegment {
  return {
    kind: 'move',
    id: `seg-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 20,
    distanceM: 4000,
    mode: 'drive',
    modeIsManual: false,
    label: null,
    path: [],
    topSpeedMps: 14,
  };
}

const purposesOf = (segments: readonly Segment[]) =>
  segments.flatMap((segment) => (segment.kind === 'stay' ? [segment.purpose] : []));

describe('writing one down', () => {
  it('derives the id from the stop, so saying why twice replaces rather than stacks', () => {
    const first = purposeFrom(stay(T0, T0 + HOUR), 'Groceries');
    const second = purposeFrom(stay(T0, T0 + HOUR), 'Groceries and a haircut');

    expect(first?.id).toBe(visitPurposeId(T0));
    expect(second?.id).toBe(first?.id);
  });

  it('carries both ends, so nothing has to guess where the stop was', () => {
    expect(purposeFrom(stay(T0, T0 + HOUR), 'Groceries')).toEqual({
      id: visitPurposeId(T0),
      purpose: 'Groceries',
      startedAt: T0,
      endedAt: T0 + HOUR,
    });
  });

  /** Blank is the absence of a purpose, which is how clearing the field deletes it. */
  it('is nothing at all when nothing was said', () => {
    expect(purposeFrom(stay(T0, T0 + HOUR), '   ')).toBeNull();
    expect(purposeFrom(stay(T0, T0 + HOUR), '')).toBeNull();
  });
});

describe('putting it back on the timeline', () => {
  it('describes the stop it was written about', () => {
    const written = purposeFrom(stay(T0, T0 + HOUR), 'Groceries') as VisitPurpose;

    expect(purposesOf(applyVisitPurposes([stay(T0, T0 + HOUR)], [written]))).toEqual(['Groceries']);
  });

  /**
   * Saying why is a thing you do to a *stop*. The drive there is the drive
   * there, and it has `label` for what it was.
   */
  it('leaves journeys alone', () => {
    const written = purposeFrom(stay(T0, T0 + HOUR), 'Groceries') as VisitPurpose;
    const timeline = applyVisitPurposes([move(T0, T0 + HOUR)], [written]);

    expect(timeline).toEqual([move(T0, T0 + HOUR)]);
  });

  /**
   * The same rule `applyJourneyLabels` learned the hard way: it does not invent
   * a row from its own bounds. A purpose whose stop is gone — the fixes pruned,
   * a new preset folding them differently — is silent rather than fabricated.
   */
  it('says nothing when the stop it was about is gone', () => {
    const written = purposeFrom(stay(T0, T0 + HOUR), 'Groceries') as VisitPurpose;
    const elsewhere = stay(T0 + 5 * HOUR, T0 + 6 * HOUR);

    expect(applyVisitPurposes([elsewhere], [written])).toEqual([elsewhere]);
  });

  it('leaves the timeline untouched when nothing has been written', () => {
    const timeline = [stay(T0, T0 + HOUR)];

    expect(applyVisitPurposes(timeline, [])).toBe(timeline);
  });
});

/**
 * **The three ways the timeline is re-cut underneath a stored range**, which is
 * why the match is on the purpose's midpoint rather than on either end: a
 * stationary claim merges stops, a journey label splits one, and a change of
 * preset re-folds the lot. An end-to-end comparison breaks under all three; a
 * midpoint lands inside exactly one of whatever the stays have become.
 */
describe('surviving the timeline being re-cut', () => {
  it('still finds its stop when the stop has grown around it', () => {
    const written = purposeFrom(stay(T0 + HOUR, T0 + 2 * HOUR), 'Groceries') as VisitPurpose;
    // What a stationary claim leaves behind: one long stay over the whole span.
    const merged = stay(T0, T0 + 4 * HOUR);

    expect(purposesOf(applyVisitPurposes([merged], [written]))).toEqual(['Groceries']);
  });

  it('lands on one half when its stop has been split in two', () => {
    const written = purposeFrom(stay(T0, T0 + 2 * HOUR), 'Groceries') as VisitPurpose;
    // Midpoint is T0 + 1h, which falls in the first half.
    const halves = [stay(T0, T0 + 90 * 60_000), stay(T0 + 90 * 60_000, T0 + 2 * HOUR)];

    expect(purposesOf(applyVisitPurposes(halves, [written]))).toEqual(['Groceries', null]);
  });

  /**
   * Several purposes on one stay is what a merge leaves behind — an afternoon
   * that was three stops with three reasons. All of them are kept rather than
   * the first: silently dropping two of somebody's sentences to make a display
   * tidier is not a trade this app makes.
   */
  it('joins every reason when a claim has merged the stops they were about', () => {
    const written = [
      purposeFrom(stay(T0, T0 + HOUR), 'Groceries'),
      purposeFrom(stay(T0 + HOUR, T0 + 2 * HOUR), 'Haircut'),
      purposeFrom(stay(T0 + 2 * HOUR, T0 + 3 * HOUR), 'Met Sam'),
    ].flatMap((one) => (one ? [one] : []));

    const merged = applyVisitPurposes([stay(T0, T0 + 3 * HOUR)], written);

    expect(purposesOf(merged)).toEqual([['Groceries', 'Haircut', 'Met Sam'].join(PURPOSE_SEPARATOR)]);
  });

  it('reads a merged stop in the order the afternoon happened', () => {
    const written = [
      purposeFrom(stay(T0 + 2 * HOUR, T0 + 3 * HOUR), 'Met Sam'),
      purposeFrom(stay(T0, T0 + HOUR), 'Groceries'),
    ].flatMap((one) => (one ? [one] : []));

    expect(purposesForStay(written, stay(T0, T0 + 3 * HOUR)).map((one) => one.purpose)).toEqual([
      'Groceries',
      'Met Sam',
    ]);
  });
});
