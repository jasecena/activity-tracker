import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as CameraModule from 'expo-camera';
import * as KeepAwakeModule from 'expo-keep-awake';
import * as LocationModule from 'expo-location';

import type { UseMedia } from './hooks/useMedia';
import { CaptureScreen } from './CaptureScreen';

const location = LocationModule as unknown as typeof import('../../../__mocks__/expo-location');
/**
 * The camera mock's own controls, narrowed the same way the location mock is.
 *
 * `stopRecording` is a method on the view in the real module and a module-level
 * function here, because a test has to be able to end a recording the camera
 * would have ended itself.
 */
const camera = CameraModule as unknown as typeof import('../../../__mocks__/expo-camera');
const awake = KeepAwakeModule as unknown as typeof import('../../../__mocks__/expo-keep-awake');

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

  /**
   * Found by the orientation tests and fixed with them, because it is the same
   * mistake: `recordAsync` resolves only when recording stops, so the call that
   * hands the clip to the store is running inside the closure that started it.
   * A closure created before the reading arrived, holding a position that was
   * `null` when it was captured and stayed `null` for ever after.
   *
   * Every video was stored with no position at all — asked for, received,
   * dropped one render away — and nothing anywhere errored. The pin simply
   * never appeared.
   */
  it('keeps the reading a video started with, rather than the null it began as', async () => {
    const keep = jest.fn(async () => null);
    await renderCapture(keep);

    await press('Video');
    await press('Start video');
    await press('Stop video');

    expect(keep).toHaveBeenCalledWith(expect.any(String), 'video', expect.objectContaining({ at: expect.any(Object) }));
  });
});

/**
 * Which way the phone was held.
 *
 * The interface is locked to portrait and stays that way, so none of this is
 * visible as a layout change in a test — what it is, is a value recorded with
 * the capture and an angle applied to the controls. Both are asserted directly,
 * because the alternative is a feature that appears to work on a desk and
 * records nothing on a phone.
 */
/**
 * A photograph that kept moving.
 *
 * Five seconds forwards from the shutter, because backwards is impossible:
 * `expo-camera` has no rolling buffer, and frames from before the press were
 * never handed over. What can be tested here is that the press is the whole
 * gesture, that the clip is a clip, and that the key frame is the moment you
 * pressed rather than wherever the extractor happened to land.
 */
/**
 * Reported from a phone: start recording, put it down, and twenty or thirty
 * seconds later the display sleeps, the phone locks, and the clip is cut off
 * wherever it had got to. A camera preview is not user activity as far as the
 * auto-lock timer is concerned.
 */

/**
 * The wheel's numbers come from AVFoundation via the local native module,
 * which does not exist under Jest — `describeCameras` returns nothing, the
 * dial spec is null, and the screen must simply not draw a wheel. The
 * arithmetic itself is tested in core; what is worth pinning here is the
 * degradation, because a simulator has no cameras either and the viewfinder
 * still has to work there.
 */
describe('the zoom wheel without a phone', () => {
  it('offers no stops when the hardware would not say', async () => {
    await renderCapture(async () => null);
    await act(async () => {});

    expect(screen.queryByLabelText(/Zoom to/)).not.toBeOnTheScreen();
  });

  it('still shows the viewfinder and the shutter', async () => {
    await renderCapture(async () => null);
    await act(async () => {});

    expect(screen.getByLabelText('Take photo')).toBeOnTheScreen();
  });
});

describe('keeping the screen awake', () => {
  beforeEach(() => {
    awake.__reset();
  });

  it('does not hold the screen on merely for being open', async () => {
    await renderCapture(async () => null);

    expect(awake.activateKeepAwakeAsync).not.toHaveBeenCalled();
  });

  it('holds it from the moment recording starts', async () => {
    const keep = jest.fn(() => new Promise(() => undefined)) as unknown as UseMedia['keep'];
    await renderCapture(keep);

    await press('Video');
    await press('Start video');

    expect(awake.activateKeepAwakeAsync).toHaveBeenCalled();
  });

  /**
   * The other half of the same failure. Sealing a minute of video takes
   * seconds, the overlay asks you to keep the app open, and the phone locking
   * itself while you do is the app creating the problem it is warning about.
   * Dropping the lock between the two states is exactly where it would lock.
   */
  it('keeps holding it while the capture is being sealed', async () => {
    const keep = jest.fn(() => new Promise(() => undefined)) as unknown as UseMedia['keep'];
    await renderCapture(keep);

    await press('Video');
    await press('Start video');
    await press('Stop video');

    expect(screen.getByLabelText('Saving')).toBeOnTheScreen();
    expect(awake.deactivateKeepAwake).not.toHaveBeenCalled();
  });

  // A lock held for ever is a phone that never sleeps — the opposite failure,
  // and a much quieter one.
  it('gives it back once the capture is stored', async () => {
    const keep = jest.fn(async () => null) as unknown as UseMedia['keep'];
    await renderCapture(keep);

    await press('Video');
    await press('Start video');
    await press('Stop video');

    expect(await screen.findByLabelText('Start video')).toBeOnTheScreen();
    expect(awake.deactivateKeepAwake).toHaveBeenCalled();
  });
});

describe('holding the phone sideways', () => {
  /** The prop iOS calls. Without it the callback never fires and none of this happens. */
  function cameraProps(): Record<string, unknown> {
    const calls = (camera.CameraView as unknown as jest.Mock).mock.calls;
    return calls[calls.length - 1][0] as Record<string, unknown>;
  }

  async function turnTo(orientation: string) {
    const handler = cameraProps().onResponsiveOrientationChanged as (event: { orientation: string }) => void;
    await act(async () => {
      handler({ orientation });
    });
  }

  it('asks the camera to report orientation even though the interface is locked', async () => {
    await renderCapture(async () => null);

    expect(cameraProps().responsiveOrientationWhenOrientationLocked).toBe(true);
    expect(typeof cameraProps().onResponsiveOrientationChanged).toBe('function');
  });

  it('records how the phone was held with the photograph', async () => {
    const keep = jest.fn(async () => null);
    await renderCapture(keep);

    await turnTo('landscapeLeft');
    await press('Take photo');

    expect(keep).toHaveBeenCalledWith(
      expect.any(String),
      'photo',
      expect.objectContaining({ orientation: 'landscapeLeft' }),
    );
  });

  /**
   * The same rule as the position: a clip is stamped with where and how it
   * *began*. A video started in landscape and stopped once the phone came
   * upright was shot in landscape, and taking the reading at the end describes
   * a moment nobody filmed.
   */
  it('stamps a video with how it was held when recording started', async () => {
    const keep = jest.fn(async () => null);
    await renderCapture(keep);

    await press('Video');
    await turnTo('landscapeRight');
    await press('Start video');
    await turnTo('portrait');
    await press('Stop video');

    expect(keep).toHaveBeenCalledWith(
      expect.any(String),
      'video',
      expect.objectContaining({ orientation: 'landscapeRight' }),
    );
  });

  it('turns the controls to stay upright, and moves the rail to the edge that is now the top', async () => {
    await renderCapture(async () => null);

    const upright = screen.getByLabelText('Photo');
    expect(upright).toHaveStyle({ transform: [{ rotate: '0deg' }] });

    await turnTo('landscapeLeft');

    expect(screen.getByLabelText('Photo')).toHaveStyle({ transform: [{ rotate: '90deg' }] });
  });
});
