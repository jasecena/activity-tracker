import { act, renderHook, waitFor } from '@testing-library/react-native';
import { Directory, File, Paths } from 'expo-file-system';
import * as FileSystem from 'expo-file-system';

import { mediaIdFor } from '@/core/media';
import { openThumbnail, stageCapture, unsealInPlace, writeMedia, writeThumbnail } from '@/services/mediaStore';
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
  });

  // The duplicate is temporary, and this is what makes it so: once the index
  // names the plain file, the sealed one is an orphan and the next launch's
  // sweep takes it. Two copies of every video is not something a phone has
  // room for indefinitely.
  it('sweeps the sealed original on the launch after that', async () => {
    await seedSealed('m-6.jpg.avm', bytes4(2_000));
    await writeJson(STORAGE_KEYS.media, [
      {
        id: 'm-6',
        kind: 'photo',
        capturedAt: CAPTURED_AT,
        durationMs: null,
        fileName: 'm-6.jpg.avm',
        thumbFileName: null,
        byteLength: 2_000,
        at: null,
        note: '',
      },
    ]);

    const first = await renderHook(() => useMedia());
    await waitFor(() => expect(first.result.current.items[0]?.fileName).toBe('m-6.jpg'));
    expect(new File(Paths.document, 'media', 'm-6.jpg.avm').exists).toBe(true);

    const second = await renderHook(() => useMedia());
    await waitFor(() => expect(second.result.current.ready).toBe(true));

    await waitFor(() => expect(new File(Paths.document, 'media', 'm-6.jpg.avm').exists).toBe(false));
    expect(new File(Paths.document, 'media', 'm-6.jpg').exists).toBe(true);
  });

  /**
   * The window that could have destroyed a capture.
   *
   * Unsealing writes the plain file and the index moves to point at it. If iOS
   * suspends the app in between — which is the ordinary way this app stops —
   * the next launch has an index naming the sealed file and a plain file
   * nothing points at. Deleting the sealed original at the end of the unseal
   * would make that plain file an orphan, and the launch sweep would take it.
   * The photo would be gone, silently, on a phone that did nothing wrong.
   *
   * So the original stays until the index has moved and the sweep can see it
   * is an orphan. The cost is a duplicate on disk for one launch.
   */
  it('keeps the sealed original until the index has moved off it', async () => {
    await seedSealed('m-9.jpg.avm', bytes4(2_000));
    await writeJson(STORAGE_KEYS.media, [
      {
        id: 'm-9',
        kind: 'photo',
        capturedAt: CAPTURED_AT,
        durationMs: null,
        fileName: 'm-9.jpg.avm',
        thumbFileName: null,
        byteLength: 2_000,
        at: null,
        note: '',
      },
    ]);

    const { result } = await renderHook(() => useMedia());
    await waitFor(() => expect(result.current.items[0]?.fileName).toBe('m-9.jpg'));

    expect(new File(Paths.document, 'media', 'm-9.jpg').exists).toBe(true);
    expect(new File(Paths.document, 'media', 'm-9.jpg.avm').exists).toBe(true);
  });

  // Simulating the crash: the file was unsealed, the index never got written.
  // The launch that follows must not treat the plain file as rubbish.
  it('survives the app dying between unsealing and writing the index', async () => {
    await seedSealed('m-8.jpg.avm', bytes4(2_000));
    await writeJson(STORAGE_KEYS.media, [
      {
        id: 'm-8',
        kind: 'photo',
        capturedAt: CAPTURED_AT,
        durationMs: null,
        fileName: 'm-8.jpg.avm',
        thumbFileName: null,
        byteLength: 2_000,
        at: null,
        note: '',
      },
    ]);

    // What the interrupted run left behind: a plain copy nothing points at.
    await unsealInPlace('m-8.jpg.avm');
    expect(new File(Paths.document, 'media', 'm-8.jpg').exists).toBe(true);

    const { result } = await renderHook(() => useMedia());
    await waitFor(() => expect(result.current.items[0]?.fileName).toBe('m-8.jpg'));

    // The capture is readable either way round — which it would not be if the
    // sweep had taken the plain file and the unseal had taken the sealed one.
    expect(new File(Paths.document, 'media', 'm-8.jpg').exists).toBe(true);
    expect(new File(Paths.document, 'media', 'm-8.jpg').bytesSync().length).toBe(2_000);
  });

  // A sealed thumbnail is ciphertext, and an `<Image>` handed ciphertext draws
  // nothing. Left alone it looked fine in the index and blank on the screen.
  it('replaces a thumbnail that is still sealed', async () => {
    await seedSealed('m-7.jpg.avm', bytes4(2_000));
    await seedSealed('m-7.thumb.avm', bytes4(200));
    await writeJson(STORAGE_KEYS.media, [
      {
        id: 'm-7',
        kind: 'photo',
        capturedAt: CAPTURED_AT,
        durationMs: null,
        fileName: 'm-7.jpg.avm',
        thumbFileName: 'm-7.thumb.avm',
        byteLength: 2_000,
        at: null,
        note: '',
      },
    ]);

    const { result } = await renderHook(() => useMedia());
    await waitFor(() => expect(result.current.items[0]?.thumbFileName).toBe('m-7.thumb.jpg'));
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

/**
 * A thumbnail rewritten under its old name is invisible: the gallery caches
 * decrypted thumbnails by item and React Native caches images by URI, so the
 * new bytes sit behind two copies of the old picture. Reported after rotating
 * a photograph — the capture turned and its thumbnail did not.
 */
describe('keeping a thumbnail in step with its capture', () => {
  it('gives a rotated photograph a thumbnail under a new name', async () => {
    const { result } = await renderHook(() => useMedia());
    await waitFor(() => expect(result.current.ready).toBe(true));

    __seed('file:///mock/cache/turn.jpg', bytes(400));
    await act(async () => {
      await result.current.keep('file:///mock/cache/turn.jpg', 'photo');
    });
    const before = result.current.items[0];

    await act(async () => {
      await result.current.rotate(before!.id);
    });

    expect(result.current.items[0]?.thumbFileName).not.toBe(before?.thumbFileName);
    expect(result.current.items[0]?.thumbFileName).toMatch(/\.thumb\.1\.jpg$/);
  });

  it('keeps advancing the name, so turning twice is visible twice', async () => {
    const { result } = await renderHook(() => useMedia());
    await waitFor(() => expect(result.current.ready).toBe(true));

    __seed('file:///mock/cache/turn2.jpg', bytes(400));
    await act(async () => {
      await result.current.keep('file:///mock/cache/turn2.jpg', 'photo');
    });
    const id = result.current.items[0]!.id;

    await act(async () => {
      await result.current.rotate(id);
    });
    await act(async () => {
      await result.current.rotate(id);
    });

    expect(result.current.items[0]?.thumbFileName).toMatch(/\.thumb\.2\.jpg$/);
  });

  it('rebuilds every thumbnail on request, leaving the captures alone', async () => {
    const { result } = await renderHook(() => useMedia());
    await waitFor(() => expect(result.current.ready).toBe(true));

    __seed('file:///mock/cache/one.jpg', bytes(400));
    __seed('file:///mock/cache/two.jpg', bytes(400));
    await act(async () => {
      await result.current.keep('file:///mock/cache/one.jpg', 'photo');
    });
    await act(async () => {
      await result.current.keep('file:///mock/cache/two.jpg', 'photo');
    });
    const fileNames = result.current.items.map((item) => item.fileName);
    // However many rows those two keeps produced. Ids are derived from the
    // instant, so two captures inside one millisecond are one capture — which
    // is the store working as designed, and not something to assert around.
    const stored = result.current.items.length;

    let rebuilt = 0;
    await act(async () => {
      rebuilt = await result.current.rebuildThumbnails();
    });

    expect(rebuilt).toBe(stored);
    expect(result.current.items.map((item) => item.fileName)).toEqual(fileNames);
    for (const item of result.current.items) expect(item.thumbFileName).toMatch(/\.thumb\.1\.jpg$/);
  });
});
