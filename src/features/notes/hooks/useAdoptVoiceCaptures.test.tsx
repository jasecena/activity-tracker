import { renderHook, waitFor } from '@testing-library/react-native';

import type { MediaItem } from '@/core/media';
import type { UseMedia } from '@/features/capture/hooks/useMedia';
import { adoptFromMedia } from '@/services/noteAudio';

import type { UseDayNotes } from './useDayNotes';
import { useAdoptVoiceCaptures } from './useAdoptVoiceCaptures';

/**
 * Hiding a voice note from the gallery is only acceptable if it arrives
 * somewhere else. Without this it would be a row nothing renders: still in the
 * index, still on disk, unreachable from anywhere in the app.
 */

jest.mock('@/services/noteAudio', () => ({
  adoptFromMedia: jest.fn(() => ({ fileName: 'voice-1.m4a', byteLength: 4096 })),
}));

const CAPTURED_AT = Date.UTC(2026, 0, 5, 8, 0, 0);

function capture(overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: `m-${CAPTURED_AT}`,
    kind: 'audio',
    capturedAt: CAPTURED_AT,
    durationMs: 32_000,
    fileName: `m-${CAPTURED_AT}.m4a`,
    thumbFileName: null,
    byteLength: 4096,
    at: { lat: 0.01, lon: 0.02 },
    note: 'what I said about it',
    orientation: null,
    ...overrides,
  };
}

function stores(items: readonly MediaItem[]) {
  const write = jest.fn();
  const forget = jest.fn();
  const media = { ready: true, items, forget } as unknown as UseMedia;
  const notes = { ready: true, notes: [], write } as unknown as UseDayNotes;
  return { media, notes, write, forget };
}

beforeEach(() => {
  jest.clearAllMocks();
  (adoptFromMedia as jest.Mock).mockReturnValue({ fileName: 'voice-1.m4a', byteLength: 4096 });
});

it('turns a voice capture into a note holding the same recording', async () => {
  const { media, notes, write } = stores([capture()]);

  await renderHook(() => useAdoptVoiceCaptures(media, notes));

  await waitFor(() => expect(write).toHaveBeenCalled());
  expect(write).toHaveBeenCalledWith(CAPTURED_AT, '', 'what I said about it', {
    fileName: 'voice-1.m4a',
    byteLength: 4096,
    durationMs: 32_000,
    at: { lat: 0.01, lon: 0.02 },
    // Unlocked, like every recording arrives. Adopting one from an older build
    // is not the moment to decide its owner wanted it kept.
    locked: false,
  });
});

it('moves the file out of the media directory as it goes', async () => {
  const { media, notes } = stores([capture()]);

  await renderHook(() => useAdoptVoiceCaptures(media, notes));

  await waitFor(() => expect(adoptFromMedia).toHaveBeenCalledWith(`m-${CAPTURED_AT}.m4a`, CAPTURED_AT));
});

it('drops the capture from the library once the note has it', async () => {
  const { media, notes, forget } = stores([capture()]);

  await renderHook(() => useAdoptVoiceCaptures(media, notes));

  await waitFor(() => expect(forget).toHaveBeenCalledWith(`m-${CAPTURED_AT}`));
});

/**
 * A capture whose bytes have already gone still becomes a note if anything was
 * typed on it — the words are the part nothing can reconstruct — and `noteAt`
 * drops it if there was nothing at all.
 */
it('keeps the words when the recording itself has gone', async () => {
  (adoptFromMedia as jest.Mock).mockReturnValue(null);
  const { media, notes, write } = stores([capture()]);

  await renderHook(() => useAdoptVoiceCaptures(media, notes));

  await waitFor(() => expect(write).toHaveBeenCalledWith(CAPTURED_AT, '', 'what I said about it', null));
});

it('leaves photographs and video exactly where they are', async () => {
  const { media, notes, write, forget } = stores([capture({ kind: 'photo' }), capture({ kind: 'video' })]);

  await renderHook(() => useAdoptVoiceCaptures(media, notes));

  expect(write).not.toHaveBeenCalled();
  expect(forget).not.toHaveBeenCalled();
});

/**
 * Both stores read their list out of the closure they were built in, so a loop
 * would write several notes over one snapshot and keep the last. One per pass,
 * and the state updates bring the next one round.
 */
it('takes one at a time rather than a whole library at once', async () => {
  const { media, notes, write } = stores([capture(), capture({ id: 'm-2', capturedAt: CAPTURED_AT + 60_000 })]);

  await renderHook(() => useAdoptVoiceCaptures(media, notes));

  await waitFor(() => expect(write).toHaveBeenCalledTimes(1));
});

it('waits until both stores have actually loaded', async () => {
  const { notes, write } = stores([capture()]);
  const unloaded = { ready: false, items: [capture()], forget: jest.fn() } as unknown as UseMedia;

  await renderHook(() => useAdoptVoiceCaptures(unloaded, notes));

  expect(write).not.toHaveBeenCalled();
});
