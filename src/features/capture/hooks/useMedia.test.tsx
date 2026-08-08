import { act, renderHook } from '@testing-library/react-native';
import { File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';

import { mediaIdFor } from '@/core/media';
import { openThumbnail, stageCapture, writeMedia, writeThumbnail } from '@/services/mediaStore';
import { STORAGE_KEYS, writeJson } from '@/services/storage';

import { useMedia } from './useMedia';

/**
 * Suspension is not an exception. If iOS stops the app between the camera
 * handing a clip over and the seal finishing, nothing runs — no catch, no
 * finally — so the capture used to be lost and a half-written container left
 * behind that nothing pointed at.
 */

const { __reset, __seed } = FileSystem as unknown as typeof import('../../../../__mocks__/expo-file-system');

const CAPTURED_AT = 1_767_600_000_000;

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
    await act(async () => {
      await Promise.resolve();
    });

    const thumbFileName = result.current.items[0]?.thumbFileName;
    expect(thumbFileName).toBe('m-1.thumb.avm');
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
