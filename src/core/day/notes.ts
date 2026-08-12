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
 * **Timestamped and several per day, but filed under the day rather than
 * threaded through it.** Both halves of that matter. The time is kept because
 * some notes are about a moment — the thing that happened at four o'clock —
 * and several are allowed because a diary you can only write once a day is one
 * you write in arrears or not at all.
 *
 * What they are *not* is timeline rows. Notes were interleaved between the
 * stays and journeys for one release and read wrong: a timeline is a record of
 * where the phone was, minute by minute, and a sentence dropped into it arrived
 * as another reading the app had taken. The date is what a diary is indexed by;
 * the time is a detail within the day. So they get their own section, in time
 * order, above the day the app measured — and `notesForDay` is the whole of
 * what a day needs to draw them.
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
  /**
   * What the entry is called, or empty.
   *
   * Empty is a real state rather than a missing one. A title is what makes a
   * diary readable at a glance — "Sam's birthday" over four lines about a
   * birthday — but insisting on one turns a jotted line into a form to fill in,
   * and the note you do not write because it wanted a heading is worse than an
   * untitled one. So it is offered first and required never.
   */
  readonly title: string;
  /** The body. Empty only when there is a title; see `noteAt`. */
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
 * Blank is not an empty note, it is the absence of one. A row holding nothing
 * is a thing you cannot see, cannot tap accurately and cannot explain, and the
 * store is better off without it — the same reasoning that drops a journey
 * label saying nothing.
 *
 * **Either field is enough.** A title with no body is a perfectly good entry —
 * "Moved house" says the day — and so is a paragraph nobody wanted to name.
 * Requiring both would be the app deciding how somebody keeps a diary.
 */
export function noteAt(at: number, title: string, text: string): DayNote | null {
  const heading = title.trim();
  const body = text.trim();
  if (heading.length === 0 && body.length === 0) return null;
  return { id: dayNoteId(at), at, title: heading, text: body };
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

function isNote(candidate: unknown): candidate is Partial<DayNote> {
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
    .flatMap((note) => {
      // Titles arrived after the first notes did, so a stored entry may have
      // none — which is a missing field, not a broken row, and the body is the
      // part that could never be reconstructed. Defaulted rather than dropped.
      const built = noteAt(note.at ?? 0, typeof note.title === 'string' ? note.title : '', note.text ?? '');
      return built ? [built] : [];
    })
    .sort((a, b) => a.at - b.at);
}
