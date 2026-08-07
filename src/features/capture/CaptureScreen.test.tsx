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
  return render(<CaptureScreen media={mediaStub(keep)} tzOffsetMinutes={0} visible onOpenItem={() => undefined} />);
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
    const keep = jest.fn((_uri, _kind, _duration, onProgress) => {
      report = onProgress;
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
