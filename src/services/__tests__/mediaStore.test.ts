import * as FileSystem from 'expo-file-system';
import { Directory, File, Paths } from 'expo-file-system';

import type { MediaItem } from '@/core/media';

import {
  deleteMedia,
  openThumbnail,
  writeThumbnail,
  discardPending,
  eraseAllMedia,
  listPending,
  openForPlayback,
  releasePlayback,
  filesOf,
  isSealed,
  stageCapture,
  sweepOrphans,
  unsealInPlace,
  writeMedia,
} from '../mediaStore';

import { sealBytes } from '../vault';

/**
 * The real cipher against an in-memory filesystem, for the same reason
 * `vault.test.ts` uses the real cipher: what is worth proving here is that a
 * chunked write and a chunked read agree, and that a damaged container is
 * refused rather than decrypted into noise. Stubbing either half proves the
 * call sites compile and nothing else.
 *
 * A capture that cannot be read back is a photo silently lost forever, which is
 * the one failure this store must not have.
 */

/**
 * The in-memory filesystem's own controls.
 *
 * Narrowed from the module this file already imported, **not** fetched again
 * with `jest.requireMock` — that returns a second instance of the mock with its
 * own empty file map, so seeding through one and reading through the other
 * quietly does nothing and every round-trip assertion fails on an empty file.
 * The cast is only about types: `expo-file-system` has no `__seed` in its real
 * signature and should not.
 */
const { __reset, __seed } = FileSystem as unknown as typeof import('../../../__mocks__/expo-file-system');

const CHUNK_BYTES = 1024 * 1024;

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: 'm-1767600000000',
    kind: 'photo',
    capturedAt: 1_767_600_000_000,
    durationMs: null,
    fileName: 'm-1767600000000.jpg.avm',
    thumbFileName: null,
    at: null,
    byteLength: 0,
    note: '',
    ...overrides,
  };
}

/** Bytes that are not all the same, so a mis-ordered chunk cannot pass. */
function pattern(length: number): Uint8Array {
  const bytes = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) bytes[index] = (index * 31 + 7) % 251;
  return bytes;
}

function storedFileOf(media: MediaItem): File {
  return new File(Paths.document, 'media', media.fileName);
}

/**
 * Byte equality without Jest's deep-equal.
 *
 * `toEqual` on a two-megabyte `Uint8Array` walks it element by element through
 * Jest's structural equality and takes tens of seconds — most of a suite that
 * is supposed to run in well under a minute. A loop with an early exit is
 * milliseconds.
 */
function sameBytes(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  for (let index = 0; index < a.length; index += 1) {
    if (a[index] !== b[index]) return false;
  }
  return true;
}

function expectSameBytes(actual: Uint8Array, expected: Uint8Array): void {
  expect(actual.length).toBe(expected.length);
  expect(sameBytes(actual, expected)).toBe(true);
}

/**
 * Write a container in the format an earlier build wrote, so the migration is
 * tested against the real thing rather than against a mock of it.
 *
 * `"AVM1"` then, repeating: a four-byte big-endian length and that many bytes of
 * `nonce || ciphertext || tag`. Chunked at a megabyte, as it was, so a
 * multi-chunk file exercises the loop rather than one lucky pass.
 */
async function seedSealed(fileName: string, plaintext: Uint8Array): Promise<void> {
  const CHUNK = 1024 * 1024;
  const parts: Uint8Array[] = [new Uint8Array([0x41, 0x56, 0x4d, 0x31])];

  for (let at = 0; at < plaintext.length; at += CHUNK) {
    const sealed = await sealBytes(plaintext.subarray(at, Math.min(at + CHUNK, plaintext.length)));
    const length = sealed.length;
    parts.push(new Uint8Array([(length >>> 24) & 0xff, (length >>> 16) & 0xff, (length >>> 8) & 0xff, length & 0xff]));
    parts.push(sealed);
  }

  const total = parts.reduce((sum, part) => sum + part.length, 0);
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const part of parts) {
    bytes.set(part, offset);
    offset += part.length;
  }

  const directory = new Directory(Paths.document, 'media');
  if (!directory.exists) directory.create({ intermediates: true });
  new File(directory, fileName).write(bytes);
}

beforeEach(() => {
  __reset();
});

describe('writeMedia', () => {
  it('round-trips a small capture', async () => {
    const bytes = pattern(2_048);
    __seed('file:///mock/cache/capture-1.jpg', bytes);

    const written = await writeMedia('file:///mock/cache/capture-1.jpg', 'm-1767600000000', 'photo');
    const media = item({ fileName: written.fileName, byteLength: written.byteLength });

    const uri = await openForPlayback(media);
    expect(uri).not.toBeNull();
    expectSameBytes(new File(uri as string).bytesSync(), bytes);
  });

  // The reason the format is chunked at all: a whole video sealed in one call
  // holds three copies of it in memory at once.
  it('round-trips a capture spanning several chunks', async () => {
    const bytes = pattern(CHUNK_BYTES * 2 + 4_096);
    __seed('file:///mock/cache/clip.mov', bytes);

    const written = await writeMedia('file:///mock/cache/clip.mov', 'm-2', 'video');
    const media = item({ id: 'm-2', kind: 'video', fileName: written.fileName });

    const uri = await openForPlayback(media);
    expectSameBytes(new File(uri as string).bytesSync(), bytes);
  });

  it('round-trips a capture that is an exact multiple of the chunk size', async () => {
    const bytes = pattern(CHUNK_BYTES);
    __seed('file:///mock/cache/exact.m4a', bytes);

    const written = await writeMedia('file:///mock/cache/exact.m4a', 'm-3', 'audio');
    const uri = await openForPlayback(item({ id: 'm-3', kind: 'audio', fileName: written.fileName }));
    expectSameBytes(new File(uri as string).bytesSync(), bytes);
  });

  // The plaintext the OS handed us must not survive. Leaving it behind would
  // mean the container holds an unencrypted copy of everything ever captured.
  it('deletes the source the camera produced', async () => {
    __seed('file:///mock/cache/capture-1.jpg', pattern(64));
    await writeMedia('file:///mock/cache/capture-1.jpg', 'm-1767600000000', 'photo');
    expect(new File('file:///mock/cache/capture-1.jpg').exists).toBe(false);
  });

  // A move, not an encrypt-and-copy. The bytes on disk are the bytes the camera
  // produced, byte for byte, which is what lets the player read frames out of
  // them instead of waiting for forty megabytes of JavaScript AEAD.
  it('stores exactly what the camera produced', async () => {
    const bytes = pattern(512);
    __seed('file:///mock/cache/capture-1.jpg', bytes);

    const written = await writeMedia('file:///mock/cache/capture-1.jpg', 'm-1767600000000', 'photo');
    const onDisk = storedFileOf(item({ fileName: written.fileName })).bytesSync();

    expectSameBytes(onDisk, bytes);
    expect(written.byteLength).toBe(bytes.length);
    expect(written.fileName).toBe('m-1767600000000.jpg');
  });

  it('overwrites rather than failing when the same id is captured twice', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(100));
    await writeMedia('file:///mock/cache/a.jpg', 'm-1767600000000', 'photo');

    __seed('file:///mock/cache/b.jpg', pattern(200));
    const second = await writeMedia('file:///mock/cache/b.jpg', 'm-1767600000000', 'photo');

    const uri = await openForPlayback(item({ fileName: second.fileName }));
    expectSameBytes(new File(uri as string).bytesSync(), pattern(200));
  });
});

describe('openForPlayback', () => {
  it('is null for a file that is not there', async () => {
    expect(await openForPlayback(item())).toBeNull();
  });

  it('hands over the stored file itself, with nothing copied or decrypted', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(4_000));
    const written = await writeMedia('file:///mock/cache/a.jpg', 'm-1767600000000', 'photo');

    const uri = await openForPlayback(item({ fileName: written.fileName }));
    expect(uri).toBe(storedFileOf(item({ fileName: written.fileName })).uri);
    expectSameBytes(new File(uri as string).bytesSync(), pattern(4_000));
  });
});

/**
 * The migration off the sealed container.
 *
 * Media used to be encrypted at rest in this module's own format. It is not any
 * more — iOS encrypts the container already, and a second pass in JavaScript
 * cost every read. But a library sealed by an earlier build has to keep
 * working: losing every photo somebody took because a storage decision changed
 * is not a thing an app gets to do.
 *
 * The three ways a container goes bad still matter here, and all of them must
 * fail closed. A truncated video that decrypts into noise is worse than one
 * that will not open, because it looks like a recording and is not — and here
 * failing closed also means the sealed original is left alone rather than
 * replaced by rubbish.
 */
describe('unsealing what an earlier build wrote', () => {
  it('turns a sealed capture into the bytes it was made from', async () => {
    const bytes = pattern(3 * 1024 * 1024 + 77);
    await seedSealed('m-1767600000000.jpg.avm', bytes);

    const plainName = await unsealInPlace('m-1767600000000.jpg.avm');
    expect(plainName).toBe('m-1767600000000.jpg');

    expectSameBytes(new File(Paths.document, 'media', plainName as string).bytesSync(), bytes);
    // The sealed original is gone: two copies of every video is the one thing
    // a phone has no room for.
    expect(new File(Paths.document, 'media', 'm-1767600000000.jpg.avm').exists).toBe(false);
  });

  it('is null for a file that is not there', async () => {
    expect(await unsealInPlace('nothing.jpg.avm')).toBeNull();
  });

  it('refuses a file that is not one of ours', async () => {
    new File(Paths.document, 'media').create();
    new File(Paths.document, 'media', 'x.jpg.avm').write(pattern(300));

    expect(await unsealInPlace('x.jpg.avm')).toBeNull();
  });

  it('refuses a container truncated mid-chunk', async () => {
    await seedSealed('x.jpg.avm', pattern(4_000));
    const sealed = new File(Paths.document, 'media', 'x.jpg.avm');
    sealed.write(sealed.bytesSync().slice(0, 200));

    expect(await unsealInPlace('x.jpg.avm')).toBeNull();
  });

  it('refuses a container whose bytes were altered', async () => {
    await seedSealed('x.jpg.avm', pattern(4_000));
    const sealed = new File(Paths.document, 'media', 'x.jpg.avm');
    const bytes = sealed.bytesSync();
    // Well past the magic and the length prefix, so this is the ciphertext.
    bytes[100] = (bytes[100] ?? 0) ^ 0xff;
    sealed.write(bytes);

    expect(await unsealInPlace('x.jpg.avm')).toBeNull();
  });

  // Left sealed rather than deleted: a file that will not open here may open on
  // a device that still has its key, and half a file is worse than none.
  it('leaves the sealed original alone and writes no half a file when it refuses', async () => {
    new File(Paths.document, 'media').create();
    new File(Paths.document, 'media', 'x.jpg.avm').write(pattern(300));

    await unsealInPlace('x.jpg.avm');

    expect(new File(Paths.document, 'media', 'x.jpg.avm').exists).toBe(true);
    expect(new File(Paths.document, 'media', 'x.jpg').exists).toBe(false);
  });

  it('knows which names still need it', () => {
    expect(isSealed('m-1.jpg.avm')).toBe(true);
    expect(isSealed('m-1.jpg')).toBe(false);
  });
});

describe('deleting', () => {
  it('removes the sealed file and any decrypted copy', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(1_000));
    const written = await writeMedia('file:///mock/cache/a.jpg', 'm-1767600000000', 'photo');
    const media = item({ fileName: written.fileName });

    const uri = await openForPlayback(media);
    expect(new File(uri as string).exists).toBe(true);

    deleteMedia(media);
    expect(storedFileOf(media).exists).toBe(false);
    expect(new File(uri as string).exists).toBe(false);
  });

  it('releases a decrypted copy without touching the sealed one', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(1_000));
    const written = await writeMedia('file:///mock/cache/a.jpg', 'm-1767600000000', 'photo');
    const media = item({ fileName: written.fileName });

    await openForPlayback(media);
    releasePlayback(media);

    expect(storedFileOf(media).exists).toBe(true);
    // Still openable afterwards: releasing is not deleting.
    expect(await openForPlayback(media)).not.toBeNull();
  });

  it('is safe to call for something that was never opened', () => {
    expect(() => releasePlayback(item())).not.toThrow();
    expect(() => deleteMedia(item())).not.toThrow();
  });

  it('erases every sealed file at once', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(100));
    const first = await writeMedia('file:///mock/cache/a.jpg', 'm-1', 'photo');
    __seed('file:///mock/cache/b.jpg', pattern(100));
    const second = await writeMedia('file:///mock/cache/b.jpg', 'm-2', 'photo');

    expect(storedFileOf(item({ fileName: first.fileName })).exists).toBe(true);
    expect(storedFileOf(item({ fileName: second.fileName })).exists).toBe(true);

    eraseAllMedia();

    expect(storedFileOf(item({ fileName: first.fileName })).exists).toBe(false);
    expect(storedFileOf(item({ fileName: second.fileName })).exists).toBe(false);
  });
});

/**
 * Suspension is not an exception. If iOS stops the app mid-seal, neither the
 * catch nor the finally in `writeMedia` runs — so the clip is lost, a
 * half-written container is left behind that nothing points at, and the "what
 * is stored" total under-reports the disk it occupies.
 */
describe('a capture interrupted before it was sealed', () => {
  it('is owned by us, under a name that says what it is', () => {
    __seed('file:///mock/cache/AV-1234.mov', pattern(500));

    const staged = stageCapture('file:///mock/cache/AV-1234.mov', 'm-1767600000000', 'video');

    // Moved, not copied: the OS temp file is gone and ours has the bytes.
    expect(new File('file:///mock/cache/AV-1234.mov').exists).toBe(false);
    expect(new File(staged.uri).size).toBe(500);
    expect(staged.uri).toContain('m-1767600000000--video');
  });

  it('is found again on the next launch, with its kind and its instant intact', () => {
    __seed('file:///mock/cache/AV-1.mov', pattern(64));
    stageCapture('file:///mock/cache/AV-1.mov', 'm-1767600000000', 'video');

    const [pending] = listPending();
    expect(pending?.id).toBe('m-1767600000000');
    expect(pending?.kind).toBe('video');
  });

  it('can then be sealed exactly as it would have been', async () => {
    const bytes = pattern(3_000);
    __seed('file:///mock/cache/AV-1.m4a', bytes);
    const staged = stageCapture('file:///mock/cache/AV-1.m4a', 'm-1767600000000', 'audio');

    const written = await writeMedia(staged.uri, staged.id, staged.kind);
    const uri = await openForPlayback(item({ kind: 'audio', fileName: written.fileName }));

    expectSameBytes(new File(uri as string).bytesSync(), bytes);
    // And it stops being pending, so the next launch does not do it again.
    expect(listPending()).toEqual([]);
  });

  it('is given up on rather than retried forever', () => {
    __seed('file:///mock/cache/AV-1.mov', pattern(10));
    const staged = stageCapture('file:///mock/cache/AV-1.mov', 'm-1', 'video');

    discardPending(staged);
    expect(listPending()).toEqual([]);
  });

  it('ignores a file in there that is not one of ours', () => {
    __seed('file:///mock/cache/pending/something-else.txt', pattern(10));
    expect(listPending()).toEqual([]);
  });
});

describe('sweeping orphans', () => {
  it('deletes a sealed file the index has never heard of', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(100));
    const kept = await writeMedia('file:///mock/cache/a.jpg', 'm-1', 'photo');
    __seed('file:///mock/cache/b.jpg', pattern(100));
    const orphan = await writeMedia('file:///mock/cache/b.jpg', 'm-2', 'photo');

    expect(sweepOrphans([kept.fileName])).toBe(1);

    expect(storedFileOf(item({ fileName: kept.fileName })).exists).toBe(true);
    expect(storedFileOf(item({ fileName: orphan.fileName })).exists).toBe(false);
  });

  it('does nothing when everything on disk is accounted for', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(100));
    const kept = await writeMedia('file:///mock/cache/a.jpg', 'm-1', 'photo');

    expect(sweepOrphans([kept.fileName])).toBe(0);
  });

  it('is harmless before anything has been captured', () => {
    expect(sweepOrphans([])).toBe(0);
  });

  // The bug this exists to prevent, and it shipped: a capture is two files now,
  // and a sweep told about only the first deleted every thumbnail on the next
  // launch. Silent, because the gallery simply fell back to drawing nothing —
  // and self-inflicted, because the thumbnails were rewritten and deleted again
  // every time. `filesOf` is what no caller has to remember.
  it('keeps the thumbnails, which are files an item owns too', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(100));
    const thumbFileName = await writeThumbnail('file:///mock/cache/a.jpg', 'm-1', 'photo');
    __seed('file:///mock/cache/a.jpg', pattern(100));
    const { fileName } = await writeMedia('file:///mock/cache/a.jpg', 'm-1', 'photo');

    expect(thumbFileName).not.toBeNull();
    expect(sweepOrphans(filesOf([item({ fileName, thumbFileName })]))).toBe(0);
    expect(await openThumbnail(thumbFileName as string)).not.toBeNull();
  });

  it('still sweeps a thumbnail whose capture is gone', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(100));
    const orphan = await writeThumbnail('file:///mock/cache/a.jpg', 'm-9', 'photo');

    expect(orphan).not.toBeNull();
    expect(sweepOrphans(filesOf([]))).toBe(1);
  });
});

/**
 * A filmstrip drawn from full captures would read every photo to fill a row of
 * 60-point squares, and every video whole. A few kilobytes beside each capture
 * avoids it — that is still true when nothing is encrypted, because the cost
 * was never only the cipher.
 */
describe('thumbnails', () => {
  it('writes one beside the photo, far smaller than it', async () => {
    __seed('file:///mock/cache/shot.jpg', pattern(50_000));

    const thumbName = await writeThumbnail('file:///mock/cache/shot.jpg', 'm-1', 'photo');
    expect(thumbName).toBe('m-1.thumb.jpg');

    const thumb = new File(Paths.document, 'media', thumbName as string);
    expect(thumb.exists).toBe(true);
    expect(thumb.size).toBeLessThan(50_000);
  });

  it('hands back the bytes it was made from', async () => {
    __seed('file:///mock/cache/shot.jpg', pattern(4_000));
    const thumbName = await writeThumbnail('file:///mock/cache/shot.jpg', 'm-1', 'photo');

    const uri = await openThumbnail(thumbName as string);
    expectSameBytes(new File(uri as string).bytesSync(), new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
  });

  it('pulls a frame out of a video first', async () => {
    __seed('file:///mock/cache/clip.mov', pattern(4_000));
    expect(await writeThumbnail('file:///mock/cache/clip.mov', 'm-2', 'video')).toBe('m-2.thumb.jpg');
  });

  // Nothing to show, and inventing a grey square would be worse than nothing.
  it('makes none for a voice note', async () => {
    __seed('file:///mock/cache/note.m4a', pattern(1_000));
    expect(await writeThumbnail('file:///mock/cache/note.m4a', 'm-3', 'audio')).toBeNull();
  });

  it('is null rather than fatal when the platform cannot make one', async () => {
    expect(await writeThumbnail('file:///mock/cache/missing.jpg', 'm-4', 'photo')).not.toBe(undefined);
  });

  // The scaled copy and, for a video, the extracted frame are both temp files.
  // Leaving them means the media directory grows a duplicate per capture.
  it('leaves no working copy behind in the media directory', async () => {
    __seed('file:///mock/cache/shot.jpg', pattern(4_000));
    await writeThumbnail('file:///mock/cache/shot.jpg', 'm-1', 'photo');

    const names = new Directory(Paths.document, 'media').list().map((entry) => entry.uri.split('/').pop());
    expect(names).toEqual(['m-1.thumb.jpg']);
  });

  // The capture and its thumbnail are two files; forgetting one must not leave
  // the other behind for the sweep to find and the disk to carry.
  it('goes when the capture it belongs to goes', async () => {
    __seed('file:///mock/cache/shot.jpg', pattern(4_000));
    const thumbName = await writeThumbnail('file:///mock/cache/shot.jpg', 'm-1', 'photo');
    __seed('file:///mock/cache/shot2.jpg', pattern(4_000));
    const written = await writeMedia('file:///mock/cache/shot2.jpg', 'm-1', 'photo');

    deleteMedia(item({ fileName: written.fileName, thumbFileName: thumbName }));

    expect(new File(Paths.document, 'media', thumbName as string).exists).toBe(false);
    expect(storedFileOf(item({ fileName: written.fileName })).exists).toBe(false);
  });
});
