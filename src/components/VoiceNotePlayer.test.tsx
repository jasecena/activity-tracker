import { fireEvent, render, screen } from '@testing-library/react-native';
import { useAudioPlayer } from 'expo-audio';

import type { NoteVoice } from '@/core/day';
import { silenceAudio } from '@/services/audioFocus';

import { VoiceNotePlayer } from './VoiceNotePlayer';

/**
 * One recording at a time.
 *
 * Two of these are routinely on screen together — every row on the Notes tab
 * has one — and they know nothing about each other, so playing a second while
 * the first runs is the *default* behaviour rather than an edge case. The
 * registry in `services/audioFocus` is what makes the second one interrupt the
 * first, and this is the assertion that the player is wired into it.
 *
 * The players themselves come from the mock, which hands out a fresh object per
 * call — so each one is fished out of `useAudioPlayer.mock.results` rather than
 * assumed.
 */

jest.mock('@/services/noteAudio', () => ({
  noteAudioUri: jest.fn((fileName: string) => `file:///mock/documents/note-audio/${fileName}`),
}));

const asMock = useAudioPlayer as jest.MockedFunction<typeof useAudioPlayer>;

function voice(fileName: string): NoteVoice {
  return { fileName, durationMs: 4_000, byteLength: 2048, at: null };
}

/**
 * Every player handed out so far, oldest first.
 *
 * The mock returns a fresh object per call, so which player belongs to which
 * component is a matter of call order rather than something to look up — and
 * `play`/`pause` on them are the jest mocks the assertions are about.
 */
function players(): { play: jest.Mock; pause: jest.Mock }[] {
  return asMock.mock.results.map((result) => result.value as unknown as { play: jest.Mock; pause: jest.Mock });
}

beforeEach(() => {
  asMock.mockClear();
  // The focus is module state and outlives a test, so each one starts silent.
  silenceAudio();
});

it('stops the recording that was already playing when another starts', async () => {
  await render(
    <>
      <VoiceNotePlayer voice={voice('first.m4a')} />
      <VoiceNotePlayer voice={voice('second.m4a')} />
    </>,
  );

  const [first, second] = screen.getAllByLabelText('Play the recording');
  const [firstPlayer, secondPlayer] = players();

  await fireEvent.press(first!);
  expect(firstPlayer!.play).toHaveBeenCalled();

  await fireEvent.press(second!);
  expect(secondPlayer!.play).toHaveBeenCalled();
  // The point of the whole exercise: the first one was told to stop, and it was
  // told by the second one starting rather than by anybody pressing it.
  expect(firstPlayer!.pause).toHaveBeenCalledTimes(1);
});

it('does not stop anything when nothing else is playing', async () => {
  await render(<VoiceNotePlayer voice={voice('alone.m4a')} />);

  await fireEvent.press(screen.getByLabelText('Play the recording'));

  const [player] = players();
  expect(player!.play).toHaveBeenCalled();
  expect(player!.pause).not.toHaveBeenCalled();
});
