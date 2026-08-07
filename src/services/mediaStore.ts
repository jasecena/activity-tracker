import { Directory, File, FileMode, Paths } from 'expo-file-system';

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

const EXTENSIONS: Readonly<Record<MediaKind, string>> = {
  photo: 'jpg',
  video: 'mov',
  audio: 'm4a',
};

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
 * Decrypt an item into the cache and return a URI something can play.
 *
 * Returns null when the file is missing or will not authenticate — a restored
 * backup carries the ciphertext and not the key, and "this cannot be read" is
 * handled the same way as "this is not there", because there is nothing else to
 * do about either.
 *
 * Call `releasePlayback` when the screen showing it goes away.
 */
export async function openForPlayback(item: MediaItem): Promise<string | null> {
  const sealed = new File(mediaDirectory(), item.fileName);
  if (!sealed.exists) return null;

  const plainName = item.fileName.replace(/\.avm$/, '');
  const destination = new File(Paths.cache, `play-${plainName}`);
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

/** Forget one capture, bytes and all. */
export function deleteMedia(item: MediaItem): void {
  releasePlayback(item);
  const sealed = new File(mediaDirectory(), item.fileName);
  if (sealed.exists) sealed.delete();
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
  const directory = mediaDirectory();
  if (directory.exists) directory.delete();
}
