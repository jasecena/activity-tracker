import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { HOLD_MS } from '../hold';

import { HoldToRecord } from './HoldToRecord';

/**
 * The gesture, end to end. `hold.test.ts` asserts the arithmetic of the ring;
 * what is left for here is the thing that arithmetic exists for — that a touch
 * short of a second starts nothing at all.
 */

beforeEach(() => {
  jest.useFakeTimers();
});

afterEach(() => {
  jest.useRealTimers();
});

function control(props: Partial<React.ComponentProps<typeof HoldToRecord>> = {}) {
  return <HoldToRecord recording={false} saving={false} onStart={jest.fn()} onStop={jest.fn()} {...props} />;
}

async function hold(ms: number) {
  await fireEvent(screen.getByRole('button'), 'pressIn');
  await act(async () => {
    jest.advanceTimersByTime(ms);
  });
}

it('starts recording once the button has been held for a second', async () => {
  const onStart = jest.fn();
  await render(control({ onStart }));

  await hold(HOLD_MS);

  expect(onStart).toHaveBeenCalled();
});

/**
 * The entire reason the hold exists. A stray touch on a control sitting beside
 * the text field must not leave a recording attached to the note.
 */
it('starts nothing at all for a touch shorter than the hold', async () => {
  const onStart = jest.fn();
  await render(control({ onStart }));

  await hold(HOLD_MS / 2);
  await fireEvent(screen.getByRole('button'), 'pressOut');
  await fireEvent.press(screen.getByRole('button'));

  expect(onStart).not.toHaveBeenCalled();
});

it('abandons the hold when the finger leaves early, ring and all', async () => {
  const onStart = jest.fn();
  await render(control({ onStart }));

  await hold(HOLD_MS - 100);
  await fireEvent(screen.getByRole('button'), 'pressOut');
  await act(async () => {
    jest.advanceTimersByTime(HOLD_MS);
  });

  expect(onStart).not.toHaveBeenCalled();
  expect(screen.queryByTestId('hold-ring')).toBeNull();
});

it('draws the ring while the finger is down', async () => {
  await render(control());

  await hold(HOLD_MS / 2);

  expect(screen.getByTestId('hold-ring')).toBeTruthy();
});

/** Stopping is one tap: nobody holds a button to end something they are watching. */
it('stops on a single tap while recording', async () => {
  const onStop = jest.fn();
  await render(control({ recording: true, onStop }));

  await fireEvent.press(screen.getByRole('button'));

  expect(onStop).toHaveBeenCalled();
});

it('cannot be held into a second recording while one is running', async () => {
  const onStart = jest.fn();
  await render(control({ recording: true, onStart }));

  await hold(HOLD_MS * 2);

  expect(onStart).not.toHaveBeenCalled();
});

it('says which of the two things it is about to do', async () => {
  const { rerender } = await render(control());
  expect(screen.getByLabelText('Hold to record a voice note')).toBeTruthy();

  await rerender(control({ recording: true }));
  expect(screen.getByLabelText('Stop recording')).toBeTruthy();
});
