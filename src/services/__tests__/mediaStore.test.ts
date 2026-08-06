import * as FileSystem from 'expo-file-system';
import { File, Paths } from 'expo-file-system';

import type { MediaItem } from '@/core/media';

import { deleteMedia, eraseAllMedia, openForPlayback, releasePlayback, writeMedia } from '../mediaStore';

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

function sealedFileOf(media: MediaItem): File {
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

  it('writes something that is not the plaintext', async () => {
    const bytes = pattern(512);
    __seed('file:///mock/cache/capture-1.jpg', bytes);

    const written = await writeMedia('file:///mock/cache/capture-1.jpg', 'm-1767600000000', 'photo');
    const onDisk = sealedFileOf(item({ fileName: written.fileName })).bytesSync();

    expect(sameBytes(onDisk, bytes)).toBe(false);
    // Magic, a length prefix, a nonce and a tag, all on top of the payload.
    expect(onDisk.length).toBeGreaterThan(bytes.length);
    expect(written.byteLength).toBe(onDisk.length);
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

  // The three ways a container goes bad. All of them must fail closed: a
  // truncated video that decrypts into noise is worse than one that will not
  // open, because it looks like a recording and is not.
  it('refuses a file that is not one of ours', async () => {
    new File(Paths.document, 'media').create();
    const sealed = sealedFileOf(item());
    sealed.write(pattern(300));
    expect(await openForPlayback(item())).toBeNull();
  });

  it('refuses a container truncated mid-chunk', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(4_000));
    const written = await writeMedia('file:///mock/cache/a.jpg', 'm-1767600000000', 'photo');

    const media = item({ fileName: written.fileName });
    const sealed = sealedFileOf(media);
    sealed.write(sealed.bytesSync().slice(0, 200));

    expect(await openForPlayback(media)).toBeNull();
  });

  it('refuses a container whose bytes were altered', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(4_000));
    const written = await writeMedia('file:///mock/cache/a.jpg', 'm-1767600000000', 'photo');

    const media = item({ fileName: written.fileName });
    const sealed = sealedFileOf(media);
    const bytes = sealed.bytesSync();
    // Well past the magic and the length prefix, so this is the ciphertext.
    bytes[100] = (bytes[100] ?? 0) ^ 0xff;
    sealed.write(bytes);

    expect(await openForPlayback(media)).toBeNull();
  });

  it('leaves no half-written plaintext behind when it refuses', async () => {
    new File(Paths.document, 'media').create();
    sealedFileOf(item()).write(pattern(300));

    await openForPlayback(item());
    expect(new File(Paths.cache, 'play-m-1767600000000.jpg').exists).toBe(false);
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
    expect(sealedFileOf(media).exists).toBe(false);
    expect(new File(uri as string).exists).toBe(false);
  });

  it('releases a decrypted copy without touching the sealed one', async () => {
    __seed('file:///mock/cache/a.jpg', pattern(1_000));
    const written = await writeMedia('file:///mock/cache/a.jpg', 'm-1767600000000', 'photo');
    const media = item({ fileName: written.fileName });

    await openForPlayback(media);
    releasePlayback(media);

    expect(sealedFileOf(media).exists).toBe(true);
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

    expect(sealedFileOf(item({ fileName: first.fileName })).exists).toBe(true);
    expect(sealedFileOf(item({ fileName: second.fileName })).exists).toBe(true);

    eraseAllMedia();

    expect(sealedFileOf(item({ fileName: first.fileName })).exists).toBe(false);
    expect(sealedFileOf(item({ fileName: second.fileName })).exists).toBe(false);
  });
});
