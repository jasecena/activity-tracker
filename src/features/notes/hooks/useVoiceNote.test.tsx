import { act, renderHook, waitFor } from '@testing-library/react-native';
import { setAudioModeAsync } from 'expo-audio';
import * as KeepAwakeModule from 'expo-keep-awake';

import { keepNoteAudio } from '@/services/noteAudio';

import { useVoiceNote } from './useVoiceNote';

/**
 * A voice note was the camera's third mode, then a button beside the pen, and
 * is now a field of the note itself. What it writes is a *note's recording* —
 * `services/noteAudio.ts`, the diary's own directory — rather than a capture in
 * the media library, and it hands the result back rather than storing anything:
 * nothing exists until the note is saved, which is what makes recording and
 * typing the same act.
 *
 * What moved with it from the camera screen is everything that was hard-won:
 * the position read at the *start*, and the screen held awake across the save.
 */

jest.mock('@/services/noteAudio', () => ({
  keepNoteAudio: jest.fn(() => ({ fileName: 'voice-1.m4a', byteLength: 2048 })),
}));

const awake = KeepAwakeModule as unknown as typeof import('../../../../__mocks__/expo-keep-awake');

beforeEach(() => {
  jest.clearAllMocks();
  (keepNoteAudio as jest.Mock).mockReturnValue({ fileName: 'voice-1.m4a', byteLength: 2048 });
});

it('records, stops, and hands back a recording the note can hold', async () => {
  const recorded = jest.fn();
  const { result } = await renderHook(() => useVoiceNote(recorded));

  await act(async () => result.current.start());
  expect(result.current.recording).toBe(true);

  await act(async () => result.current.stop());

  await waitFor(() => expect(recorded).toHaveBeenCalled());
  expect(recorded.mock.calls[0]?.[0]).toEqual(
    expect.objectContaining({ fileName: 'voice-1.m4a', byteLength: 2048, durationMs: expect.any(Number) }),
  );
});

/**
 * The diary's directory, not the media one. A recording filed with the captures
 * is a file `sweepOrphans` has never heard of, and it deletes those on launch.
 */
it('writes into the diary’s own store', async () => {
  const { result } = await renderHook(() => useVoiceNote(jest.fn()));

  await act(async () => result.current.start());
  await act(async () => result.current.stop());

  await waitFor(() => expect(keepNoteAudio).toHaveBeenCalledWith(expect.any(String), expect.any(Number)));
});

/**
 * The reason the position lives in a ref. `stop` resolves inside a closure
 * created before the reading arrived, so as state it would be null then and
 * null for ever after — asked for, received, and dropped one render away.
 */
it('keeps the position read when recording started', async () => {
  const recorded = jest.fn();
  const { result } = await renderHook(() => useVoiceNote(recorded));

  await act(async () => result.current.start());
  // Let the position request settle before stopping, the way a real recording
  // of any length would.
  await act(async () => undefined);
  await act(async () => result.current.stop());

  await waitFor(() => expect(recorded).toHaveBeenCalled());
  expect(recorded.mock.calls[0]?.[0].at).not.toBeUndefined();
});

/**
 * Null rather than a name pointing at nothing: a note claiming a recording it
 * cannot play is worse than one that says it was typed.
 */
it('hands back nothing when the recording could not be stored', async () => {
  (keepNoteAudio as jest.Mock).mockReturnValue(null);
  const recorded = jest.fn();
  const { result } = await renderHook(() => useVoiceNote(recorded));

  await act(async () => result.current.start());
  await act(async () => result.current.stop());

  await waitFor(() => expect(result.current.saving).toBe(false));
  expect(recorded).not.toHaveBeenCalled();
});

/**
 * Nothing about recording counts as user activity, so a phone put down mid-note
 * looks to the auto-lock timer exactly like a phone left alone — reported from
 * a device as a clip cut off half a minute in.
 */
it('holds the screen awake while it is busy, and lets go afterwards', async () => {
  const { result } = await renderHook(() => useVoiceNote(jest.fn()));

  await act(async () => result.current.start());
  expect(awake.activateKeepAwakeAsync).toHaveBeenCalled();

  await act(async () => result.current.stop());

  await waitFor(() => expect(awake.deactivateKeepAwake).toHaveBeenCalled());
});

/**
 * Start and stop are separate calls, so the control above can require a hold to
 * begin and a tap to end. Pressing start twice must not be two recordings.
 */
it('ignores a second start while one is already running', async () => {
  const { result } = await renderHook(() => useVoiceNote(jest.fn()));

  await act(async () => result.current.start());
  await act(async () => result.current.start());
  await act(async () => result.current.stop());

  await waitFor(() => expect(keepNoteAudio).toHaveBeenCalledTimes(1));
});

it('ignores a stop when nothing is being recorded', async () => {
  const { result } = await renderHook(() => useVoiceNote(jest.fn()));

  await act(async () => result.current.stop());

  expect(keepNoteAudio).not.toHaveBeenCalled();
});

/**
 * An iOS session left in recording mode routes playback to the receiver, so the
 * note would play back faintly as if held to an ear — and the player is now in
 * the same sheet, a tap from the button that just finished.
 */
it('gives recording mode back so the note plays out of the speaker', async () => {
  const { result } = await renderHook(() => useVoiceNote(jest.fn()));

  await act(async () => result.current.start());
  await act(async () => result.current.stop());

  await waitFor(() =>
    expect(setAudioModeAsync).toHaveBeenLastCalledWith(expect.objectContaining({ allowsRecording: false })),
  );
});

it('reports nothing in progress before anything is pressed', async () => {
  const { result } = await renderHook(() => useVoiceNote(jest.fn()));

  expect(result.current.recording).toBe(false);
  expect(result.current.saving).toBe(false);
  expect(result.current.elapsedMs).toBe(0);
});
