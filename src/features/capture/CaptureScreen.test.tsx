import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as LocationModule from 'expo-location';

import type { UseMedia } from './hooks/useMedia';
import { CaptureScreen } from './CaptureScreen';

const location = LocationModule as unknown as typeof import('../../../__mocks__/expo-location');

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

/**
 * A capture stores where it was taken, on the item and in the fix stream, from
 * one reading. This is the path that was quietly broken: location permission
 * was only ever asked for by the tracking switch, so a phone that had never
 * turned tracking on got no position on any photograph and said nothing.
 */
describe('where a capture happened', () => {
  // Scoped, not global: the mock's call log outlives a test in this file, and
  // every assertion below counts calls rather than inspecting a result.
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('checks for location as soon as the tab appears', async () => {
    await renderCapture(async () => null);

    expect(location.getForegroundPermissionsAsync).toHaveBeenCalled();
  });

  it('does not check while another tab is showing', async () => {
    await render(<CaptureScreen media={mediaStub(async () => null)} visible={false} />);

    expect(location.getForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  // The gap this closes: permission was only ever asked for by the tracking
  // switch, so a phone that had never turned tracking on got no position on any
  // photograph, and said nothing about it.
  it('asks when nobody has answered yet', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValueOnce({
      status: location.PermissionStatus.UNDETERMINED,
      canAskAgain: true,
    } as never);

    await renderCapture(async () => null);

    expect(location.requestForegroundPermissionsAsync).toHaveBeenCalled();
  });

  // A dialog nobody needed is worse than no dialog.
  it('does not ask again once it has been granted', async () => {
    await renderCapture(async () => null);

    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  // iOS will not show the dialog a second time, so asking is a round trip that
  // always fails.
  it('does not ask again once it has been refused', async () => {
    location.getForegroundPermissionsAsync.mockResolvedValueOnce({
      status: location.PermissionStatus.DENIED,
      canAskAgain: false,
    } as never);

    await renderCapture(async () => null);

    expect(location.requestForegroundPermissionsAsync).not.toHaveBeenCalled();
  });

  // The background upgrade is offered once per install and belongs to the
  // tracking switch, which is the thing that records while the app is closed.
  it('never asks for the background upgrade', async () => {
    await renderCapture(async () => null);

    expect(location.requestBackgroundPermissionsAsync).not.toHaveBeenCalled();
  });

  it('hands the reading to the store with the photo', async () => {
    const keep = jest.fn(async () => null);
    await renderCapture(keep);

    await press('Take photo');

    expect(keep).toHaveBeenCalledWith(expect.any(String), 'photo', expect.objectContaining({ at: expect.any(Object) }));
  });
});
