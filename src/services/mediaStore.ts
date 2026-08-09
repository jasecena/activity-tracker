import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getThumbnailAsync } from 'expo-video-thumbnails';

import type { MediaItem, MediaKind } from '@/core/media';

import { openBytes } from './vault';

/**
 * Photos, video and voice notes on disk — encrypted, like everything else.
 *
 * The vault seals *values*: short strings that go into AsyncStorage. A minute
 * of 1080p is forty megabytes, which cannot go through `JSON.stringify` and
 * should not be turned into hex. So media gets its own container, sealed under
 * the same device key, and the index describing it stays in the ordinary store.
 *
 * **Chunked, at a megabyte a time.** Sealing a whole video in one call would
 * hold the plaintext, the ciphertext and the base JS string in memory at once —
 * three copies of forty megabytes on a device that will happily kill the app
 * for less. Reading and writing a chunk at a time keeps the high-water mark at
 * a couple of megabytes no matter how long the clip is.
 *
 * ```
 *   "AVM1"                       4-byte magic and format version
 *   repeated until EOF:
 *     length   4 bytes, big-endian, of the sealed chunk that follows
 *     sealed   24-byte nonce || ciphertext || 16-byte Poly1305 tag
 * ```
 *
 * Every chunk is independently authenticated, so a truncated file — the phone
 * dying mid-write — fails to open rather than decrypting into noise. It is also
 * why the length prefix is *outside* the sealed bytes and therefore untrusted:
 * it is bounds-checked before being believed.
 *
 * **Playback decrypts to the cache directory**, not documents, for the reason
 * `exportFile.ts` gives: a decrypted copy is disposable, and cache is the one
 * iOS is free to reclaim. Leaving plaintext video in a documents directory
 * would quietly undo the encryption.
 */

/** Plaintext bytes per chunk. */
const CHUNK_BYTES = 1024 * 1024;

/** `AVM1`. Bumping this is how a future format change stays distinguishable. */
const MAGIC = new Uint8Array([0x41, 0x56, 0x4d, 0x31]);

/** Poly1305 tag plus XChaCha nonce: what sealing adds to a chunk. */
const SEAL_OVERHEAD = 24 + 16;

/** A wildly-out-of-range length prefix means a corrupt file, not a huge chunk. */
const MAX_SEALED_CHUNK = CHUNK_BYTES + SEAL_OVERHEAD + 64;

const MEDIA_DIRECTORY = 'media';

/**
 * Where a capture waits between the camera handing it over and the seal
 * finishing.
 *
 * **In cache, deliberately, and this is the one decision here that is not
 * negotiable.** The file is plaintext until it is sealed. Documents is backed
 * up to iCloud, so parking video there — even for the seconds a seal takes —
 * would put unencrypted recordings in a backup and undo the guarantee the whole
 * store exists to make. Cache is excluded from backups. iOS may reclaim it
 * under storage pressure, which costs an interrupted capture and never costs
 * privacy; that is the right way round.
 */
const PENDING_DIRECTORY = 'pending';

/** `<id>--<kind>.<ext>`, so an interrupted capture identifies itself. */
const NAME_SEPARATOR = '--';

/**
 * Longest edge of a filmstrip thumbnail, in pixels.
 *
 * Generous for a 60-point square at 3× so it stays sharp, and still a few
 * kilobytes — which is the entire point. Decrypting one is imperceptible;
 * decrypting the photo it came from, sixty times over, is the lag this avoids.
 */
const THUMB_EDGE = 240;

const EXTENSIONS: Readonly<Record<MediaKind, string>> = {
  photo: 'jpg',
  video: 'mov',
  audio: 'm4a',
};

function pendingDirectory(): Directory {
  return new Directory(Paths.cache, PENDING_DIRECTORY);
}

/** A capture that has been taken but not yet sealed. */
export interface PendingCapture {
  readonly id: string;
  readonly kind: MediaKind;
  readonly uri: string;
}

function parsePendingName(name: string): { readonly id: string; readonly kind: MediaKind } | null {
  const [id, rest] = name.split(NAME_SEPARATOR);
  if (!id || !rest) return null;

  const kind = rest.split('.')[0];
  if (kind !== 'photo' && kind !== 'video' && kind !== 'audio') return null;
  return { id, kind };
}

/**
 * Take ownership of what the camera produced, before sealing it.
 *
 * A move, not a copy: both directories live in the same container, so this is a
 * rename and costs nothing regardless of how large the clip is.
 *
 * The point is the name. The OS hands over a temp file called whatever it likes;
 * once it is `<id>--<kind>`, an interrupted seal leaves behind a file that says
 * what it was and when it was taken — the id encodes the instant — so the next
 * launch can finish the job with no extra bookkeeping to keep in step.
 */
export function stageCapture(sourceUri: string, id: string, kind: MediaKind): PendingCapture {
  const directory = pendingDirectory();
  if (!directory.exists) directory.create({ intermediates: true });

  const staged = new File(directory, `${id}${NAME_SEPARATOR}${kind}.${EXTENSIONS[kind]}`);
  if (staged.exists) staged.delete();

  new File(sourceUri).moveSync(staged);
  return { id, kind, uri: staged.uri };
}

/** Captures that were taken but never finished sealing. Usually none. */
export function listPending(): readonly PendingCapture[] {
  const directory = pendingDirectory();
  if (!directory.exists) return [];

  return directory.list().flatMap((entry) => {
    if (!(entry instanceof File)) return [];
    const parsed = parsePendingName(entry.name);
    return parsed ? [{ ...parsed, uri: entry.uri }] : [];
  });
}

/** Give up on one that cannot be sealed, rather than retrying it every launch. */
export function discardPending(pending: PendingCapture): void {
  const file = new File(pending.uri);
  if (file.exists) file.delete();
}

/**
 * Delete sealed files the index has never heard of.
 *
 * Suspension is not an exception: if iOS stops the app mid-seal, neither the
 * `catch` nor the `finally` below runs, so a half-written container is left
 * with no index entry pointing at it. It is invisible in the app, undeletable
 * from the UI, and missing from the "what is stored" total — it just occupies
 * the phone. Swept on launch, once the index is known.
 *
 * Returns how many went, which is worth logging and worth nothing else.
 *
 * **`known` must list every file an item owns, thumbnail included.** A capture
 * is two files now, and a sweep handed only the first quietly deleted every
 * thumbnail on the next launch — leaving a gallery that had to decrypt whole
 * videos to draw its filmstrip, which is precisely what the thumbnails exist to
 * prevent. `filesOf` builds the list so no caller has to remember.
 */
export function sweepOrphans(known: readonly string[]): number {
  const directory = mediaDirectory();
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

/** Every file these items own — what `sweepOrphans` must be told to keep. */
export function filesOf(items: readonly MediaItem[]): readonly string[] {
  return items.flatMap((item) => (item.thumbFileName ? [item.fileName, item.thumbFileName] : [item.fileName]));
}

function mediaDirectory(): Directory {
  return new Directory(Paths.document, MEDIA_DIRECTORY);
}

function ensureDirectory(): Directory {
  const directory = mediaDirectory();
  if (!directory.exists) directory.create({ intermediates: true });
  return directory;
}

function readBeUint32(bytes: Uint8Array): number {
  return ((bytes[0] ?? 0) << 24) | ((bytes[1] ?? 0) << 16) | ((bytes[2] ?? 0) << 8) | (bytes[3] ?? 0);
}

/**
 * Hand the JS thread back between chunks.
 *
 * The reason this exists, reported from a phone: sealing a minute of video was
 * freezing the app. `await sealBytes(...)` looks like it yields, but awaiting a
 * resolved promise only drains the *microtask* queue — touches, renders and
 * timers are macrotasks, so a loop of dozens of megabyte-sized AEAD passes runs
 * to completion without the UI getting a single frame. The Stop button appeared
 * dead, and the taps that followed went nowhere.
 *
 * `setTimeout(0)` is a macrotask, so the queue drains between chunks. It makes
 * the whole seal slightly slower in wall-clock and entirely responsive, which
 * is the right trade for something a person is watching.
 */
function breathe(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  return a.every((byte, index) => byte === b[index]);
}

/**
 * Take the file the camera produced and put it where it belongs.
 *
 * A **move**, not an encrypt-and-copy. Both directories live in the same
 * container, so this is a rename: free however long the clip is, and instant
 * where sealing forty megabytes was seconds of pure-JavaScript AEAD on the one
 * thread the interface also runs on.
 *
 * This reverses the decision that media is sealed at rest, and the reasoning is
 * in `docs/ARCHITECTURE.md` § 11. In short: iOS already encrypts the container
 * with a key derived from the passcode, so a second pass in JavaScript bought
 * very little against a stolen phone and cost every read. Encryption belongs at
 * the boundary where data actually leaves — the sync that is coming — and the
 * bytes are sealed on the way out rather than on the way in.
 *
 * `onProgress` survives the change and is called once, with 1. There is nothing
 * to report on a rename, and callers already know how to draw a bar.
 */
export async function writeMedia(
  sourceUri: string,
  id: string,
  kind: MediaKind,
  onProgress?: (fraction: number) => void,
): Promise<{ readonly fileName: string; readonly byteLength: number }> {
  ensureDirectory();

  const source = new File(sourceUri);
  const fileName = `${id}.${EXTENSIONS[kind]}`;
  const destination = new File(mediaDirectory(), fileName);

  if (destination.exists) destination.delete();
  source.moveSync(destination);
  onProgress?.(1);

  return { fileName, byteLength: destination.size };
}

/**
 * A still from a video, trying more than one instant.
 *
 * The very first frame is the one most likely to fail: a clip can open with a
 * frame the decoder will not hand over, and `getThumbnailAsync` then throws
 * rather than returning something. A capture that came out of *this* app is
 * never long, so a quarter of a second in is still the same scene — and a
 * thumbnail from the wrong instant beats a blank square that no launch will
 * ever retry into existence.
 */
async function frameFrom(sourceUri: string): Promise<string> {
  const attempts = [0, 250, 1_000];
  let lastError: unknown = null;

  for (const time of attempts) {
    try {
      return (await getThumbnailAsync(sourceUri, { time, quality: 0.6 })).uri;
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError ?? new Error('No frame could be read');
}

/**
 * Make a small image for the filmstrip and put it beside the capture.
 *
 * Must be called while the source file still exists — before `writeMedia`
 * moves it.
 *
 * Returns null when there is nothing to show (a voice note) or when the
 * platform cannot produce a frame. A missing thumbnail is a state the UI
 * already has to handle, so failing here is never worth losing a capture over.
 */
export async function writeThumbnail(sourceUri: string, id: string, kind: MediaKind): Promise<string | null> {
  if (kind === 'audio') return null;
  ensureDirectory();

  try {
    // A video has no image until a frame is pulled out of it; a photo is
    // already one. Either way what gets scaled is a plain file on disk.
    const frameUri = kind === 'video' ? await frameFrom(sourceUri) : sourceUri;

    const context = ImageManipulator.manipulate(frameUri);
    context.resize({ width: THUMB_EDGE, height: null });
    const rendered = await context.renderAsync();
    const small = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });

    const fileName = `${id}.thumb.jpg`;
    const destination = new File(mediaDirectory(), fileName);
    if (destination.exists) destination.delete();
    new File(small.uri).moveSync(destination);

    // The extracted video frame is a temp file of its own.
    if (frameUri !== sourceUri) {
      const temp = new File(frameUri);
      if (temp.exists) temp.delete();
    }

    return fileName;
  } catch (error) {
    console.warn('Could not make a thumbnail', error);
    return null;
  }
}

/**
 * Anything written before media stopped being sealed at rest.
 *
 * True for a thumbnail as well as a capture. A sealed thumbnail is ciphertext
 * handed to an `<Image>`, which draws nothing at all — so an old capture is not
 * merely un-migrated, it is a blank square in the filmstrip until it has been
 * made again.
 */
export function isSealed(fileName: string): boolean {
  return fileName.endsWith('.avm');
}

/**
 * Unseal one file written by the old container, in place.
 *
 * The migration, and the reason it exists at all: a library sealed by an
 * earlier build is unreadable to a build that no longer decrypts, and silently
 * losing every photo somebody took is not a thing an app gets to do because its
 * storage decision changed. Run once per file, on launch, after the index has
 * settled; the result is a plain file under the same id and a new name.
 *
 * Breathes between chunks like everything else that reads a whole capture, so
 * a library of clips migrates without the interface stopping.
 *
 * Returns the new file name, or null if it could not be read — in which case
 * the sealed file is left exactly where it is rather than deleted, because a
 * file that failed to open once may open on a device that still has its key.
 */
export async function unsealInPlace(fileName: string): Promise<string | null> {
  const sealed = new File(mediaDirectory(), fileName);
  if (!sealed.exists) return null;

  const plainName = fileName.replace(/\.avm$/, '');
  const destination = new File(mediaDirectory(), plainName);
  if (destination.exists) destination.delete();
  destination.create();

  const input = sealed.open(FileMode.ReadOnly);
  const output = destination.open(FileMode.WriteOnly);

  try {
    if (!sameBytes(input.readBytes(MAGIC.length), MAGIC)) throw new Error('Not a sealed media file');

    for (;;) {
      const header = input.readBytes(4);
      if (header.length === 0) break;
      if (header.length < 4) throw new Error('Truncated chunk header');

      const length = readBeUint32(header);
      // The length prefix is outside the authenticated bytes, so it is
      // untrusted input: a corrupt one must fail here rather than become an
      // allocation the size of the number it happened to contain.
      if (length <= SEAL_OVERHEAD || length > MAX_SEALED_CHUNK) throw new Error('Implausible chunk length');

      const chunk = input.readBytes(length);
      if (chunk.length < length) throw new Error('Truncated chunk');

      const plain = await openBytes(chunk);
      if (!plain) throw new Error('Chunk failed to authenticate');
      output.writeBytes(plain);

      await breathe();
    }
  } catch (error) {
    console.warn('Could not unseal a capture', error);
    if (destination.exists) destination.delete();
    return null;
  } finally {
    input.close();
    output.close();
  }

  // **The sealed original is left where it is**, and that is the whole safety
  // of this. Deleting it here would open a window: the plain file exists, the
  // index still names the sealed one, and if iOS suspends the app before the
  // index is written, the next launch sweeps the plain file as an orphan and
  // the capture is gone for good.
  //
  // Write the new, let the index move, and let the next launch's sweep take
  // the old one — it is an orphan by then, by definition. Dying anywhere in
  // between costs a duplicate on disk until that sweep, and never a photo.
  return plainName;
}

/**
 * Make a thumbnail for a capture stored before thumbnails existed.
 *
 * Cheap now that the capture is a plain file: there is nothing to decrypt
 * first, so this reads the frame straight off disk.
 */
export async function backfillThumbnail(item: MediaItem): Promise<string | null> {
  if (item.kind === 'audio' || isSealed(item.fileName)) return null;

  const file = new File(mediaDirectory(), item.fileName);
  if (!file.exists) return null;

  return writeThumbnail(file.uri, item.id, item.kind);
}

/**
 * A URI for a thumbnail. No work: it is a file on disk.
 *
 * Kept async because every caller already awaits it, and because a future
 * format would need the room.
 */
export async function openThumbnail(fileName: string): Promise<string | null> {
  const file = new File(mediaDirectory(), fileName);
  return file.exists ? file.uri : null;
}

/**
 * A URI something can show or play.
 *
 * **This is the change that made the gallery quick.** It used to decrypt the
 * whole capture into the cache before anything could look at it — forty
 * megabytes of JavaScript AEAD on the thread that also draws the screen, for
 * every clip you swiped past. Now `expo-video` is handed the file and reads
 * the frames it needs, which is what streaming meant all along.
 *
 * `onProgress` is called once, with 1, so callers that draw a bar keep working
 * and simply never show one.
 */
export async function openForPlayback(
  item: MediaItem,
  onProgress?: (fraction: number) => void,
): Promise<string | null> {
  const file = new File(mediaDirectory(), item.fileName);
  if (!file.exists) return null;
  onProgress?.(1);
  return file.uri;
}

/**
 * Nothing to release: playback reads the stored file directly.
 *
 * Kept, and kept called, because the shape is right — a screen that opens a
 * capture should say when it is done with it, and the sync that is coming will
 * decrypt to a temporary file again on the way down.
 */
export function releasePlayback(_item: MediaItem): void {
  // Deliberately empty.
}

/** Forget one capture, bytes and all — the thumbnail included. */
export function deleteMedia(item: MediaItem): void {
  releasePlayback(item);
  for (const name of [item.fileName, item.thumbFileName]) {
    if (!name) continue;
    const sealed = new File(mediaDirectory(), name);
    if (sealed.exists) sealed.delete();
  }
}

/**
 * Delete every sealed file.
 *
 * Called by `eraseEverything`, *after* the key is destroyed. By then what is on
 * disk is already unreadable by anyone including this app — this is housekeeping
 * so the bytes do not sit there for the life of the install, not the thing that
 * makes them safe.
 */
export function eraseAllMedia(): void {
  for (const directory of [mediaDirectory(), pendingDirectory()]) {
    if (directory.exists) directory.delete();
  }
}
