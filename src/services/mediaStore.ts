import { Directory, File, FileMode, Paths } from 'expo-file-system';
import { ImageManipulator, SaveFormat } from 'expo-image-manipulator';
import { getThumbnailAsync } from 'expo-video-thumbnails';

import type { MediaItem, MediaKind } from '@/core/media';

import { openBytes, sealBytes } from './vault';

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

function beUint32(value: number): Uint8Array {
  return new Uint8Array([(value >>> 24) & 0xff, (value >>> 16) & 0xff, (value >>> 8) & 0xff, value & 0xff]);
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
 * Seal a file the camera or recorder just produced, and delete the plaintext.
 *
 * The source is a temp file the OS handed us; leaving it behind would mean the
 * app's own container holds an unencrypted copy of everything ever captured,
 * which is the exact thing this module exists to prevent. It is deleted whether
 * or not the sealing succeeded — a half-written sealed file is unopenable and
 * gets cleaned up too.
 */
export async function writeMedia(
  sourceUri: string,
  id: string,
  kind: MediaKind,
  /** Fraction sealed so far, 0 to 1. Called once per chunk, for a progress bar. */
  onProgress?: (fraction: number) => void,
): Promise<{ readonly fileName: string; readonly byteLength: number }> {
  ensureDirectory();

  const source = new File(sourceUri);
  const fileName = `${id}.${EXTENSIONS[kind]}.avm`;
  const destination = new File(mediaDirectory(), fileName);

  if (destination.exists) destination.delete();
  destination.create();

  const totalBytes = Math.max(1, source.size);
  const input = source.open(FileMode.ReadOnly);
  const output = destination.open(FileMode.WriteOnly);

  try {
    output.writeBytes(MAGIC);
    let read = 0;

    for (;;) {
      const plain = input.readBytes(CHUNK_BYTES);
      if (plain.length === 0) break;

      const sealed = await sealBytes(plain);
      output.writeBytes(beUint32(sealed.length));
      output.writeBytes(sealed);

      read += plain.length;
      onProgress?.(Math.min(1, read / totalBytes));

      // A short read is the last chunk. Asking again would return zero bytes
      // and cost another round trip through the bridge.
      if (plain.length < CHUNK_BYTES) break;

      // Only between chunks, never after the last: the caller is waiting on
      // this promise and an extra tick before resolving is pure latency.
      await breathe();
    }
  } catch (error) {
    if (destination.exists) destination.delete();
    throw error;
  } finally {
    input.close();
    output.close();
    // The plaintext the OS gave us. Gone either way.
    if (source.exists) source.delete();
  }

  return { fileName, byteLength: destination.size };
}

/**
 * Make a small image for the filmstrip and seal it beside the capture.
 *
 * Takes the **plaintext**, so it must be called while the staged file still
 * exists — before `writeMedia` consumes it. Generating one later means
 * decrypting the whole capture first, which is exactly the cost thumbnails
 * exist to avoid; that path is for old captures only.
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
    const frameUri = kind === 'video' ? (await getThumbnailAsync(sourceUri, { time: 0, quality: 0.6 })).uri : sourceUri;

    const context = ImageManipulator.manipulate(frameUri);
    context.resize({ width: THUMB_EDGE, height: null });
    const rendered = await context.renderAsync();
    const small = await rendered.saveAsync({ format: SaveFormat.JPEG, compress: 0.6 });

    const fileName = `${id}.thumb.avm`;
    const destination = new File(mediaDirectory(), fileName);
    if (destination.exists) destination.delete();

    // Small enough to seal in one pass: no chunking, no yielding, no progress.
    const plain = await new File(small.uri).bytes();
    destination.create();
    destination.write(await sealBytes(plain));

    // The extracted frame and the scaled copy are both plaintext temp files.
    for (const uri of [small.uri, frameUri]) {
      if (uri === sourceUri) continue;
      const temp = new File(uri);
      if (temp.exists) temp.delete();
    }

    return fileName;
  } catch (error) {
    console.warn('Could not make a thumbnail', error);
    return null;
  }
}

/**
 * Make a thumbnail for a capture that was stored before thumbnails existed.
 *
 * The expensive path, and deliberately the only one that is: the capture has to
 * be decrypted whole before there is an image to scale. That is the cost
 * thumbnails avoid on every subsequent read, which is why this is a one-off
 * over the old library rather than something the gallery ever does on demand.
 *
 * The plaintext is released either way, including when the thumbnail fails —
 * a decrypted video left in the cache because a frame could not be pulled out
 * of it is the worst outcome available here.
 */
export async function backfillThumbnail(item: MediaItem): Promise<string | null> {
  if (item.kind === 'audio') return null;

  const opened = await openForPlayback(item);
  if (!opened) return null;

  try {
    return await writeThumbnail(opened, item.id, item.kind);
  } finally {
    releasePlayback(item);
  }
}

/** Decrypt a thumbnail for display. Small, so read whole rather than streamed. */
export async function openThumbnail(fileName: string): Promise<string | null> {
  const sealed = new File(mediaDirectory(), fileName);
  if (!sealed.exists) return null;

  try {
    const plain = await openBytes(await sealed.bytes());
    if (!plain) return null;

    const destination = new File(Paths.cache, `thumb-${fileName.replace(/\.avm$/, '')}.jpg`);
    if (destination.exists) destination.delete();
    destination.create();
    destination.write(plain);
    return destination.uri;
  } catch {
    return null;
  }
}

/**
 * Decrypt an item into the cache and return a URI something can play.
 *
 * Returns null when the file is missing or will not authenticate — a restored
 * backup carries the ciphertext and not the key, and "this cannot be read" is
 * handled the same way as "this is not there", because there is nothing else to
 * do about either.
 *
 * Call `releasePlayback` when the screen showing it goes away.
 *
 * **Breathes between chunks, exactly like the write does.** Reading is the same
 * shape of work as writing — dozens of megabyte-sized AEAD passes — and it was
 * shipped without the yield the write had. Awaiting `openBytes` drains the
 * microtask queue and nothing else, so opening a minute of video ran the whole
 * loop without the UI getting a frame: the tab took a visible age to appear,
 * and the swipe that got you there had already been forgotten. Slightly slower
 * in wall-clock, entirely responsive.
 *
 * `onProgress` is the other half of that: something a person waits for should
 * say how far along it is.
 */
export async function openForPlayback(
  item: MediaItem,
  onProgress?: (fraction: number) => void,
): Promise<string | null> {
  const sealed = new File(mediaDirectory(), item.fileName);
  if (!sealed.exists) return null;

  const plainName = item.fileName.replace(/\.avm$/, '');
  const destination = new File(Paths.cache, `play-${plainName}`);
  if (destination.exists) destination.delete();
  destination.create();

  const input = sealed.open(FileMode.ReadOnly);
  const output = destination.open(FileMode.WriteOnly);
  // Sealed bytes, not plaintext — close enough for a progress bar, and the
  // plaintext size is not known until the last chunk is open.
  const total = Math.max(1, sealed.size);
  let read = MAGIC.length;

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

      read += 4 + chunk.length;
      onProgress?.(Math.min(1, read / total));

      // The yield that was missing. See the note above.
      await breathe();
    }
  } catch {
    if (destination.exists) destination.delete();
    return null;
  } finally {
    input.close();
    output.close();
  }

  return destination.uri;
}

/** Drop the decrypted copy. Safe to call for something that was never opened. */
export function releasePlayback(item: MediaItem): void {
  const plainName = item.fileName.replace(/\.avm$/, '');
  const decrypted = new File(Paths.cache, `play-${plainName}`);
  if (decrypted.exists) decrypted.delete();
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
