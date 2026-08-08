import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';

import { mediaIdFor } from '@/core/media';
import { openThumbnail, stageCapture, writeMedia, writeThumbnail } from '@/services/mediaStore';
import { STORAGE_KEYS, writeJson } from '@/services/storage';
import { sealBytes } from '@/services/vault';

import { useMedia } from './useMedia';

/**
 * Suspension is not an exception. If iOS stops the app between the camera
 * handing a clip over and the seal finishing, nothing runs — no catch, no
 * finally — so the capture used to be lost and a half-written container left
 * behind that nothing pointed at.
 */

const { __reset, __seed } = FileSystem as unknown as typeof import('../../../../__mocks__/expo-file-system');

const CAPTURED_AT = 1_767_600_000_000;

function bytes4(length: number): Uint8Array {
  return bytes(length);
}

/** A container in the format an earlier build wrote: "AVM1" then [len][sealed]. */
async function seedSealed(fileName: string, plaintext: Uint8Array): Promise<void> {
  const sealed = await sealBytes(plaintext);
  const length = sealed.length;
  const header = new Uint8Array([
    0x41,
    0x56,
    0x4d,
    0x31,
    (length >>> 24) & 0xff,
    (length >>> 16) & 0xff,
    (length >>> 8) & 0xff,
    length & 0xff,
  ]);

  const out = new Uint8Array(header.length + sealed.length);
  out.set(header, 0);
  out.set(sealed, header.length);

  const directory = new Directory(Paths.document, 'media');
  if (!directory.exists) directory.create({ intermediates: true });
  new File(directory, fileName).write(out);
}

function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) out[index] = (index * 7 + 3) % 251;
  return out;
}

beforeEach(async () => {
  __reset();
  await writeJson(STORAGE_KEYS.media, []);
});

it('finishes a capture that was interrupted before it was sealed', async () => {
  // Staged but never sealed: exactly what a suspension leaves behind.
  __seed('file:///mock/cache/AV-1.mov', bytes(2_000));
  stageCapture('file:///mock/cache/AV-1.mov', mediaIdFor(CAPTURED_AT), 'video');

  const { result } = await renderHook(() => useMedia());
  await act(async () => {
    await Promise.resolve();
  });

  expect(result.current.items).toHaveLength(1);
  expect(result.current.items[0]?.capturedAt).toBe(CAPTURED_AT);
  expect(result.current.items[0]?.kind).toBe('video');
});

it('sweeps a sealed file the index has never heard of', async () => {
  __seed('file:///mock/cache/orphan.jpg', bytes(400));
  const orphan = await writeMedia('file:///mock/cache/orphan.jpg', 'm-1', 'photo');
  expect(new File(Paths.document, 'media', orphan.fileName).exists).toBe(true);

  await renderHook(() => useMedia());
  await act(async () => {
    await Promise.resolve();
  });

  expect(new File(Paths.document, 'media', orphan.fileName).exists).toBe(false);
});

// The sweep runs after recovery, or it would delete what recovery just wrote.
it('does not sweep away what it has only just recovered', async () => {
  __seed('file:///mock/cache/AV-2.m4a', bytes(900));
  stageCapture('file:///mock/cache/AV-2.m4a', mediaIdFor(CAPTURED_AT), 'audio');

  const { result } = await renderHook(() => useMedia());
  await act(async () => {
    await Promise.resolve();
  });

  const item = result.current.items[0];
  expect(item).toBeDefined();
  expect(new File(Paths.document, 'media', item?.fileName ?? '').exists).toBe(true);
});

/**
 * Thumbnails arrived after the first captures did, so a library full of photos
 * had none — and a gallery with no thumbnails decrypts whole videos to draw a
 * filmstrip, which is the cost they exist to avoid. Given one on the first run
 * after the update, once, and never again.
 */
describe('captures stored before thumbnails existed', () => {
  it('gives each one a thumbnail on the first run', async () => {
    __seed('file:///mock/cache/old.jpg', bytes(400));
    const stored = await writeMedia('file:///mock/cache/old.jpg', 'm-1', 'photo');
    await writeJson(STORAGE_KEYS.media, [
      {
        id: 'm-1',
        kind: 'photo',
        capturedAt: CAPTURED_AT,
        durationMs: null,
        fileName: stored.fileName,
        thumbFileName: null,
        byteLength: stored.byteLength,
        at: null,
        note: '',
      },
    ]);

    const { result } = await renderHook(() => useMedia());
    // `waitFor`, not a drained microtask queue: opening a capture yields to the
    // UI between chunks with `setTimeout(0)`, which is a macrotask.
    await waitFor(() => expect(result.current.items[0]?.thumbFileName).toBe('m-1.thumb.jpg'));

    const thumbFileName = result.current.items[0]?.thumbFileName;
    expect(await openThumbnail(thumbFileName as string)).not.toBeNull();
  });

  // The expensive path — it decrypts the capture whole — so running it again on
  // something that already has one would be a cost paid every single launch.
  it('leaves a capture that already has one alone', async () => {
    __seed('file:///mock/cache/new.jpg', bytes(400));
    const thumbFileName = await writeThumbnail('file:///mock/cache/new.jpg', 'm-2', 'photo');
    __seed('file:///mock/cache/new.jpg', bytes(400));
    const stored = await writeMedia('file:///mock/cache/new.jpg', 'm-2', 'photo');
    await writeJson(STORAGE_KEYS.media, [
      {
        id: 'm-2',
        kind: 'photo',
        capturedAt: CAPTURED_AT,
        durationMs: null,
        fileName: stored.fileName,
        thumbFileName,
        byteLength: stored.byteLength,
        at: null,
        note: '',
      },
    ]);

    const { result } = await renderHook(() => useMedia());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.items[0]?.thumbFileName).toBe(thumbFileName);
  });

  // A voice note has nothing to show, and asking for one would be a whole
  // decrypt producing nothing — on every launch, forever.
  it('does not go looking for a picture of a voice note', async () => {
    __seed('file:///mock/cache/note.m4a', bytes(400));
    const stored = await writeMedia('file:///mock/cache/note.m4a', 'm-3', 'audio');
    await writeJson(STORAGE_KEYS.media, [
      {
        id: 'm-3',
        kind: 'audio',
        capturedAt: CAPTURED_AT,
        durationMs: 4_000,
        fileName: stored.fileName,
        thumbFileName: null,
        byteLength: stored.byteLength,
        at: null,
        note: '',
      },
    ]);

    const { result } = await renderHook(() => useMedia());
    await act(async () => {
      await Promise.resolve();
    });

    expect(result.current.items[0]?.thumbFileName).toBeNull();
  });
});

/**
 * A library sealed by an earlier build has to keep working. Losing every photo
 * somebody took because a storage decision changed is not a thing an app gets
 * to do, so the files are unsealed in place on the next launch.
 */
describe('captures sealed by an earlier build', () => {
  it('unseals them in place and points the index at the plain file', async () => {
    const bytes = bytes4(2_000);
    await seedSealed('m-1.jpg.avm', bytes);
    await writeJson(STORAGE_KEYS.media, [
      {
        id: 'm-1',
        kind: 'photo',
        capturedAt: CAPTURED_AT,
        durationMs: null,
        fileName: 'm-1.jpg.avm',
        thumbFileName: null,
        byteLength: bytes.length,
        at: null,
        note: '',
      },
    ]);

    const { result } = await renderHook(() => useMedia());
    await waitFor(() => expect(result.current.items[0]?.fileName).toBe('m-1.jpg'));

    const stored = new File(Paths.document, 'media', 'm-1.jpg');
    expect(stored.exists).toBe(true);
    expect(stored.bytesSync().length).toBe(bytes.length);
    // No second copy: two of every video is what a phone has no room for.
    expect(new File(Paths.document, 'media', 'm-1.jpg.avm').exists).toBe(false);
  });

  // Unsealed first, then given a thumbnail — the second step reads the file the
  // first one produced, so the order is not incidental.
  it('gives one a thumbnail once it can read it', async () => {
    await seedSealed('m-2.jpg.avm', bytes4(2_000));
    await writeJson(STORAGE_KEYS.media, [
      {
        id: 'm-2',
        kind: 'photo',
        capturedAt: CAPTURED_AT,
        durationMs: null,
        fileName: 'm-2.jpg.avm',
        thumbFileName: null,
        byteLength: 2_000,
        at: null,
        note: '',
      },
    ]);

    const { result } = await renderHook(() => useMedia());
    await waitFor(() => expect(result.current.items[0]?.thumbFileName).toBe('m-2.thumb.jpg'));
    expect(result.current.items[0]?.fileName).toBe('m-2.jpg');
  });
});
