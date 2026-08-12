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

/**
 * Transcription: a button, never automatic, and it appends rather than replaces.
 * The recording is the only thing that leaves the phone in this whole app, so
 * what is asserted here is mostly about when it does *not* happen.
 */
describe('transcribing the recording', () => {
  const spoken = { kind: 'edit' as const, note: note({ text: 'typed already', voice: voice() }) };

  it('offers no button when there is no key, because then there is no feature', async () => {
    await render(sheet({ target: spoken }));

    expect(screen.queryByLabelText('Transcribe the recording')).toBeNull();
  });

  it('offers no button on a note that has no recording', async () => {
    await render(sheet({ onTranscribe: jest.fn() }));

    expect(screen.queryByLabelText('Transcribe the recording')).toBeNull();
  });

  /**
   * The press is the consent. Opening a note with a recording must not send
   * anything anywhere.
   */
  it('sends nothing until the button is pressed', async () => {
    const onTranscribe = jest.fn(async () => ({ ok: true as const, text: 'x', languageCode: 'fa' }));

    await render(sheet({ target: spoken, onTranscribe }));

    expect(onTranscribe).not.toHaveBeenCalled();
  });

  it('appends the transcript under what was already typed', async () => {
    const onTranscribe = jest.fn(async () => ({ ok: true as const, text: 'what I said', languageCode: 'fa' }));
    const onSave = jest.fn();
    await render(sheet({ target: spoken, onTranscribe, onSave }));

    await fireEvent.press(screen.getByLabelText('Transcribe the recording'));
    await act(async () => undefined);
    await fireEvent.press(screen.getByLabelText('Save this note'));

    const savedText = onSave.mock.calls[0]?.[2] as string;
    expect(savedText.startsWith('typed already')).toBe(true);
    expect(savedText).toContain('what I said');
  });

  /**
   * It lands in the draft rather than the store, so it is read — and can be
   * edited or abandoned — before Save. Save is the approval.
   */
  it('does not save on its own; the transcript waits in the field', async () => {
    const onTranscribe = jest.fn(async () => ({ ok: true as const, text: 'what I said', languageCode: 'fa' }));
    const onSave = jest.fn();
    await render(sheet({ target: spoken, onTranscribe, onSave }));

    await fireEvent.press(screen.getByLabelText('Transcribe the recording'));
    await act(async () => undefined);

    expect(onSave).not.toHaveBeenCalled();
    expect(screen.getByDisplayValue(/what I said/)).toBeTruthy();
  });

  it('offers another attempt once one has been made', async () => {
    const onTranscribe = jest.fn(async () => ({ ok: true as const, text: 'first go', languageCode: 'fa' }));
    await render(sheet({ target: spoken, onTranscribe }));

    await fireEvent.press(screen.getByLabelText('Transcribe the recording'));
    await act(async () => undefined);

    expect(screen.getByLabelText('Transcribe the recording again')).toBeTruthy();
  });

  /**
   * A transcription takes seconds and typing during it is the obvious thing to
   * do. Appending to the text as it was when the button was pressed would
   * silently throw that typing away — the stale-closure bug this codebase has
   * already been bitten by twice, in the one place where the cost is somebody's
   * own sentence.
   */
  it('keeps words typed while the request was in flight', async () => {
    let answer: (result: { ok: true; text: string; languageCode: string }) => void = () => undefined;
    const onTranscribe = jest.fn(
      () => new Promise<{ ok: true; text: string; languageCode: string }>((resolve) => (answer = resolve)),
    );
    const onSave = jest.fn();
    await render(sheet({ target: spoken, onTranscribe, onSave }));

    await fireEvent.press(screen.getByLabelText('Transcribe the recording'));
    // Typed while waiting, which the closure that started the request cannot see.
    await fireEvent.changeText(screen.getByLabelText('Note'), 'typed already and then some more');
    await act(async () => {
      answer({ ok: true, text: 'what I said', languageCode: 'fa' });
    });

    await fireEvent.press(screen.getByLabelText('Save this note'));

    const savedText = onSave.mock.calls[0]?.[2] as string;
    expect(savedText).toContain('and then some more');
    expect(savedText).toContain('what I said');
  });

  /**
   * A request outlives the sheet that asked. Applying its answer to whatever is
   * open next would put a transcript on a note nobody spoke it about.
   */
  it('abandons a transcript that arrives after the sheet closed', async () => {
    let answer: (result: { ok: true; text: string; languageCode: string }) => void = () => undefined;
    const onTranscribe = jest.fn(
      () => new Promise<{ ok: true; text: string; languageCode: string }>((resolve) => (answer = resolve)),
    );
    const onSave = jest.fn();
    const { rerender } = await render(sheet({ target: spoken, onTranscribe, onSave }));

    await fireEvent.press(screen.getByLabelText('Transcribe the recording'));
    await fireEvent.press(screen.getByLabelText('Close'));
    await act(async () => {
      answer({ ok: true, text: 'went to the wrong note', languageCode: 'fa' });
    });

    // Reopened on a different note: the late answer must not be in it.
    await rerender(
      sheet({
        target: { kind: 'edit', note: note({ text: 'a different note', voice: voice() }) },
        onTranscribe,
        onSave,
      }),
    );
    await fireEvent.press(screen.getByLabelText('Save this note'));

    expect(onSave.mock.calls[0]?.[2]).toBe('a different note');
  });

  it('says what went wrong rather than failing silently', async () => {
    const onTranscribe = jest.fn(async () => ({ ok: false as const, reason: 'unauthorized' as const }));
    await render(sheet({ target: spoken, onTranscribe }));

    await fireEvent.press(screen.getByLabelText('Transcribe the recording'));
    await act(async () => undefined);

    expect(screen.getByText('The key was refused. Check it in Settings.')).toBeTruthy();
  });

  /** A failed attempt must not quietly eat the words that were already there. */
  it('leaves the writing untouched when it fails', async () => {
    const onTranscribe = jest.fn(async () => ({ ok: false as const, reason: 'offline' as const }));
    const onSave = jest.fn();
    await render(sheet({ target: spoken, onTranscribe, onSave }));

    await fireEvent.press(screen.getByLabelText('Transcribe the recording'));
    await act(async () => undefined);
    await fireEvent.press(screen.getByLabelText('Save this note'));

    expect(onSave).toHaveBeenCalledWith(T0, '', 'typed already', expect.anything());
  });
});
