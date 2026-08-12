import { fireEvent, render, screen } from '@testing-library/react-native';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';

import { dayNoteId, type DayNote } from '@/core/day';

import { NoteRow } from './NoteRow';

/**
 * A row in the day's Notes section — its own section, above the timeline,
 * because a timeline is a record of where the phone was and a sentence dropped
 * into it arrives as another reading the app took.
 *
 * What is asserted here is the part a recording added: it plays from the row,
 * and playing it is not the same press as opening it.
 */

jest.mock('@/services/noteAudio', () => ({
  noteAudioUri: jest.fn(() => 'file:///mock/documents/note-audio/voice-1.m4a'),
}));

const T0 = Date.UTC(2026, 0, 5, 8, 30, 0);
const UTC = 0;

function note(overrides: Partial<DayNote> = {}): DayNote {
  return { id: dayNoteId(T0), at: T0, title: '', text: 'Walked to the market', voice: null, ...overrides };
}

const VOICE = { fileName: 'voice-1.m4a', durationMs: 90_000, byteLength: 2048, at: null };

it('prints the whole entry rather than a preview of it', async () => {
  await render(<NoteRow note={note()} tzOffsetMinutes={UTC} />);

  expect(screen.getByText('Walked to the market')).toBeTruthy();
});

it('plays a recording from the row it belongs to', async () => {
  await render(<NoteRow note={note({ voice: VOICE })} tzOffsetMinutes={UTC} />);

  expect(screen.getByLabelText('Play the recording')).toBeTruthy();
  // The same `formatDuration` the video transport prints, so a length reads
  // the same wherever the app shows one.
  expect(screen.getByText('1m')).toBeTruthy();
});

/**
 * A play button inside a button would be one tap doing two things, and which
 * one it did would be the platform's decision rather than the app's.
 */
it('does not open the note when the recording is played', async () => {
  const onOpen = jest.fn();
  await render(<NoteRow note={note({ voice: VOICE })} tzOffsetMinutes={UTC} onOpen={onOpen} />);

  await fireEvent.press(screen.getByLabelText('Play the recording'));

  expect(onOpen).not.toHaveBeenCalled();
});

it('opens the note when the words are pressed', async () => {
  const onOpen = jest.fn();
  await render(<NoteRow note={note({ voice: VOICE })} tzOffsetMinutes={UTC} onOpen={onOpen} />);

  await fireEvent.press(screen.getByLabelText(/^Note at/));

  expect(onOpen).toHaveBeenCalled();
});

/**
 * An entry that was spoken and never typed still has to be openable, and a
 * screen reader has to be told it is there.
 */
it('names a note that is only a recording', async () => {
  await render(<NoteRow note={note({ text: '', voice: VOICE })} tzOffsetMinutes={UTC} onOpen={jest.fn()} />);

  expect(screen.getByLabelText('Note at 08:30: a recording')).toBeTruthy();
});

/**
 * A clip that has played out rewinds and offers to play again. Without it the
 * button sits on "pause" over silence, and getting back to the start costs two
 * presses that each do something other than what they say.
 */
describe('a recording that has played to the end', () => {
  const atEnd = { playing: false, didJustFinish: true, currentTime: 90, duration: 90, isLoaded: true };

  function playerWith(overrides: Partial<Record<string, unknown>> = {}) {
    const player = { play: jest.fn(), pause: jest.fn(), seekTo: jest.fn(), remove: jest.fn(), ...overrides };
    (useAudioPlayer as jest.Mock).mockReturnValue(player);
    return player;
  }

  /**
   * The button has to say Play again once the audio has stopped on its own.
   * Mirroring a boolean instead of reading the player is what leaves it stuck
   * on Pause over silence.
   */
  it('offers play again rather than pause over silence', async () => {
    playerWith();
    (useAudioPlayerStatus as jest.Mock).mockReturnValue(atEnd);

    await render(<NoteRow note={note({ voice: VOICE })} tzOffsetMinutes={UTC} />);

    expect(screen.getByLabelText('Play the recording')).toBeTruthy();
  });

  it('rewinds to the start when pressed, instead of resuming into silence', async () => {
    const player = playerWith();
    (useAudioPlayerStatus as jest.Mock).mockReturnValue(atEnd);

    await render(<NoteRow note={note({ voice: VOICE })} tzOffsetMinutes={UTC} />);
    await fireEvent.press(screen.getByLabelText('Play the recording'));

    expect(player.seekTo).toHaveBeenCalledWith(0);
    expect(player.play).toHaveBeenCalled();
  });

  it('does not rewind a clip that has not finished', async () => {
    const player = playerWith();
    (useAudioPlayerStatus as jest.Mock).mockReturnValue({ ...atEnd, currentTime: 10, didJustFinish: false });

    await render(<NoteRow note={note({ voice: VOICE })} tzOffsetMinutes={UTC} />);
    await fireEvent.press(screen.getByLabelText('Play the recording'));

    expect(player.seekTo).not.toHaveBeenCalled();
    expect(player.play).toHaveBeenCalled();
  });

  it('pauses rather than restarting while it is playing', async () => {
    const player = playerWith();
    (useAudioPlayerStatus as jest.Mock).mockReturnValue({ ...atEnd, playing: true, currentTime: 10 });

    await render(<NoteRow note={note({ voice: VOICE })} tzOffsetMinutes={UTC} />);
    await fireEvent.press(screen.getByLabelText('Pause the recording'));

    expect(player.pause).toHaveBeenCalled();
    expect(player.play).not.toHaveBeenCalled();
  });
});
