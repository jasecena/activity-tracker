import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { copyText } from '@/services/clipboard';

import { dayNoteId, type DayNote, type NoteVoice } from '@/core/day';
import type { MediaItem } from '@/core/media';

import { expectSheetIsBoundedAndScrolls } from '@/__tests__/sheetLayout';

import { NoteSheet } from './NoteSheet';

/**
 * Recording and typing are the same act, which is what this sheet has to make
 * true: one entry, one instant, one Save, and the microphone under the fields
 * rather than on the screen behind them.
 */

jest.mock('@/services/clipboard', () => ({ copyText: jest.fn(async () => true) }));

jest.mock('@/services/noteAudio', () => ({
  keepNoteAudio: jest.fn(() => ({ fileName: 'voice-1.m4a', byteLength: 2048 })),
  noteAudioUri: jest.fn(() => 'file:///mock/documents/note-audio/voice-1.m4a'),
}));

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

function voice(): NoteVoice {
  return { fileName: 'voice-1.m4a', durationMs: 30_000, byteLength: 2048, at: null, locked: false };
}

function note(overrides: Partial<DayNote> = {}): DayNote {
  return { id: dayNoteId(T0), at: T0, title: '', text: 'typed', voice: null, mediaId: null, ...overrides };
}

function sheet(props: Partial<React.ComponentProps<typeof NoteSheet>> = {}) {
  return <NoteSheet target={{ kind: 'new' }} defaultAt={T0} onSave={jest.fn()} onClose={jest.fn()} {...props} />;
}

/**
 * Answer the destructive confirmation the way a person would.
 *
 * `Alert.alert` shows a native dialog there is nothing to press in a test, so
 * the buttons are read off the call and the one that is not Cancel is invoked.
 */
function confirmTheAlert(): void {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as
    { text: string; style?: string; onPress?: () => void }[] | undefined;
  buttons?.find((button) => button.style === 'destructive')?.onPress?.();
}

beforeEach(() => {
  jest.useFakeTimers();
  // Re-spying does not reset the existing spy's call log, and a test asserting
  // that nothing was asked would otherwise see the previous test's dialogs.
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (Alert.alert as jest.Mock).mockClear();
});

afterEach(() => {
  jest.useRealTimers();
});

it('offers the recorder beside the writing, not on the screen behind it', async () => {
  await render(sheet());

  expect(screen.getByLabelText('Record a voice note')).toBeTruthy();
  expect(screen.getByLabelText('Note')).toBeTruthy();
});

/**
 * The point of the whole change: what is recorded is attached to the note being
 * written, and saved with it in one press.
 */
it('saves a recording made here as part of the note', async () => {
  const onSave = jest.fn();
  await render(sheet({ onSave }));

  await fireEvent.press(screen.getByLabelText('Record a voice note'));
  await act(async () => undefined);
  await fireEvent.press(screen.getByLabelText('Stop recording'));
  await act(async () => undefined);

  await fireEvent.press(screen.getByLabelText('Save this note'));

  expect(onSave).toHaveBeenCalledWith(
    T0,
    '',
    '',
    expect.objectContaining({ fileName: 'voice-1.m4a', byteLength: 2048 }),
    null,
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
it('drops the recording without touching what was typed, once confirmed', async () => {
  const onSave = jest.fn();
  await render(sheet({ target: { kind: 'edit', note: note({ text: 'typed', voice: voice() }) }, onSave }));

  await fireEvent.press(screen.getByLabelText('Delete the recording'));
  await act(async () => confirmTheAlert());
  await fireEvent.press(screen.getByLabelText('Save this note'));

  expect(onSave).toHaveBeenCalledWith(T0, '', 'typed', null, null);
});

/**
 * The point of the confirmation: a press on its own destroys nothing. Thirty
 * seconds of talking cannot be recovered from anything, so the press has to be
 * answered before it counts.
 */
it('keeps the recording when the confirmation is dismissed', async () => {
  const onSave = jest.fn();
  await render(sheet({ target: { kind: 'edit', note: note({ text: 'typed', voice: voice() }) }, onSave }));

  await fireEvent.press(screen.getByLabelText('Delete the recording'));
  // Dialog raised, nothing answered.
  await fireEvent.press(screen.getByLabelText('Save this note'));

  expect(Alert.alert).toHaveBeenCalled();
  expect(onSave).toHaveBeenCalledWith(T0, '', 'typed', expect.objectContaining({ fileName: 'voice-1.m4a' }), null);
});

/**
 * Recording over an existing recording destroys it, so it is a delete and asks
 * like one. Recording onto an empty note asks nothing — there is nothing to
 * lose, and a confirmation for that would be a dialog in the way of the thing
 * the button is for.
 */
it('asks before recording over a recording that already exists', async () => {
  await render(sheet({ target: { kind: 'edit', note: note({ voice: voice() }) } }));

  await fireEvent.press(screen.getByLabelText('Record a voice note'));

  expect(Alert.alert).toHaveBeenCalledWith('Record over this one?', expect.any(String), expect.anything());
});

it('asks nothing before the first recording on a note', async () => {
  await render(sheet());

  await fireEvent.press(screen.getByLabelText('Record a voice note'));

  expect(Alert.alert).not.toHaveBeenCalled();
});

/**
 * The keyboard is a separate window and does not go with the sheet on its own.
 * Backgrounding the app left it up over a sheet that could not be reached, with
 * no way out but force-quitting.
 */
it('offers a close button that puts the keyboard away', async () => {
  const onClose = jest.fn();
  await render(sheet({ onClose }));

  await fireEvent.press(screen.getByLabelText('Close without saving'));

  expect(onClose).toHaveBeenCalled();
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
    const onTranscribe = jest.fn(async () => ({ ok: false as const, reason: 'unreachable' as const }));
    const onSave = jest.fn();
    await render(sheet({ target: spoken, onTranscribe, onSave }));

    await fireEvent.press(screen.getByLabelText('Transcribe the recording'));
    await act(async () => undefined);
    await fireEvent.press(screen.getByLabelText('Save this note'));

    expect(onSave).toHaveBeenCalledWith(T0, '', 'typed already', expect.anything(), null);
  });
});

/**
 * Copying the note out. There is no LLM pass yet — item 17 — so this is how a
 * transcript reaches anything else, and a pasteboard write is completely
 * invisible without an acknowledgement.
 */
describe('copying a note', () => {
  it('offers nothing to copy while the field is empty', async () => {
    await render(sheet());

    expect(screen.queryByLabelText('Copy this note')).toBeNull();
  });

  it('copies exactly what is in the field', async () => {
    await render(sheet({ target: { kind: 'edit', note: note({ text: 'what I said about today' }) } }));

    await fireEvent.press(screen.getByLabelText('Copy this note'));

    expect(copyText).toHaveBeenCalledWith('what I said about today');
  });

  it('says it copied, since nothing else on screen changes', async () => {
    await render(sheet({ target: { kind: 'edit', note: note({ text: 'typed' }) } }));

    await fireEvent.press(screen.getByLabelText('Copy this note'));
    await act(async () => undefined);

    expect(screen.getByLabelText('Copied')).toBeTruthy();
  });

  /**
   * The tick means "this text is on the pasteboard", so editing makes it false
   * — which is also why it needs no timer to undo it.
   */
  it('stops saying so once the text has changed', async () => {
    await render(sheet({ target: { kind: 'edit', note: note({ text: 'typed' }) } }));

    await fireEvent.press(screen.getByLabelText('Copy this note'));
    await act(async () => undefined);
    await fireEvent.changeText(screen.getByLabelText('Note'), 'typed some more');

    expect(screen.queryByLabelText('Copied')).toBeNull();
    expect(screen.getByLabelText('Copy this note')).toBeTruthy();
  });
});

/**
 * **The sheet cannot run off the top of the screen, whatever the keyboard does.**
 *
 * It used to be able to. The backdrop and the `KeyboardAvoidingView` were
 * siblings, and nothing capped their sum: with the fields, the recorder and the
 * Transcribe row all showing, content plus a keyboard came to more than the
 * screen, the backdrop was squeezed to nothing, and the sheet was laid out from
 * y = 0 — its title over the status bar and its lower half spilling past a
 * background that had stopped at the wrong height. It was reported as a glitch
 * on returning from the lock screen, which is only where the arithmetic is
 * briefly at its worst.
 *
 * `expectSheetIsBoundedAndScrolls` carries the reasoning and the walk; all three
 * sheets in the app assert the same thing through it.
 */
describe('the sheet', () => {
  it('scrolls inside a bounded container rather than growing past the screen', async () => {
    // The tallest it ever gets: a recording to play, and a key, so the
    // Transcribe button and its sentence are both showing.
    await render(sheet({ target: { kind: 'edit', note: note({ voice: voice() }) }, onTranscribe: jest.fn() }));

    expectSheetIsBoundedAndScrolls(screen.toJSON(), ['Close without saving', 'Save this note']);
  });
});

describe('a note about a capture', () => {
  const CAPTURE: MediaItem = {
    id: 'media-7',
    kind: 'photo',
    capturedAt: T0,
    fileName: 'capture-7.jpg',
    thumbFileName: 'capture-7-thumb.jpg',
    byteLength: 4096,
    durationMs: null,
    at: null,
    orientation: null,
    note: '',
  };

  it('saves the picture it was started from', async () => {
    const onSave = jest.fn();
    await render(sheet({ target: { kind: 'new', mediaId: 'media-7' }, onSave }));

    await fireEvent.changeText(screen.getByLabelText('Note'), 'The light on the water');
    await fireEvent.press(screen.getByLabelText('Save this note'));

    expect(onSave).toHaveBeenCalledWith(T0, '', 'The light on the water', null, 'media-7');
  });

  it('offers a way to the picture, and says which note it belongs to', async () => {
    const onOpenMedia = jest.fn();
    await render(
      sheet({
        target: { kind: 'edit', note: note({ mediaId: 'media-7' }) },
        attached: CAPTURE,
        attachedThumbUri: 'file:///mock/thumb.jpg',
        onOpenMedia,
      }),
    );

    await fireEvent.press(screen.getByLabelText('Open the photo this note is about'));

    expect(onOpenMedia).toHaveBeenCalledWith('media-7');
  });

  /**
   * The two have separate lives: forgetting the photograph leaves the note. So
   * a note whose picture has gone is a normal state, and drawing an empty
   * square would read as the app having mislaid something.
   */
  it('says the picture has been deleted rather than drawing nothing', async () => {
    await render(sheet({ target: { kind: 'edit', note: note({ mediaId: 'media-gone' }) }, attached: null }));

    expect(screen.getByText(/has been deleted/)).toBeTruthy();
    expect(screen.queryByLabelText('Open the photo this note is about')).toBeNull();
  });

  it('shows nothing at all for a note with no picture', async () => {
    await render(sheet({ target: { kind: 'edit', note: note() } }));

    expect(screen.queryByText(/has been deleted/)).toBeNull();
    expect(screen.queryByLabelText('Open the photo this note is about')).toBeNull();
  });
});

/**
 * **Locking a recording, for the one somebody is not willing to lose.**
 *
 * Recording over one already on a note has asked first since the feature
 * shipped, and that prompt is asserted above. This is the stronger answer,
 * because a dialog is only ever as good as the attention paid to it and the
 * audio is the one thing on a note that nothing can reconstruct — the words
 * survive a bad transcription, a voice survives nothing.
 *
 * It closes both doors at once. A lock that left a one-tap delete behind it
 * would be decorative.
 */
describe('keeping a recording', () => {
  const locked = () => note({ voice: { ...voice(), locked: true } });

  it('will not start the microphone while it is locked', async () => {
    await render(sheet({ target: { kind: 'edit', note: locked() } }));

    // The reason is the label, so it reaches a screen reader and anybody
    // pressing the button and waiting for something to happen.
    const mic = screen.getByLabelText('This recording is locked. Unlock it to record over it.');
    await fireEvent.press(mic);

    // Not even the dialog: there is nothing to confirm, because nothing may
    // happen.
    expect(Alert.alert).not.toHaveBeenCalled();
    expect(screen.queryByLabelText('Stop recording')).toBeNull();
  });

  it('offers no way to delete it while it is locked', async () => {
    await render(sheet({ target: { kind: 'edit', note: locked() } }));

    expect(screen.queryByLabelText('Delete the recording')).toBeNull();
  });

  /**
   * One tap, nothing asked. The lock is what makes the destruction deliberate,
   * and a confirmation on *undoing* a guard is a dialog in front of the thing
   * the control is for.
   */
  it('gives both back the moment it is unlocked', async () => {
    await render(sheet({ target: { kind: 'edit', note: locked() } }));

    await fireEvent.press(screen.getByLabelText('Unlock this recording so it can be replaced'));

    expect(Alert.alert).not.toHaveBeenCalled();
    expect(screen.getByLabelText('Record a voice note')).toBeTruthy();
    expect(screen.getByLabelText('Delete the recording')).toBeTruthy();
  });

  it('saves the lock with the note', async () => {
    const onSave = jest.fn();
    await render(sheet({ target: { kind: 'edit', note: note({ voice: voice() }) }, onSave }));

    await fireEvent.press(screen.getByLabelText('Keep this recording'));
    await fireEvent.press(screen.getByLabelText('Save this note'));

    expect(onSave).toHaveBeenCalledWith(T0, '', 'typed', expect.objectContaining({ locked: true }), null);
  });

  it('has nothing to lock on a note with no recording', async () => {
    await render(sheet({ target: { kind: 'edit', note: note() } }));

    expect(screen.queryByLabelText('Keep this recording')).toBeNull();
    expect(screen.getByLabelText('Record a voice note')).toBeTruthy();
  });
});
