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
}));

const UTC = 0;
const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);

function note(at: number, title: string): DayNote {
  return { id: dayNoteId(at), at, title, text: '', voice: null };
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
      onWrite={jest.fn()}
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
