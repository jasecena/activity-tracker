import { Pedometer } from 'expo-sensors';

/**
 * Core Motion, as far as it is reachable.
 *
 * A caveat worth stating plainly, because the obvious design asks for something
 * that does not exist here: **`CMMotionActivityManager` — the classifier that
 * reports "walking", "running", "automotive" with a confidence — has no binding
 * in Expo.** Using it means writing a native module and a config plugin. Until
 * then, this app decides what you were doing from speed alone
 * (`core/segments/classify.ts`), which is why a slow cycle and a fast walk are
 * genuinely hard for it to tell apart.
 *
 * What *is* available is the pedometer, which is real Core Motion data from the
 * motion coprocessor and costs approximately no battery — the M-series chip
 * counts steps whether this app asks or not. It earns its place for one thing
 * the GPS cannot do: confirming that a stretch the segmenter called a walk has
 * steps under it. A "walk" with no steps was a bus.
 */

export type MotionAvailability = 'available' | 'unavailable' | 'unknown';

export async function pedometerAvailability(): Promise<MotionAvailability> {
  try {
    return (await Pedometer.isAvailableAsync()) ? 'available' : 'unavailable';
  } catch {
    return 'unknown';
  }
}

/**
 * Ask for motion permission.
 *
 * Separate from location's: iOS treats motion and fitness as its own privacy
 * class with its own prompt, and refusing it must not stop the app tracking.
 */
export async function requestMotionPermission(): Promise<boolean> {
  try {
    const { granted } = await Pedometer.requestPermissionsAsync();
    return granted;
  } catch {
    return false;
  }
}

/**
 * Steps taken in a window, or null if the question could not be answered.
 *
 * Null rather than zero, always. Zero steps is a meaningful claim — you were in
 * a car — and returning it when the pedometer was simply unavailable would put
 * "0 steps" against a walk that definitely happened. iOS keeps roughly seven
 * days of this history, so windows older than that legitimately return null too.
 */
export async function stepsBetween(from: number, to: number): Promise<number | null> {
  if (!(to > from)) return null;
  try {
    const result = await Pedometer.getStepCountAsync(new Date(from), new Date(to));
    return typeof result?.steps === 'number' ? result.steps : null;
  } catch {
    return null;
  }
}
