import { fireEvent, render, screen } from '@testing-library/react-native';

import { RecordButton } from './RecordButton';

/**
 * Tap to start, tap to stop — the replacement for a one-second hold that was
 * withdrawn after being used. What is asserted here is the property the hold was
 * protecting and this keeps by different means: the two states are told apart by
 * the *glyph*, so a second press is a deliberate stop rather than a guess.
 */

function button(props: Partial<React.ComponentProps<typeof RecordButton>> = {}) {
  return <RecordButton recording={false} onStart={jest.fn()} onStop={jest.fn()} {...props} />;
}

it('starts on a single tap, with nothing to hold', async () => {
  const onStart = jest.fn();
  await render(button({ onStart }));

  await fireEvent.press(screen.getByRole('button'));

  expect(onStart).toHaveBeenCalledTimes(1);
});

it('stops on a single tap while recording', async () => {
  const onStop = jest.fn();
  await render(button({ recording: true, onStop }));

  await fireEvent.press(screen.getByRole('button'));

  expect(onStop).toHaveBeenCalledTimes(1);
});

/**
 * The press never means both. A double tap is start-then-stop, which is a
 * one-second recording somebody can delete — not two recorders running, and not
 * a press that silently does nothing.
 */
it('never starts and stops from one press', async () => {
  const onStart = jest.fn();
  const onStop = jest.fn();
  const { rerender } = await render(button({ onStart, onStop }));

  await fireEvent.press(screen.getByRole('button'));
  await rerender(button({ recording: true, onStart, onStop }));
  await fireEvent.press(screen.getByRole('button'));

  expect(onStart).toHaveBeenCalledTimes(1);
  expect(onStop).toHaveBeenCalledTimes(1);
});

/**
 * Colour is a second signal, never the only one — a greyscale screen, a
 * colourblind reader and a glance in sunlight all have to be able to tell which
 * of the two things the button is about to do.
 */
it('says which state it is in without relying on colour', async () => {
  const { rerender } = await render(button());
  expect(screen.getByLabelText('Record a voice note')).toBeTruthy();

  await rerender(button({ recording: true }));
  expect(screen.getByLabelText('Stop recording')).toBeTruthy();
  expect(screen.getByRole('button', { selected: true })).toBeTruthy();
});
