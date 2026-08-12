import { act, renderHook, waitFor } from '@testing-library/react-native';
import * as KeepAwakeModule from 'expo-keep-awake';

import type { UseMedia } from './useMedia';
import { useVoiceNote } from './useVoiceNote';

const awake = KeepAwakeModule as unknown as typeof import('../../../../__mocks__/expo-keep-awake');

/**
 * A voice note used to be the third mode of the camera screen. It runs from the
 * Day screen now, beside the button for writing one down, and what moved with
 * it is everything that was hard-won: the position read at the *start*, the
 * screen held awake across the save, and no orientation on a recording that has
 * no picture.
 */

function mediaStub(keep: UseMedia['keep']): UseMedia {
  return { ready: true, items: [], keep, annotate: () => undefined, forget: () => undefined } as unknown as UseMedia;
}

beforeEach(() => {
  jest.clearAllMocks();
});

it('records, stops, and hands the clip over as audio', async () => {
  const keep = jest.fn(async () => null) as unknown as UseMedia['keep'];
  const { result } = await renderHook(() => useVoiceNote(mediaStub(keep)));

  await act(async () => result.current.toggle());
  expect(result.current.recording).toBe(true);

  await act(async () => result.current.toggle());

  await waitFor(() => expect(keep).toHaveBeenCalledWith(expect.any(String), 'audio', expect.anything()));
});

/**
 * Null, not the phone's orientation: a voice note has no picture, so which way
 * the phone was held is a fact about nothing.
 */
it('stores no orientation, because there is no picture to turn', async () => {
  const keep = jest.fn(async () => null) as unknown as UseMedia['keep'];
  const { result } = await renderHook(() => useVoiceNote(mediaStub(keep)));

  await act(async () => result.current.toggle());
  await act(async () => result.current.toggle());

  await waitFor(() =>
    expect(keep).toHaveBeenCalledWith(expect.any(String), 'audio', expect.objectContaining({ orientation: null })),
  );
});

/**
 * The reason the position lives in a ref. `stop` resolves inside a closure
 * created before the reading arrived, so as state it would be null then and
 * null for ever after — asked for, received, and dropped one render away.
 */
it('keeps the position read when recording started', async () => {
  const keep = jest.fn(async () => null) as unknown as UseMedia['keep'];
  const { result } = await renderHook(() => useVoiceNote(mediaStub(keep)));

  await act(async () => result.current.toggle());
  // Let the position request settle before stopping, the way a real recording
  // of any length would.
  await act(async () => undefined);
  await act(async () => result.current.toggle());

  await waitFor(() => expect(keep).toHaveBeenCalled());
  const options = (keep as jest.Mock).mock.calls[0]?.[2];
  expect(options.at).not.toBeUndefined();
});

/**
 * Nothing about recording counts as user activity, so a phone put down mid-note
 * looks to the auto-lock timer exactly like a phone left alone — reported from
 * a device as a clip cut off half a minute in.
 */
it('holds the screen awake while it is busy, and lets go afterwards', async () => {
  const keep = jest.fn(async () => null) as unknown as UseMedia['keep'];
  const { result } = await renderHook(() => useVoiceNote(mediaStub(keep)));

  await act(async () => result.current.toggle());
  expect(awake.activateKeepAwakeAsync).toHaveBeenCalled();

  await act(async () => result.current.toggle());

  await waitFor(() => expect(awake.deactivateKeepAwake).toHaveBeenCalled());
});

it('reports nothing in progress before anything is pressed', async () => {
  const { result } = await renderHook(() => useVoiceNote(mediaStub(jest.fn() as unknown as UseMedia['keep'])));

  expect(result.current.recording).toBe(false);
  expect(result.current.saving).toBe(false);
  expect(result.current.elapsedMs).toBe(0);
});
