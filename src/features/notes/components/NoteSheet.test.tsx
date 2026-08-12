import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { dayNoteId, type DayNote, type NoteVoice } from '@/core/day';

import { HOLD_MS } from '../hold';

import { NoteSheet } from './NoteSheet';

/**
 * Recording and typing are the same act, which is what this sheet has to make
 * true: one entry, one instant, one Save, and the microphone under the fields
 * rather than on the screen behind them.
 */

jest.mock('@/services/noteAudio', () => ({
  keepNoteAudio: jest.fn(() => ({ fileName: 'voice-1.m4a', byteLength: 2048 })),
  noteAudioUri: jest.fn(() => 'file:///mock/documents/note-audio/voice-1.m4a'),
}));

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

function voice(): NoteVoice {
  return { fileName: 'voice-1.m4a', durationMs: 30_000, byteLength: 2048, at: null };
}

function note(overrides: Partial<DayNote> = {}): DayNote {
  return { id: dayNoteId(T0), at: T0, title: '', text: 'typed', voice: null, ...overrides };
}

function sheet(props: Partial<React.ComponentProps<typeof NoteSheet>> = {}) {
  return <NoteSheet target={{ kind: 'new' }} defaultAt={T0} onSave={jest.fn()} onClose={jest.fn()} {...props} />;
}

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

it('offers the recorder beside the writing, not on the screen behind it', async () => {
  await render(sheet());

  expect(screen.getByLabelText('Hold to record a voice note')).toBeTruthy();
  expect(screen.getByLabelText('Note')).toBeTruthy();
});

/**
 * The point of the whole change: what is recorded is attached to the note being
 * written, and saved with it in one press.
 */
it('saves a recording made here as part of the note', async () => {
  const onSave = jest.fn();
  await render(sheet({ onSave }));

  await fireEvent(screen.getByLabelText('Hold to record a voice note'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(HOLD_MS);
  });
  await act(async () => undefined);
  await fireEvent.press(screen.getByLabelText('Stop recording'));
  await act(async () => undefined);

  await fireEvent.press(screen.getByLabelText('Save this note'));

  expect(onSave).toHaveBeenCalledWith(
    T0,
    '',
    '',
    expect.objectContaining({ fileName: 'voice-1.m4a', byteLength: 2048 }),
  );
});

/**
 * A recording is an entry on its own — it is how you write something down while
 * walking — so Save must not be waiting for words that are never coming.
 */
it('lets a recording alone be saved, with nothing typed', async () => {
  await render(sheet({ target: { kind: 'edit', note: note({ text: '', voice: voice() }) } }));

  expect(screen.getByLabelText('Save this note')).not.toBeDisabled();
});

it('refuses to save a note that is neither written nor spoken', async () => {
  await render(sheet());

  expect(screen.getByLabelText('Save this note')).toBeDisabled();
});

it('plays back a recording already on the note', async () => {
  await render(sheet({ target: { kind: 'edit', note: note({ voice: voice() }) } }));

  expect(screen.getByLabelText('Play the recording')).toBeTruthy();
});

/**
 * Deleting the recording leaves the words, because they are two ways of writing
 * the same entry rather than two states of one.
 */
it('drops the recording without touching what was typed', async () => {
  const onSave = jest.fn();
  await render(sheet({ target: { kind: 'edit', note: note({ text: 'typed', voice: voice() }) }, onSave }));

  await fireEvent.press(screen.getByLabelText('Delete the recording'));
  await fireEvent.press(screen.getByLabelText('Save this note'));

  expect(onSave).toHaveBeenCalledWith(T0, '', 'typed', null);
});
