import { activateKeepAwakeAsync, deactivateKeepAwake } from 'expo-keep-awake';

/**
 * Keeping the screen on while a capture is in progress.
 *
 * Reported from a phone: start recording, put the phone down, and twenty or
 * thirty seconds later the display sleeps, the phone locks, and the clip is cut
 * off wherever it happened to be. The auto-lock timer does not know the app is
 * doing anything — a camera preview is not user activity, and a recording made
 * without touching the screen looks exactly like a phone left alone.
 *
 * It covers **sealing as well as recording**, which is the other half of the
 * same failure. The saving overlay already says "Keep the app open" because
 * suspension mid-write leaves the capture staged and recoverable only on the
 * next launch. Telling someone to hold the phone awake by hand, and then
 * letting the phone lock itself while they do, was asking them to solve a
 * problem the app had created.
 *
 * A tag of its own, not the default: locks are held per tag, so anything else
 * that ever wants the screen on can take and release its own without one of
 * them cancelling the other.
 */
const TAG = 'capture-in-progress';

/**
 * Both are swallowed rather than thrown.
 *
 * Failing to hold the screen awake means the display might sleep, which is
 * exactly where the app was before this existed. Failing to *release* it is
 * worse in principle and unreachable in practice on iOS, but either one killing
 * a capture would be trading a recording for a brightness setting.
 */
export async function holdScreenAwake(): Promise<void> {
  try {
    await activateKeepAwakeAsync(TAG);
  } catch (error) {
    console.warn('Could not keep the screen awake', error);
  }
}

export async function releaseScreenAwake(): Promise<void> {
  try {
    await deactivateKeepAwake(TAG);
  } catch (error) {
    console.warn('Could not release the screen', error);
  }
}
