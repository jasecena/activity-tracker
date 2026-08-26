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
 * with different hands, and the transcription in the backlog’s § 15 makes
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
  /**
   * Kept, deliberately, against being recorded over or deleted.
   *
   * **A guard rather than a vault.** Recording over one already on a note asks
   * first — it has since the feature shipped — but a dialog is only ever as good
   * as the attention paid to it, and a recording is the one thing on a note that
   * nothing can reconstruct: the words survive a bad transcription, the audio
   * survives nothing. Somebody with half a minute of a voice they will not hear
   * again wants a stronger answer than being asked.
   *
   * So this closes both doors at once. Locked, the microphone will not start and
   * the delete button is not offered; unlocking is one tap and asks nothing,
   * because the lock is what makes the destruction deliberate and a confirmation
   * on *undoing* a guard is a dialog in front of the thing the control is for.
   * Two acts to destroy, one to allow — the same shape as the swipe that reveals
   * Delete on a note row rather than deleting it.
   *
   * The cost is stated and accepted: a locked note cannot gain a new recording.
   * Recording elsewhere is always available — the microphone on the Notes tab
   * files a note of its own — so nothing here stands between somebody and saying
   * something.
   */
  readonly locked: boolean;
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
/**
 * What an entry is *for*: something that happened, or something you want to.
 *
 * **A diary entry looks backwards and a plan looks forwards, and that is the
 * whole of the difference.** "Went to the beach, it was lovely" is a record of a
 * day; "start doing affirmations in the morning" is not a record of anything —
 * it is a thing you said out loud so that you would not lose it. Both are a
 * sentence somebody sat down and wrote, both are unreconstructable, and both
 * want the same title, body, recording and instant. So a plan is a `DayNote`
 * with a different `kind` rather than a second store.
 *
 * **A second store would have cost a third sweep.** `sweepNoteAudio` already
 * keeps the diary's recordings and `sweepOrphans` already deletes anything in
 * the media directory its index has never heard of — which is precisely the
 * race that forced note audio into a directory of its own. A third directory
 * would be a third index, a third sweep and a third chance to delete somebody's
 * recording on launch. One field has none of that: the recording is already
 * swept, already repaired by `normalizeDayNotes`, already spared by retention,
 * already in the CSV export and already in the backup.
 *
 * It is the field that decides which list an entry appears in, and nothing else
 * in `core` reads it. That is deliberate — `splitAtNow`, `groupNotesByDay` and
 * `noteAt` all treat the two identically, because the arithmetic of "which day
 * is this about" does not change with what the entry is for.
 */
export type NoteKind = 'note' | 'plan';

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
  /**
   * The capture this note is about, by id, or null.
   *
   * **A reference, never ownership, and the two have separate lives.** Forget
   * the photograph and the note stays — it is a sentence somebody wrote, and
   * losing it because a file was deleted would be the app throwing away the
   * half it cannot reconstruct to tidy up the half it can. Delete the note and
   * the photograph stays, for the mirror of the same reason: a capture is
   * something you chose to take, and a note about it is a second thing you
   * chose to write, not a container it lives in.
   *
   * That is why the link lives **here rather than on the `MediaItem`**, and it
   * is what makes the whole feature cost so little. The media index is the
   * app's own record of files on disk; `sweepOrphans` deletes anything in the
   * directory it has never heard of, `filesOf` builds the list it is told to
   * keep, and retention has its own opinion about all of it. Putting a pointer
   * in there would have made a note's existence a fact the sweep had to know
   * about. Pointing the other way, none of those functions change at all: the
   * diary already knows how to keep something forever, and this is one more
   * field it keeps.
   *
   * A dangling id is therefore an ordinary state rather than corruption, and
   * every reader is written to expect it. The screens say the picture has been
   * deleted rather than pretending there was never one — which is a fact about
   * the note, and the note is the thing that survived.
   *
   * **It cannot make a note on its own.** See `noteAt`: a title, a paragraph or
   * a recording each say the day by themselves, and a bare pointer at a
   * photograph says nothing that opening the photograph would not. A note that
   * is only a link is a blank row in the diary with a thumbnail on it.
   */
  readonly mediaId: string | null;
  /**
   * A diary entry, or something you want to happen. See `NoteKind`.
   *
   * Required rather than optional, and defaulted in `normalizeDayNotes` rather
   * than here, so that every reader gets a definite answer and none of them has
   * to spell "or undefined". Everything written before this field existed reads
   * back as `'note'`, which is exactly what it was.
   */
  readonly kind: NoteKind;
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
 * same conclusion the backlog’s § 15 reached from the other direction: the
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

  // **The same words, twice, is never what anybody meant.**
  //
  // Two independent callers append: the automatic plan queue and the Transcribe
  // button on the note sheet. Neither knows about the other, and the queue can
  // reach the same recording twice — it appends the words first and records
  // "already asked" afterwards, so a phone put to sleep in that window comes
  // back, sees an unmarked recording, asks ElevenLabs again and appends the
  // identical answer under the first one. Pressing Transcribe on a plan the
  // queue already did lands in the same place from the other direction.
  //
  // Guarding here rather than at either call site is what makes it hold for
  // both, and for whatever appends next. It is not a guess about which caller
  // is at fault: appending a transcript a note already ends with is wrong
  // whoever asks for it, because the recording it came from has not changed.
  //
  // Only the tail is compared. The same sentence occurring earlier in a long
  // note is an ordinary repetition somebody said twice, and eating that would
  // be a worse bug than the one this fixes.
  if (body === addition || body.endsWith(`${TRANSCRIPT_SEPARATOR}${addition}`)) return text;

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
export function noteAt(
  at: number,
  title: string,
  text: string,
  voice: NoteVoice | null = null,
  mediaId: string | null = null,
  kind: NoteKind = 'note',
): DayNote | null {
  const heading = title.trim();
  const body = text.trim();
  // **The capture is deliberately not in this test.** A title says the day, so
  // does a paragraph, so does half a minute of talking — and a bare pointer at
  // a photograph says only what opening the photograph would say. A note that
  // is nothing but a link is a blank row in the diary with a thumbnail on it.
  if (heading.length === 0 && body.length === 0 && voice === null) return null;
  return { id: dayNoteId(at), at, title: heading, text: body, voice, mediaId: mediaId || null, kind };
}

/**
 * The notes written about one capture, oldest first.
 *
 * Several are allowed and nothing here assumes otherwise. A photograph you
 * wrote a line about in the moment and a paragraph about that evening is two
 * notes about one picture, which is the ordinary way somebody uses this — and
 * the alternative, one note per capture, would mean the second thing you wrote
 * had to overwrite the first.
 *
 * Oldest first, unlike the diary's own order. This is a day's worth of writing
 * about one thing rather than a list you scan for the most recent entry, and
 * such a list reads forwards.
 */
/**
 * One list or the other, in the order they came in.
 *
 * The whole of what `kind` does. It is a filter rather than two stores, so an
 * entry that turns out to be the other thing changes a field instead of moving
 * between directories — and nothing downstream of here has to know there are two
 * kinds at all: the grouping, the day arithmetic and the cut at now are the same
 * either side.
 */
export function notesOfKind(notes: readonly DayNote[], kind: NoteKind): readonly DayNote[] {
  return notes.filter((note) => note.kind === kind);
}

export function notesForMedia(notes: readonly DayNote[], mediaId: string): readonly DayNote[] {
  return notes.filter((note) => note.mediaId === mediaId).sort((a, b) => a.at - b.at);
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

/**
 * Which way a grouped list runs.
 *
 * `newest` for what has happened, `soonest` for what has not — both meaning
 * "nearest to now first", which is the same instinct pointed in two directions.
 */
export type NoteOrder = 'newest' | 'soonest';

export interface NoteDay {
  /** `YYYY-MM-DD`, local. The same key `groupByDay` uses. */
  readonly key: string;
  /** Local midnight, for a heading and for sorting. */
  readonly startedAt: number;
  /** Newest first within the day. */
  readonly notes: readonly DayNote[];
}

/**
 * Every note, gathered into local days, **newest first in both directions**.
 *
 * The diary read as a timeline rather than as a day's worth of rows. The Day
 * screen asks "what did I write about *this* day" and `notesForDay` answers it
 * oldest-first, because a day reads forwards. A diary asks "what have I
 * written", and that reads backwards: the thing you want is almost always the
 * thing you wrote most recently, and a list that opens on last March is a list
 * you scroll past every time.
 *
 * Days with nothing in them are absent. Unlike the Day screen — where a day
 * exists whether or not anything was recorded on it, so there is somewhere to
 * write — a diary is made of what was written, and an empty date is not an
 * entry.
 */
export function groupNotesByDay(
  notes: readonly DayNote[],
  tzOffsetMinutes: TzOffsetMinutes,
  order: NoteOrder = 'newest',
): readonly NoteDay[] {
  // `b - a` is descending, which is what `newest` wants; `soonest` is the same
  // comparison turned round.
  const direction = order === 'newest' ? 1 : -1;
  const days = new Map<string, DayNote[]>();

  for (const note of notes) {
    const key = dayKeyOf(note.at, tzOffsetMinutes);
    const day = days.get(key);
    if (day) day.push(note);
    else days.set(key, [note]);
  }

  return [...days.entries()]
    .map(([key, inDay]) => ({
      key,
      startedAt: startOfLocalDay(inDay[0]?.at ?? 0, tzOffsetMinutes),
      notes: [...inDay].sort((a, b) => direction * (b.at - a.at)),
    }))
    .sort((a, b) => direction * (b.startedAt - a.startedAt));
}

/**
 * What a day holds and what is still to come, split at `now`.
 *
 * A note may be dated ahead: writing towards a meeting next week, adding to it
 * over the days before, is a thing a diary should let you do — and the moment it
 * describes is the moment it is filed under, whether or not that moment has
 * happened.
 *
 * Split rather than flagged, because the two halves are read differently. What
 * has happened is a record and reads **backwards** from now; what has not is a
 * plan and reads **forwards** to the next thing. Both orders put the entry
 * nearest to now first, which is the one you want in either direction.
 *
 * `now` is a parameter, like every other date decision in `core`.
 */
export function splitAtNow(
  notes: readonly DayNote[],
  now: number,
): { readonly ahead: readonly DayNote[]; readonly behind: readonly DayNote[] } {
  return {
    ahead: notes.filter((note) => note.at > now),
    behind: notes.filter((note) => note.at <= now),
  };
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

  // **Notes in the future add no day, and that is not a detail.** A note can be
  // dated ahead — writing towards a meeting next week is the point of them — and
  // the list here is sorted newest first, so a future day would sort above today
  // and become `days[0]`. The Day screen calls `days[0]` *today*: it would open
  // on a date that has not happened, labelled Today, with nothing on it.
  //
  // A day you can open is a day that has been, plus today. What is written about
  // next Tuesday lives on the Notes tab until next Tuesday.
  for (const at of [...notes.map((note) => note.at).filter((instant) => instant <= now), now]) {
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
  const { fileName, durationMs, byteLength, at, locked } = candidate as Partial<NoteVoice>;
  if (!isStoredFileName(fileName)) return null;

  return {
    fileName,
    durationMs: typeof durationMs === 'number' && Number.isFinite(durationMs) && durationMs >= 0 ? durationMs : 0,
    byteLength: typeof byteLength === 'number' && Number.isFinite(byteLength) && byteLength >= 0 ? byteLength : 0,
    at: isLatLon(at) ? { lat: at.lat, lon: at.lon } : null,
    // **Unlocked is the default, and the safe direction to be wrong in.** Every
    // recording written before this field existed reads as unlocked, which is
    // exactly what it was — the alternative would be a library that silently
    // became read-only on upgrade, with no way to see why.
    locked: locked === true,
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
        // No repair and no validation beyond the shape: an id naming a capture
        // that no longer exists is an ordinary state here rather than a broken
        // one — the picture was forgotten and the note outlived it, which is
        // the arrangement. Every reader expects null and every reader expects a
        // miss, so there is nothing for this to protect.
        typeof note.mediaId === 'string' && note.mediaId.length > 0 ? note.mediaId : null,
        // **Anything that is not exactly a plan is a diary entry.** Every note
        // written before this field existed has no `kind` at all and reads back
        // as `'note'`, which is what it was — the same safe direction the
        // recording's `locked` defaults in, and for the same reason. A garbled
        // value lands there too: an entry whose kind cannot be read is still an
        // entry, and the diary is where you would go looking for it.
        note.kind === 'plan' ? 'plan' : 'note',
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
