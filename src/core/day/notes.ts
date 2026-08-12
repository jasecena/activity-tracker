import type { LatLon } from '../geo';
import { isStoredFileName } from '../media/fileName';
import type { Segment } from '../segments';

import { dayKeyOf, startOfLocalDay, type DayGroup, type TzOffsetMinutes } from './day';

/**
 * A recording attached to a note: the same entry, said rather than typed.
 *
 * **A voice note is a note.** It used to be a capture — filed beside the photos
 * and the video, opened from the Media tab, counted as something the camera
 * produced. That was filing it by the hardware it came out of rather than by
 * what it is. Saying something about a day and writing it down are the same act
 * with different hands, and the transcription in `docs/BACKLOG.md` § 15 makes
 * that literal: the text it produces belongs *on the note*, beside whatever was
 * typed, not on a row in a gallery.
 *
 * So the recording is a field of `DayNote` rather than a record of its own. It
 * inherits everything the diary already decided — retention never deletes one,
 * the trust boundary repairs rather than drops, it is in the CSV — and none of
 * it has to be decided a second time.
 *
 * The bytes are not here. `services/noteAudio.ts` owns the file, exactly as
 * `services/mediaStore.ts` owns a capture's; this is the name of it and the
 * facts a screen needs before deciding whether to open it.
 */
export interface NoteVoice {
  /**
   * `voice-<startedAt>.m4a` in the diary's audio directory. Derived from the
   * instant the recording began, like every other id in this app, so a file
   * interrupted between being written and being referenced says what it was.
   */
  readonly fileName: string;
  /** How long it runs, in ms. What the play button says before it is pressed. */
  readonly durationMs: number;
  /** Size on disk. What the Data screen counts. */
  readonly byteLength: number;
  /**
   * Where you were when you **started** talking, or null if the platform would
   * not say.
   *
   * The start rather than the end, for the reason `useVoiceNote` keeps it in a
   * ref: a minute of talking while walking otherwise gets stamped wherever you
   * finished, which is the one place it definitely was not begun.
   */
  readonly at: LatLon | null;
}

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
  /** The body. Empty when the note is a title or a recording; see `noteAt`. */
  readonly text: string;
  /**
   * What was said aloud, or null.
   *
   * A third way of writing the same entry rather than a different kind of row.
   * A note may be a recording and nothing else — talking is how you write
   * something down while walking — and it may be a recording *and* a
   * paragraph, which is what happens the moment you go back and add to it.
   */
  readonly voice: NoteVoice | null;
}

export function dayNoteId(at: number): string {
  return `note-${at}`;
}

/**
 * What sits between what was already written and what was just transcribed.
 *
 * An em dash on its own line, deliberately not `---` or any other Markdown: a
 * note is plain text and nothing renders it, so a marker has to read as a break
 * to a person rather than to a parser. It is also direction-neutral, which
 * matters when the text either side of it is Persian.
 */
export const TRANSCRIPT_SEPARATOR = '\n\n—\n\n';

/**
 * Put a transcript at the end of what a note already says.
 *
 * **Append, never replace, and that is the whole safety of transcription.** The
 * recording stays on the note and the text it produced lands underneath
 * whatever was there — so a bad transcript costs a paragraph you delete by
 * hand, and no press of a button can ever eat something you wrote. It is the
 * same conclusion `docs/BACKLOG.md` § 15 reached from the other direction: the
 * audio is the record and the text is a reading of it, so the reading is never
 * allowed to overwrite the record or the writing beside it.
 *
 * Transcribing twice therefore appends twice, on purpose. A transcript you want
 * a second attempt at is common — the first one misheard a name, the room was
 * loud — and the honest way to offer that is to add the new attempt and let you
 * throw away the one you like less.
 *
 * Two edges, both of which happen constantly rather than in theory:
 *
 * **A note that is only a recording gets no separator.** That is the ordinary
 * case for this feature — you talked, you never typed — and a note opening with
 * a dash above its first line would be the app's punctuation, not yours.
 *
 * **A transcript of silence adds nothing at all.** Scribe answers an empty
 * string for a recording with no speech in it, and appending a separator to
 * nothing would leave a dash floating under the text with no explanation.
 */
export function appendTranscript(text: string, transcript: string): string {
  const addition = transcript.trim();
  if (addition.length === 0) return text;

  const body = text.trim();
  if (body.length === 0) return addition;

  return `${body}${TRANSCRIPT_SEPARATOR}${addition}`;
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
 * **Any one field is enough.** A title with no body is a perfectly good entry —
 * "Moved house" says the day — and so is a paragraph nobody wanted to name, and
 * so is thirty seconds of talking with neither. Requiring more would be the app
 * deciding how somebody keeps a diary.
 */
export function noteAt(at: number, title: string, text: string, voice: NoteVoice | null = null): DayNote | null {
  const heading = title.trim();
  const body = text.trim();
  if (heading.length === 0 && body.length === 0 && voice === null) return null;
  return { id: dayNoteId(at), at, title: heading, text: body, voice };
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
  const { id, at } = candidate as Partial<DayNote>;
  if (typeof id !== 'string') return false;
  return typeof at === 'number' && Number.isFinite(at);
}

function isLatLon(candidate: unknown): candidate is LatLon {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { lat, lon } = candidate as Partial<LatLon>;
  return typeof lat === 'number' && Number.isFinite(lat) && typeof lon === 'number' && Number.isFinite(lon);
}

/**
 * A stored recording, or null.
 *
 * The file name is the one field with no repair available: a name that is not a
 * name points at nothing this app wrote, and the service would join it onto a
 * directory. Everything else is a fact *about* the recording — how long, how
 * large, where — and a note whose recording has lost its duration is still a
 * recording you can play, so those default rather than discarding it.
 */
function readVoice(candidate: unknown): NoteVoice | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const { fileName, durationMs, byteLength, at } = candidate as Partial<NoteVoice>;
  if (!isStoredFileName(fileName)) return null;

  return {
    fileName,
    durationMs: typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0,
    byteLength: typeof byteLength === 'number' && Number.isFinite(byteLength) && byteLength >= 0 ? byteLength : 0,
    at: isLatLon(at) ? { lat: at.lat, lon: at.lon } : null,
  };
}

/**
 * The trust boundary for the notes.
 *
 * Anything unrecognisable is dropped rather than repaired, as everywhere else —
 * but the bar for "unrecognisable" is deliberately low here, and lower than it
 * is for a fix or a segment. A malformed reading can be thrown away because
 * thousands more are coming; a note is the one thing in this store that nobody
 * and nothing can reconstruct. So a note with a finite instant is kept even if
 * its id is something no build ever wrote, and the id is rebuilt from the
 * instant rather than the row being discarded over it.
 *
 * The same reasoning is why nothing here requires a *text*. Titles arrived
 * after the first notes did and recordings after those, so an entry may hold
 * any one of the three; insisting on the field that happened to come first
 * would discard the two that came later. `noteAt` is the only thing that
 * decides a row says nothing, and it says so only when all three are empty.
 */
export function normalizeDayNotes(input: unknown): DayNote[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isNote)
    .flatMap((note) => {
      const built = noteAt(
        note.at ?? 0,
        typeof note.title === 'string' ? note.title : '',
        typeof note.text === 'string' ? note.text : '',
        readVoice(note.voice),
      );
      return built ? [built] : [];
    })
    .sort((a, b) => a.at - b.at);
}

/**
 * Every audio file the diary owns — what a sweep must be told to keep.
 *
 * The same shape as `filesOf` over the media index, and it exists for the same
 * reason: a recording made and then abandoned (the sheet closed without saving,
 * a note re-recorded before it was written) leaves a file nothing points at,
 * and a directory nobody sweeps only ever grows. Built here so no caller has to
 * remember what a note can own.
 */
export function voiceFilesOf(notes: readonly DayNote[]): readonly string[] {
  return notes.flatMap((note) => (note.voice ? [note.voice.fileName] : []));
}
