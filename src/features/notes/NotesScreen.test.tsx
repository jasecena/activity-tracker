import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { Alert } from 'react-native';

import { dayNoteId, type DayNote } from '@/core/day';

import { NotesScreen } from './NotesScreen';

/**
 * The diary as its own tab: everything written, newest first, grouped by the
 * day it is about.
 *
 * The swipe itself is not asserted here. `react-native-gesture-handler`'s
 * recognisers are native, and driving them through synthetic events proves
 * nothing about whether the gesture works on a phone — the same reason
 * `SwipeBackPage` tests its two decisions directly rather than through the
 * renderer. What is asserted is everything either side of the gesture: the
 * action it reveals exists, pressing it asks, and nothing goes until answered.
 */

jest.mock('@/services/noteAudio', () => ({
  noteAudioUri: jest.fn(() => 'file:///mock/documents/note-audio/voice-1.m4a'),
  keepNoteAudio: jest.fn(() => ({ fileName: 'voice-1.m4a', byteLength: 2048 })),
}));

const UTC = 0;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const NOW = T0 + 12 * HOUR; // late on the 5th, so the fixtures above are behind it

function note(at: number, title: string): DayNote {
  return { id: dayNoteId(at), at, title, text: '', voice: null, mediaId: null };
}

function confirmTheAlert(): void {
  const buttons = (Alert.alert as jest.Mock).mock.calls.at(-1)?.[2] as
    { text: string; style?: string; onPress?: () => void }[] | undefined;
  buttons?.find((button) => button.style === 'destructive')?.onPress?.();
}

function notesScreen(props: Partial<React.ComponentProps<typeof NotesScreen>> = {}) {
  return (
    <NotesScreen
      notes={[]}
      tzOffsetMinutes={UTC}
      now={NOW}
      onWrite={jest.fn()}
      onSpeak={jest.fn()}
      onOpen={jest.fn()}
      onForget={jest.fn()}
      {...props}
    />
  );
}

beforeEach(() => {
  jest.spyOn(Alert, 'alert').mockImplementation(() => undefined);
  (Alert.alert as jest.Mock).mockClear();
});

it('says what to do when nothing has been written', async () => {
  await render(notesScreen());

  expect(screen.getByText(/Nothing written yet/)).toBeTruthy();
});

it('groups by day and puts the newest day first', async () => {
  const notes = [note(T0 - 24 * HOUR, 'yesterday'), note(T0, 'earlier today'), note(T0 + 3 * HOUR, 'later today')];

  await render(notesScreen({ notes }));

  // Headings are days; both are present and the entries live under them.
  expect(screen.getByText('Monday 5 Jan')).toBeTruthy();
  expect(screen.getByText('Sunday 4 Jan')).toBeTruthy();
  expect(screen.getByText('later today')).toBeTruthy();
  expect(screen.getByText('yesterday')).toBeTruthy();
});

it('opens a note for editing when its words are pressed', async () => {
  const onOpen = jest.fn();
  await render(notesScreen({ notes: [note(T0, 'Market day')], onOpen }));

  await fireEvent.press(screen.getByLabelText(/^Note at/));

  expect(onOpen).toHaveBeenCalled();
});

it('writes a new one from the header', async () => {
  const onWrite = jest.fn();
  await render(notesScreen({ onWrite }));

  await fireEvent.press(screen.getByLabelText('Write a note'));

  expect(onWrite).toHaveBeenCalled();
});

describe('deleting', () => {
  /**
   * Revealing Delete is not deleting. The swipe uncovers a button, pressing it
   * asks, and only then does the note go — two deliberate acts and a
   * confirmation for something nothing can reconstruct.
   */
  it('asks first, and nothing goes until it is answered', async () => {
    const onForget = jest.fn();
    await render(notesScreen({ notes: [note(T0, 'Market day')], onForget }));

    await fireEvent.press(screen.getByLabelText(/^Delete the note at/));
    expect(onForget).not.toHaveBeenCalled();
    expect(Alert.alert).toHaveBeenCalledWith('Delete this note?', expect.any(String), expect.anything());

    await act(async () => confirmTheAlert());
    expect(onForget).toHaveBeenCalledWith(dayNoteId(T0));
  });

  it('forgets the note that was swiped, not another one', async () => {
    const onForget = jest.fn();
    const notes = [note(T0, 'first'), note(T0 + HOUR, 'second')];
    await render(notesScreen({ notes, onForget }));

    // Newest first, so the second note's action is the first in the tree.
    const [newest] = screen.getAllByLabelText(/^Delete the note at/);
    await fireEvent.press(newest!);
    await act(async () => confirmTheAlert());

    expect(onForget).toHaveBeenCalledWith(dayNoteId(T0 + HOUR));
  });
});

/**
 * A note can be dated ahead of now — writing towards a meeting over the days
 * before it is the whole reason for allowing it — and one that has not happened
 * yet is a different kind of thing from a record of one that has.
 */
describe('what has not happened yet', () => {
  const NEXT_WEEK = NOW + 7 * 24 * HOUR;

  it('puts a future note in its own box, above the diary', async () => {
    await render(notesScreen({ notes: [note(T0, 'market day'), note(NEXT_WEEK, 'the meeting')] }));

    expect(screen.getByText('COMING UP')).toBeTruthy();

    // Ahead of the diary, not merely present somewhere on the page: the point
    // of the box is that the next thing coming is the first thing you see.
    const page = screen.toJSON();
    const printed = JSON.stringify(page);
    expect(printed.indexOf('the meeting')).toBeLessThan(printed.indexOf('market day'));
  });

  it('says nothing about the future when nothing is dated ahead', async () => {
    await render(notesScreen({ notes: [note(T0, 'market day')] }));

    expect(screen.queryByText('COMING UP')).toBeNull();
  });

  /**
   * Soonest first, which is the opposite of the diary underneath it. What has
   * happened reads backwards from now; what has not reads forwards to the next
   * thing. Both put the entry nearest to now at the top.
   */
  it('reads forwards, nearest first', async () => {
    const notes = [note(NEXT_WEEK, 'far'), note(NOW + HOUR, 'soon')];
    await render(notesScreen({ notes }));

    const printed = JSON.stringify(screen.toJSON());
    expect(printed.indexOf('soon')).toBeLessThan(printed.indexOf('far'));
  });

  it('still says what to do when the only notes are ahead', async () => {
    await render(notesScreen({ notes: [note(NEXT_WEEK, 'the meeting')] }));

    expect(screen.queryByText(/Nothing written yet/)).toBeNull();
    expect(screen.getByText('the meeting')).toBeTruthy();
  });
});

/**
 * **The quick microphone writes the note itself.**
 *
 * Press it, talk, press it again, and the entry exists — no sheet, no fields
 * and no Save. That is not a shortcut around the sheet so much as the sheet's
 * own rule taken at its word: any one of a title, a paragraph and a recording
 * is a note, so a recording on its own needs nothing else collected before it
 * can be filed.
 *
 * The pen stays where it was. The two are not a choice between features — they
 * are the two ways of putting words in the same diary, and this one is the one
 * reached for with something to say and no time to sit down.
 */
describe('the microphone on the tab', () => {
  it('files a recording as a note without opening the sheet', async () => {
    const onSpeak = jest.fn();
    const onWrite = jest.fn();
    await render(notesScreen({ onSpeak, onWrite }));

    await act(async () => fireEvent.press(screen.getByLabelText('Record a voice note')));
    // The glyph is what says it is recording — a square, not a microphone in
    // another colour — so this is also the assertion that the state is legible.
    expect(screen.getByLabelText('Stop recording')).toBeTruthy();

    await act(async () => fireEvent.press(screen.getByLabelText('Stop recording')));
    await act(async () => Promise.resolve());

    expect(onSpeak).toHaveBeenCalledWith(
      expect.objectContaining({ fileName: 'voice-1.m4a', durationMs: expect.any(Number) }),
      expect.any(Number),
    );
    // Nothing was opened on the way. The sheet is the pen's route, not this one.
    expect(onWrite).not.toHaveBeenCalled();
  });

  /**
   * Dated to when the talking began rather than to when the file landed. Those
   * differ by however long the recording ran, and "when I said this" is the
   * honest answer for an entry in a diary.
   */
  it('dates the note to the start of the recording', async () => {
    jest.useFakeTimers();
    jest.setSystemTime(NOW);
    const onSpeak = jest.fn();
    await render(notesScreen({ onSpeak }));

    await act(async () => fireEvent.press(screen.getByLabelText('Record a voice note')));
    await act(async () => {
      jest.setSystemTime(NOW + 90_000);
      jest.advanceTimersByTime(250);
    });
    await act(async () => fireEvent.press(screen.getByLabelText('Stop recording')));
    await act(async () => Promise.resolve());

    expect(onSpeak.mock.calls[0]?.[1]).toBe(NOW);
    jest.useRealTimers();
  });
});
