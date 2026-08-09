import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { UseMedia } from './hooks/useMedia';
import { CaptureScreen } from './CaptureScreen';

/**
 * Reported from a phone: video recording felt laggy, the Stop button worked
 * "with delay", and it was not obvious whether it had stopped — so it got
 * tapped again, and again.
 *
 * One cause. `recordAsync` resolves only when recording stops, so awaiting it
 * and clearing the flag in a `finally` kept the button in its recording state
 * for the whole time the clip was being sealed. These tests pin the two halves
 * of the fix: Stop takes effect immediately, and nothing is tappable while the
 * sealing it started is still running.
 */

function mediaStub(keep: UseMedia['keep']): UseMedia {
  return { ready: true, items: [], keep, annotate: () => undefined, forget: () => undefined } as unknown as UseMedia;
}

function renderCapture(keep: UseMedia['keep']) {
  return render(<CaptureScreen media={mediaStub(keep)} visible />);
}

async function press(label: string) {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(label));
  });
}

describe('recording a video', () => {
  it('leaves the recording state the moment Stop is pressed, not when saving ends', async () => {
    // Never resolves: the seal is still running for the whole assertion, which
    // is exactly the window the old build spent looking like it was recording.
    const keep = jest.fn(() => new Promise(() => undefined)) as unknown as UseMedia['keep'];
    await renderCapture(keep);

    await press('Video');
    await press('Start video');
    expect(screen.getByLabelText('Stop video')).toBeOnTheScreen();

    await press('Stop video');

    expect(screen.queryByLabelText('Stop video')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Saving')).toBeOnTheScreen();
  });

  it('refuses further taps while it is saving', async () => {
    const keep = jest.fn(() => new Promise(() => undefined)) as unknown as UseMedia['keep'];
    await renderCapture(keep);

    await press('Video');
    await press('Start video');
    await press('Stop video');

    expect(screen.getByLabelText('Saving')).toBeDisabled();
    // And the mode chips with it: switching would unmount the camera under a
    // recording that has not finished being written.
    expect(screen.getByLabelText('Photo')).toBeDisabled();
  });

  it('shows how far along the saving is', async () => {
    let report: ((fraction: number) => void) | undefined;
    const keep = jest.fn((_uri, _kind, options) => {
      report = options?.onProgress;
      return new Promise(() => undefined);
    }) as unknown as UseMedia['keep'];

    await renderCapture(keep);
    await press('Video');
    await press('Start video');
    await press('Stop video');

    await act(async () => {
      report?.(0.42);
    });

    expect(screen.getByLabelText('Saving, 42%')).toBeOnTheScreen();
  });

  it('comes back to idle once the clip is stored', async () => {
    const keep = jest.fn(async () => null) as unknown as UseMedia['keep'];
    await renderCapture(keep);

    await press('Video');
    await press('Start video');
    await press('Stop video');

    expect(await screen.findByLabelText('Start video')).toBeOnTheScreen();
  });
});

/**
 * `CameraView`'s `zoom` is 0 to 1 across whatever range the lens has, not a
 * magnification, so the buttons step it and the readout is a percentage. There
 * is no pinch: `expo-camera` has no gesture of its own, and a multi-touch
 * responder would fight the swipe between pages for the sake of a thing two
 * buttons already do.
 */
describe('zooming', () => {
  it('starts at the wide end, with nothing to say about it', async () => {
    await renderCapture(async () => null);

    expect(screen.getByLabelText('Zoom out')).toBeDisabled();
    expect(screen.queryByText('0%')).not.toBeOnTheScreen();
  });

  it('steps in and says how far', async () => {
    await renderCapture(async () => null);

    await press('Zoom in');
    await press('Zoom in');

    expect(screen.getByText('20%')).toBeOnTheScreen();
  });

  it('stops at the far end rather than running past it', async () => {
    await renderCapture(async () => null);

    for (let step = 0; step < 12; step += 1) await press('Zoom in');

    expect(screen.getByText('100%')).toBeOnTheScreen();
    expect(screen.getByLabelText('Zoom in')).toBeDisabled();
  });

  it('comes back to the wide end', async () => {
    await renderCapture(async () => null);

    await press('Zoom in');
    await press('Zoom out');

    expect(screen.getByLabelText('Zoom out')).toBeDisabled();
  });

  // The two lenses do not have the same range, so a position carried across
  // means the front camera opens somewhere nobody chose.
  it('goes back to wide when the camera is flipped', async () => {
    await renderCapture(async () => null);

    await press('Zoom in');
    await press('Switch to front camera');

    expect(screen.getByLabelText('Zoom out')).toBeDisabled();
  });

  // Nothing to make larger, and a control that does nothing is worse than none.
  it('offers nothing for a voice note', async () => {
    await renderCapture(async () => null);

    await press('Voice');

    expect(screen.queryByLabelText('Zoom in')).not.toBeOnTheScreen();
  });
});
