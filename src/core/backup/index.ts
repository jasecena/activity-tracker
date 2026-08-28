import { dayKeyOf, notesForDay, voiceFilesOf, type DayGroup, type DayNote } from '../day';
import type { Place } from '../places';

/**
 * What a backup is made of, decided without a clock, a network or a key.
 *
 * The whole of "which objects should be up there" is arithmetic over days and
 * notes, so it lives here where it can be tested without a bucket. What is left
 * for `services/backup` is the part that genuinely cannot be pure: sealing,
 * signing, and the request itself.
 *
 * **Previous days only.** A finished day cannot change, which is what makes it
 * safe to upload once and stop thinking about — the same line `freeze` already
 * draws. Today is excluded because it is still being recorded, and an object
 * uploaded at three in the afternoon would be a day with an evening missing
 * from it that nothing would ever go back and fix.
 */

/** One object, and everything needed to put it in the bucket. */
export interface BackupObject {
  /** Where it goes. Stable, so pressing the button twice overwrites rather than duplicates. */
  readonly key: string;
  /** JSON, where the bytes are known here. Null when something has to be read. */
  readonly body: string | null;
  /** The name in `Documents/note-audio`, for a recording. */
  readonly fileName: string | null;
  /**
   * The archived day whose readings are the body, for a day of raw fixes.
   *
   * **Named rather than carried, because `core` cannot read storage and should
   * not want to.** A day of readings is hundreds of kilobytes; handing every one
   * of them to this function to decide what should be uploaded would mean
   * holding a year of them in memory to answer a question about names. The
   * caller reads one at a time, which is also how it writes them.
   */
  readonly archiveDay?: string;
}

/**
 * The days worth uploading: everything the log holds except today.
 *
 * `dayKeyOf` decides which day an instant belongs to, so this asks the same
 * question the rest of the app asks and gets the same answer — a day near
 * midnight is a wall-clock fact and the offset is a parameter.
 */
export function previousDays(days: readonly DayGroup[], now: number, tzOffsetMinutes: number): readonly DayGroup[] {
  const today = dayKeyOf(now, tzOffsetMinutes);
  return days.filter((day) => day.key !== today);
}

/**
 * A day, as the bytes that go in the bucket.
 *
 * Segments **and** the notes about that day, in one object, because they are
 * one thing to a person reading it back on a laptop: what happened, and what
 * you said about it. Splitting them would mean opening two files and joining
 * them by hand at exactly the moment nobody wants a puzzle.
 *
 * The recordings are named but not embedded — bytes belong in their own objects
 * so a day stays small and a recording is not re-uploaded every time a sentence
 * is added to the day it belongs to.
 */
export function dayObject(day: DayGroup, notes: readonly DayNote[], tzOffsetMinutes: number): BackupObject {
  const mine = notesForDay(notes, day.key, tzOffsetMinutes);
  return {
    key: `days/${day.key}`,
    body: JSON.stringify({
      version: 1,
      day: day.key,
      startedAt: day.startedAt,
      segments: day.segments,
      notes: mine,
    }),
    fileName: null,
  };
}

/**
 * The recordings belonging to days already finished.
 *
 * Filed by their own file name rather than by the day, because that is what the
 * note points at: a laptop opening `days/2026-01-05` reads `voice-…m4a` and
 * finds exactly that name under `note-audio/`. Deriving a different name here
 * would be a second thing to keep in step.
 */
export function voiceObjects(
  days: readonly DayGroup[],
  notes: readonly DayNote[],
  tzOffsetMinutes: number,
): readonly BackupObject[] {
  const keys = new Set(days.map((day) => day.key));
  const mine = notes.filter((note) => keys.has(dayKeyOf(note.at, tzOffsetMinutes)));
  return voiceFilesOf(mine).map((fileName) => ({ key: `note-audio/${fileName}`, body: null, fileName }));
}

/**
 * Everything that should be in the bucket for the days that are over.
 *
 * Deliberately *what should be there* rather than *what is missing*: comparing
 * against what has already gone up needs a hash of the bytes, and hashing is not
 * something `core` can do. The caller filters. Keeping the two apart means this
 * function has one answer whatever the phone has done before.
 */
export function backupObjects(
  days: readonly DayGroup[],
  notes: readonly DayNote[],
  now: number,
  tzOffsetMinutes: number,
  places: readonly Place[] = [],
  archivedDayKeys: readonly string[] = [],
): readonly BackupObject[] {
  const eligible = previousDays(days, now, tzOffsetMinutes);
  const named = placesObject(places);
  return [
    ...eligible.map((day) => dayObject(day, notes, tzOffsetMinutes)),
    ...voiceObjects(eligible, notes, tzOffsetMinutes),
    ...(named ? [named] : []),
    ...fixObjects(archivedDayKeys),
  ];
}

/**
 * Days that will be deleted by retention before they have been backed up.
 *
 * The trap this feature has by construction: retention runs on a timer and the
 * backup runs on a press, so a month of not pressing the button is a month that
 * leaves both places with nothing having gone wrong. The Data screen says so
 * out loud rather than the app quietly deciding for its owner — refusing to
 * apply retention would make a setting stop working, which is worse.
 *
 * `retentionDays` of 0 means keep everything, so there is nothing to warn about.
 */
export function daysAboutToBeLost(
  days: readonly DayGroup[],
  uploadedKeys: ReadonlySet<string>,
  retentionDays: number,
  now: number,
  tzOffsetMinutes: number,
): readonly string[] {
  if (retentionDays <= 0) return [];

  const cutoff = now - retentionDays * 86_400_000;
  return previousDays(days, now, tzOffsetMinutes)
    .filter((day) => day.startedAt <= cutoff && !uploadedKeys.has(`days/${day.key}`))
    .map((day) => day.key);
}

/**
 * The named places, as one object.
 *
 * **One object replaced whole, never one per place.** The list is short, it
 * changes when somebody names somewhere, and what a reader wants on a laptop is
 * the list — not to reassemble it from forty files. The same shape, and the same
 * reasoning, as a manifest.
 *
 * This was missing and the gap was quiet: a stay is backed up as a coordinate
 * and a radius, so a restored backup had every journey and not one name for
 * anywhere. "Home" is not derivable from anything.
 */
export function placesObject(places: readonly Place[]): BackupObject | null {
  if (places.length === 0) return null;
  return {
    key: 'places/current',
    body: JSON.stringify({ version: 1, places: [...places].sort((a, b) => a.id.localeCompare(b.id)) }),
    fileName: null,
  };
}

/**
 * The raw readings behind the days that are over, one object per day.
 *
 * **One per day, matching how the phone stores them.** A single object would
 * mean reading and rewriting a year of readings to add this morning's — the
 * same failure `pruneBuffer` avoids on disk, for the same reason, and it
 * degrades over months rather than failing where anyone would see it.
 *
 * Sorted, and today's is never among them: a day is archived when it is frozen,
 * so an archive key existing at all means that day is over.
 */
export function fixObjects(archivedDayKeys: readonly string[]): readonly BackupObject[] {
  return [...archivedDayKeys]
    .sort()
    .map((day) => ({ key: `fixes/${day}`, body: null, fileName: null, archiveDay: day }));
}
