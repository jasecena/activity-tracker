import type { Segment } from '../segments';

import { dayKeyOf, startOfLocalDay, type DayGroup, type TzOffsetMinutes } from './day';

/**
 * What you wrote down about a day.
 *
 * The one thing in this app that is not derived from anything. Every other row
 * on a timeline is the fold's reading of a fix stream — where you were, how
 * fast, how far — and none of it can say what the day was *like*, or who you
 * were with, or that the long way home was on purpose. A note is the part only
 * its author has.
 *
 * **Timestamped and several per day, not one entry per date.** A diary page
 * would have been the smaller model, but the app already knows the shape of a
 * day down to the minute, and a note dropped between the walk and the café
 * reads as part of that day rather than as a paragraph filed under it. It is
 * also the difference between something you write once, in the evening, if you
 * remember — and something you jot as you go.
 *
 * **Retention never deletes one.** `retentionDays` reaches the day log and the
 * fix archive and stops, and a note is emphatically on the far side of that
 * line: it is the same rule that keeps captures — a fix is something the app
 * collected on its own and may discard on its own, a note is something you sat
 * down and wrote. Deleting that on a timer is not the app's call. So a day
 * whose segments have aged out can still have its note, which is the right way
 * round: the readings were the disposable half all along.
 */
export interface DayNote {
  /**
   * `note-<at>`, derived rather than generated — `core` has no entropy source
   * and this rule is why. Editing a note keeps its instant and therefore its
   * id, so it updates one row rather than leaving the old one behind.
   */
  readonly id: string;
  /**
   * Epoch milliseconds: the moment the note is *about*, which is where it sits
   * in the day.
   *
   * The wall clock, not `monotonicNow`, and for the same reason a fix is
   * stamped that way — which day a note belongs to is a wall-clock fact, and
   * monotonic time has no answer to "which Tuesday".
   */
  readonly at: number;
  /** Never empty. A note with nothing in it is not stored; see `noteAt`. */
  readonly text: string;
}

export function dayNoteId(at: number): string {
  return `note-${at}`;
}

/**
 * The instant to file a new note under, given the ones already written.
 *
 * Ids are derived from the instant, so two notes sharing one would be a single
 * note that silently ate the other. Nudging forward a millisecond at a time is
 * enough: it is deterministic, it keeps `core` free of entropy, and the only
 * case where it ever advances more than once is a past day being annotated
 * repeatedly, where the wanted instant is the same every time.
 */
export function freeInstant(notes: readonly DayNote[], wanted: number): number {
  const taken = new Set(notes.map((note) => note.at));
  let at = wanted;
  while (taken.has(at)) at += 1;
  return at;
}

/**
 * Write one, or `null` if there is nothing to write.
 *
 * Blank is not an empty note, it is the absence of one. A row holding no text
 * is a thing you cannot see, cannot tap accurately and cannot explain, and the
 * store is better off without it — the same reasoning that drops a journey
 * label saying nothing.
 */
export function noteAt(at: number, text: string): DayNote | null {
  const trimmed = text.trim();
  if (trimmed.length === 0) return null;
  return { id: dayNoteId(at), at, text: trimmed };
}

/**
 * Where a new note on `dayKey` sits **unless you say otherwise**.
 *
 * Now, when now is inside that day — you are writing about today as it happens,
 * and the note belongs where you are in it. Otherwise the day is finished and
 * being looked back on, so the note goes at its **end**: after the last thing
 * that happened, which is where an evening's reflection belongs. Local noon is
 * the fallback for a day with nothing in it, because the start of a local day
 * is midnight and a note stamped midnight reads as belonging to the day before.
 *
 * A default rather than a rule: the sheet offers a date and a time you can
 * change, because the moment you write something down and the moment it is
 * about are routinely different — and a diary that can only be written in the
 * present is a diary you have to keep up with.
 */
export function whereToWrite(
  dayKey: string,
  segments: readonly Segment[],
  now: number,
  tzOffsetMinutes: TzOffsetMinutes,
): number {
  if (dayKeyOf(now, tzOffsetMinutes) === dayKey) return now;

  const last = segments[segments.length - 1];
  if (last) return last.endedAt;

  const first = segments[0];
  const inside = first ? first.startedAt : now;
  return startOfLocalDay(inside, tzOffsetMinutes) + 12 * 3_600_000;
}

/** The notes belonging to one local day, in the order they were written. */
export function notesForDay(
  notes: readonly DayNote[],
  dayKey: string,
  tzOffsetMinutes: TzOffsetMinutes,
): readonly DayNote[] {
  return notes.filter((note) => dayKeyOf(note.at, tzOffsetMinutes) === dayKey).sort((a, b) => a.at - b.at);
}

/** A row on a day's timeline: something the app recorded, or something you wrote. */
export type DayEntry =
  | { readonly kind: 'segment'; readonly at: number; readonly segment: Segment }
  | { readonly kind: 'note'; readonly at: number; readonly note: DayNote };

/**
 * One list, in time order, of everything a day holds.
 *
 * A note sorts by the instant it is about and a segment by the instant it
 * began. **A segment wins a tie**, deliberately: a note written at the moment a
 * journey starts is a remark about that journey, and reading it above the row it
 * refers to would be backwards.
 *
 * Nothing here is stored. This is the same kind of thing `applyJourneyLabels`
 * does — the notes are kept as their own records, and the combined view is
 * rebuilt whenever it is drawn, so a re-derived day cannot lose one or double
 * one up.
 */
export function withNotes(segments: readonly Segment[], notes: readonly DayNote[]): readonly DayEntry[] {
  const entries: DayEntry[] = [
    ...segments.map((segment): DayEntry => ({ kind: 'segment', at: segment.startedAt, segment })),
    ...notes.map((note): DayEntry => ({ kind: 'note', at: note.at, note })),
  ];

  // A stable sort, which `Array.prototype.sort` has been required to be since
  // ES2019 — so equal instants keep the order they were built in, and that
  // order puts segments first.
  return entries.sort((a, b) => a.at - b.at);
}

/**
 * Every day worth being able to open: the ones the app recorded, the ones you
 * wrote about, and today.
 *
 * `groupByDay` builds its list out of segments, so a day the app recorded
 * nothing on does not exist as far as the Day screen is concerned — there is no
 * arrow to it and no page for it. That was fine while a day *was* its segments.
 * It stops being fine the moment a day can hold a sentence instead, and it fails
 * in the two cases that matter most: a fresh install, where there is nothing at
 * all and so nowhere to write; and a day spent somewhere with no signal, which
 * is exactly the day worth describing rather than measuring.
 *
 * Today is always here for the same reason. A day is not a thing the app
 * grants you once it has collected enough readings to justify one.
 */
export function daysWorthOpening(
  days: readonly DayGroup[],
  notes: readonly DayNote[],
  now: number,
  tzOffsetMinutes: TzOffsetMinutes,
): readonly DayGroup[] {
  const byKey = new Map(days.map((day) => [day.key, day]));

  for (const at of [...notes.map((note) => note.at), now]) {
    const key = dayKeyOf(at, tzOffsetMinutes);
    if (byKey.has(key)) continue;
    byKey.set(key, { key, startedAt: startOfLocalDay(at, tzOffsetMinutes), segments: [] });
  }

  return [...byKey.values()].sort((a, b) => b.startedAt - a.startedAt);
}

function isNote(candidate: unknown): candidate is DayNote {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { id, at, text } = candidate as Partial<DayNote>;
  if (typeof id !== 'string' || typeof text !== 'string') return false;
  return typeof at === 'number' && Number.isFinite(at);
}

/**
 * The trust boundary for the notes.
 *
 * Anything unrecognisable is dropped rather than repaired, as everywhere else —
 * but the bar for "unrecognisable" is deliberately low here, and lower than it
 * is for a fix or a segment. A malformed reading can be thrown away because
 * thousands more are coming; a note is the one thing in this store that nobody
 * and nothing can reconstruct. So a note with a text and a finite instant is
 * kept even if its id is something no build ever wrote, and the id is rebuilt
 * from the instant rather than the row being discarded over it.
 */
export function normalizeDayNotes(input: unknown): DayNote[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isNote)
    .map((note) => ({ id: dayNoteId(note.at), at: note.at, text: note.text.trim() }))
    .filter((note) => note.text.length > 0)
    .sort((a, b) => a.at - b.at);
}
