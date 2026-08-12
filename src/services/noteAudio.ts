import { Directory, File, Paths } from 'expo-file-system';

import { excludeFromBackup } from '../../modules/file-backup';

import { mediaFileUri } from './mediaStore';

/**
 * The diary's recordings on disk.
 *
 * **A separate directory from the captures, and that is the point rather than
 * housekeeping.** A voice note used to be a capture: sealed beside the photos,
 * indexed with them, opened from the Media tab. It is a note — the same entry
 * said rather than typed — so it is filed with the diary, and the file has to
 * follow the index or the two stores end up walking each other's directories.
 *
 * That last part is not hypothetical. `sweepOrphans` deletes any file in the
 * media directory the media index has never heard of, and it runs on launch as
 * soon as that index settles. A recording living there, referenced only from
 * the notes, is by definition a file the media index has never heard of — so
 * the sweep would delete every voice note somebody had made, invisibly, on a
 * launch where the notes happened to load second. Two stores, two directories,
 * two sweeps: the race stops existing rather than being timed correctly.
 *
 * Everything else is what `mediaStore.ts` already decided, for the same reasons:
 *
 * - Plain files, not sealed. iOS encrypts the container under a key derived
 *   from the passcode; a second pass in JavaScript costs every read and buys
 *   very little against a stolen phone.
 * - `NSURLIsExcludedFromBackupKey` on the directory, applied on **every** write
 *   rather than once at creation, so a library written before the flag existed
 *   is healed by the next thing that touches it.
 * - The name encodes the instant — `voice-<startedAt>.m4a` — so a file written
 *   between the recorder stopping and the note being saved says what it was.
 */

const NOTE_AUDIO_DIRECTORY = 'note-audio';

const EXTENSION = 'm4a';

function noteAudioDirectory(): Directory {
  return new Directory(Paths.document, NOTE_AUDIO_DIRECTORY);
}

/**
 * The directory, created if it is not there, and kept out of backups.
 *
 * Create, then flag: the exclusion is a resource value on a path, so there has
 * to be a path. `excludeFromBackup` reads the current value before writing, so
 * calling it on every write costs a `getattr` and nothing else.
 */
function ensureDirectory(): Directory {
  const directory = noteAudioDirectory();
  if (!directory.exists) directory.create({ intermediates: true });
  excludeFromBackup(directory.uri);
  return directory;
}

/** `voice-<startedAt>.m4a` — derived from the instant, never generated. */
export function noteAudioName(startedAt: number): string {
  return `voice-${startedAt}.${EXTENSION}`;
}

/**
 * Take the file the recorder produced and put it where the diary keeps them.
 *
 * A **move**, so it costs nothing however long the recording: both directories
 * live in the same container, and this is a rename.
 *
 * Returns null when there is nothing to move, which is the honest answer to a
 * recording the platform never wrote — the caller drops the note's recording
 * rather than storing a name pointing at no bytes.
 */
export function keepNoteAudio(
  sourceUri: string,
  startedAt: number,
): { readonly fileName: string; readonly byteLength: number } | null {
  ensureDirectory();

  const source = new File(sourceUri);
  if (!source.exists) return null;

  const fileName = noteAudioName(startedAt);
  const destination = new File(noteAudioDirectory(), fileName);
  if (destination.exists) destination.delete();

  source.moveSync(destination);
  return { fileName, byteLength: destination.size };
}

/** Something a player can open, or null if the bytes have gone. */
export function noteAudioUri(fileName: string): string | null {
  const file = new File(noteAudioDirectory(), fileName);
  return file.exists ? file.uri : null;
}

/**
 * Move a voice note out of the media directory and into the diary's.
 *
 * The migration for recordings made while a voice note was still a capture.
 * Returns null if the file is not there, in which case the caller has an index
 * entry and no bytes — a capture already broken before this ran.
 */
export function adoptFromMedia(
  fileName: string,
  startedAt: number,
): {
  readonly fileName: string;
  readonly byteLength: number;
} | null {
  const uri = mediaFileUri(fileName);
  return uri ? keepNoteAudio(uri, startedAt) : null;
}

/** Forget one recording's bytes. The note may well survive it. */
export function deleteNoteAudio(fileName: string): void {
  const file = new File(noteAudioDirectory(), fileName);
  if (file.exists) file.delete();
}

/**
 * Delete recordings no note refers to.
 *
 * A recording is written the moment you stop talking and referenced only when
 * the note is saved, so a sheet closed without saving — or a note recorded
 * twice before it was written — leaves bytes nothing points at. They are
 * invisible in the app, undeletable from it, and they only accumulate.
 *
 * The mirror of `sweepOrphans`, and it carries the same warning: `known` must
 * be **every** file the notes own, which is what `voiceFilesOf` builds. It must
 * also run only once the diary has actually loaded — a sweep against an empty
 * list is a sweep that deletes everything.
 */
export function sweepNoteAudio(known: readonly string[]): number {
  const directory = noteAudioDirectory();
  if (!directory.exists) return 0;

  const keep = new Set(known);
  let removed = 0;

  for (const entry of directory.list()) {
    if (entry instanceof File && !keep.has(entry.name)) {
      entry.delete();
      removed += 1;
    }
  }

  return removed;
}

/**
 * Delete every recording the diary holds.
 *
 * Called by `eraseEverything` alongside `eraseAllMedia`, before the vault key
 * goes, and synchronous for the same reason: it runs to completion before its
 * caller's first `await`, so there is no instant at which the app can be killed
 * with the recordings half gone and the key still live. Destroying the key does
 * nothing to a plain m4a.
 */
export function eraseAllNoteAudio(): void {
  const directory = noteAudioDirectory();
  if (directory.exists) directory.delete();
}
