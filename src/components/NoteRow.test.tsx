import { fireEvent, render, screen } from '@testing-library/react-native';

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
