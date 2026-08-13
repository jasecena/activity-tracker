import * as Location from 'expo-location';

import type { Fix } from '@/core/geo';

import { now } from './clock';

/**
 * The only file in the app that talks to Core Location.
 *
 * Everything above it deals in `Fix` — six numbers — and knows nothing about
 * `LocationObject`, permission enums or task names. That boundary is what lets
 * the engine be tested on a machine that is not moving.
 */

/**
 * Registered in `services/locationTask.ts`, which `index.ts` imports first.
 *
 * The name lives here rather than there so that this file has no reason to
 * import the task module and create a cycle.
 */
export const LOCATION_TASK_NAME = 'activity-tracker.location-updates';

export type TrackingPermission =
  /** Not asked yet. */
  | 'unknown'
  /** Background capture works. The only state where the app does what it claims. */
  | 'always'
  /** Fixes arrive only while the app is open. Better than nothing, and honest about it. */
  | 'when-in-use'
  | 'denied';

/**
 * How hard to work the GPS.
 *
 * Battery on iOS is dominated by two things: the accuracy class, which decides
 * whether the GPS chip is powered or whether Wi-Fi positioning will do, and the
 * distance filter, which decides how often the app is woken to be told
 * something. A distance filter is close to free when you are sitting still —
 * Core Location does the comparison in hardware and the app is never woken at
 * all — which is why it, rather than a timer, is the lever used here.
 *
 * `Accuracy.High` is documented as ~10 m, the closest class to the 15 m that
 * street-level tracking actually needs. `Highest` and `BestForNavigation` cost
 * substantially more power for precision that a walking route cannot use.
 */
export const TRACKING_PRESETS = {
  /** The default. Street-level accuracy, a fix roughly every 25 m of travel. */
  balanced: {
    accuracy: Location.Accuracy.High,
    distanceInterval: 25,
    label: 'Balanced',
    detail: '~10 m accuracy, a point every 25 m',
    readingErrorM: 10,
  },
  /** For a long day out. Wi-Fi-class positioning; routes come out coarse but the shape survives. */
  saver: {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 100,
    label: 'Battery saver',
    detail: '~100 m accuracy, a point every 100 m',
    readingErrorM: 100,
  },
  /** For a run you care about. Noticeably more power. */
  detailed: {
    accuracy: Location.Accuracy.High,
    distanceInterval: 10,
    label: 'Detailed',
    detail: '~10 m accuracy, a point every 10 m',
    readingErrorM: 10,
  },
} as const;

export type TrackingPresetId = keyof typeof TRACKING_PRESETS;

/**
 * What one reading from a preset could be out by, in metres.
 *
 * The same figure the preset's own `detail` string already tells its owner, as
 * a number — kept beside it so the two cannot drift apart. It exists because
 * asking "did you move" needs an allowance for readings that wander while a
 * phone sits still, and on battery saver that wander is ten times what it is on
 * balanced. `core` takes it as a parameter, since `core` reads no settings.
 */
export function readingErrorFor(preset: TrackingPresetId): number {
  return TRACKING_PRESETS[preset].readingErrorM;
}

export const DEFAULT_PRESET: TrackingPresetId = 'balanced';

export function normalizePresetId(input: unknown): TrackingPresetId {
  return typeof input === 'string' && input in TRACKING_PRESETS ? (input as TrackingPresetId) : DEFAULT_PRESET;
}

/**
 * What Core Location is actually run at, given what you chose and how much
 * charge is left.
 *
 * A low battery **coarsens** and never refines: it can move `detailed` down to
 * `saver`, and it can do nothing at all to a `saver` you chose yourself. The
 * app is what is draining the phone, so it is the thing that should give way
 * first — but only ever in the direction of recording less, never more.
 *
 * Derived rather than stored, which is the whole design. Your choice stays your
 * choice in `settings.preset`; this is a lens over it, so a phone that reaches
 * a charger goes back to full detail without anyone having to remember to put
 * the setting back.
 */
export function effectivePreset(chosen: TrackingPresetId, savingBattery: boolean): TrackingPresetId {
  return savingBattery ? 'saver' : chosen;
}

/**
 * Platform reading to engine fix.
 *
 * The one piece of real translation: Core Location signals "this reading is
 * invalid" with a *negative* accuracy, and a negative number compared against a
 * maximum passes every check. Mapping it to Infinity here is what makes
 * `judgeFix` able to reject it — and doing it at the boundary means the engine
 * never has to know the convention exists.
 */
export function toFix(location: Location.LocationObject): Fix {
  const { coords, timestamp } = location;
  return {
    lat: coords.latitude,
    lon: coords.longitude,
    at: timestamp,
    accuracyM: typeof coords.accuracy === 'number' && coords.accuracy >= 0 ? coords.accuracy : Infinity,
    // Same convention for speed: negative means "could not determine".
    reportedSpeedMps: typeof coords.speed === 'number' && coords.speed >= 0 ? coords.speed : null,
    altitudeM: typeof coords.altitude === 'number' ? coords.altitude : null,
  };
}

function classify(foreground: Location.PermissionStatus, background: Location.PermissionStatus): TrackingPermission {
  if (foreground !== Location.PermissionStatus.GRANTED) {
    return foreground === Location.PermissionStatus.DENIED ? 'denied' : 'unknown';
  }
  return background === Location.PermissionStatus.GRANTED ? 'always' : 'when-in-use';
}

/** What we have now, without prompting for anything. */
export async function getPermission(): Promise<TrackingPermission> {
  try {
    const foreground = await Location.getForegroundPermissionsAsync();
    const background = await Location.getBackgroundPermissionsAsync();
    return classify(foreground.status, background.status);
  } catch {
    return 'unknown';
  }
}

/**
 * Ask, in the order iOS requires.
 *
 * The background prompt is only allowed after foreground has been granted;
 * asking for it first is silently refused. iOS also shows the "Always" upgrade
 * prompt at most once per install, so a user who picks "While Using" here
 * cannot be asked again from inside the app — the Settings screen sends them to
 * Settings instead, which is the only remaining route.
 */
export async function requestPermission(): Promise<TrackingPermission> {
  try {
    const foreground = await Location.requestForegroundPermissionsAsync();
    if (foreground.status !== Location.PermissionStatus.GRANTED) {
      return foreground.status === Location.PermissionStatus.DENIED ? 'denied' : 'unknown';
    }
    const background = await Location.requestBackgroundPermissionsAsync();
    return classify(foreground.status, background.status);
  } catch {
    return 'unknown';
  }
}

/**
 * Ask for foreground location only, and only if nobody has answered yet.
 *
 * Capture needs this. The tracking switch is what governs recording on its own,
 * and pressing the shutter is not the app acting on its own — but a capture
 * still has to ask Core Location where it is, and Core Location will not say
 * without permission. Before this, a phone that had never turned tracking on
 * got no position on any photograph, silently: `getCurrentPositionAsync`
 * rejects and every caller reads that as "we do not know".
 *
 * Foreground only, and **never the background upgrade** — that prompt is
 * offered once per install, and spending it here would take it away from the
 * switch that actually needs it.
 *
 * Returns whether it can be used. `denied` is not re-asked: iOS will not show
 * the dialog again, and calling anyway is a round trip that always fails.
 */
export async function ensureForegroundPermission(): Promise<boolean> {
  try {
    const existing = await Location.getForegroundPermissionsAsync();
    if (existing.status === Location.PermissionStatus.GRANTED) return true;
    if (!existing.canAskAgain) return false;

    const asked = await Location.requestForegroundPermissionsAsync();
    return asked.status === Location.PermissionStatus.GRANTED;
  } catch {
    return false;
  }
}

export async function isTracking(): Promise<boolean> {
  try {
    return await Location.hasStartedLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch {
    return false;
  }
}

/**
 * Start background capture. Returns whether it actually started.
 *
 * Two settings here are deliberate and easy to get wrong:
 *
 * `pausesUpdatesAutomatically: false`. iOS offers to stop location updates when
 * it decides you have not moved for a while, which sounds exactly like the
 * battery saving this app wants. The catch is that it does not reliably resume:
 * the documented trigger is the user starting to move again, and in practice
 * updates can stay paused until something else restarts them. The failure is
 * silent and total — the app looks like it is tracking and records nothing —
 * and a day missing from a diary is worse than a percent of battery. The
 * distance filter already means no wake-ups while you sit still.
 *
 * `showsBackgroundLocationIndicator: true`. The blue pill in the status bar
 * while the app has your location in the background. Honest, and the fastest
 * way to notice that tracking was left on when you meant to stop it.
 */
export async function startTracking(preset: TrackingPresetId): Promise<boolean> {
  const { accuracy, distanceInterval } = TRACKING_PRESETS[preset];

  try {
    if (await isTracking()) await stopTracking();

    await Location.startLocationUpdatesAsync(LOCATION_TASK_NAME, {
      accuracy,
      distanceInterval,
      // Zero means "no time-based updates at all": distance is the only trigger.
      // A time interval would wake the app while it sits on a desk, which is
      // most of the day and none of the interesting part of it.
      timeInterval: 0,
      pausesUpdatesAutomatically: false,
      showsBackgroundLocationIndicator: true,
      // `Other` rather than `Fitness` or `AutomotiveNavigation`: this app
      // records walks and drives in the same stream, and telling Core Location
      // it is one of them biases its own filtering against the other.
      activityType: Location.ActivityType.Other,
    });
    return true;
  } catch (error) {
    console.warn('Could not start location updates', error);
    return false;
  }
}

export async function stopTracking(): Promise<void> {
  try {
    if (await isTracking()) await Location.stopLocationUpdatesAsync(LOCATION_TASK_NAME);
  } catch (error) {
    console.warn('Could not stop location updates', error);
  }
}

/**
 * The oldest reading worth believing is "where am I now".
 *
 * `getCurrentPositionAsync` may answer from Core Location's cache rather than
 * from the radio, and that cache survives a flight. Sixty seconds is generous
 * for a question whose answer is a photo's pin: anything older is a place you
 * were, not a place you are.
 */
const MAX_FIX_AGE_MS = 60_000;

/**
 * The widest circle that still says something about where you are standing.
 *
 * Deliberately looser than the segmenter's `maxAccuracyM` (60 m), because the
 * two are answering different questions. The filter is asked "did this person
 * move?", where a 100 m circle is noise. This is asked "roughly where was this
 * taken?", where 100 m is a street and 3 km is a city — the first is worth
 * keeping and the second is not.
 */
export const MAX_FIX_ACCURACY_M = 150;

/**
 * One fix, now, asked for rather than waited for.
 *
 * This **is** fed to the segmenter, which revises the note that used to stand
 * here — that a foreground request must never reach the fold, because it can
 * return a cached position of unknown age. Where the fold runs, the hazard is
 * handled: `judgeFix` drops a reading that is not newer than the last one as
 * `out-of-order`, and a cold-start position from where the phone was hours ago,
 * stamped now, as a `teleport`.
 *
 * **But the fold is no longer the only consumer**, and that is why this now
 * judges its own answer. A capture stores this reading on the item and draws a
 * pin from it directly, so nothing downstream ever gets the chance to reject
 * it. Handed a cached position from the last city the phone was switched on in,
 * the photo screen would state, with no hedging at all, that the picture was
 * taken on another continent. Two checks close it, and both are local:
 *
 * - **Age.** A cached fix keeps its original timestamp, so its age is the
 *   giveaway even when its coordinates and accuracy look perfect.
 * - **Accuracy.** Indoors, iOS answers a high-accuracy request from Wi-Fi and
 *   cell with a circle kilometres wide rather than not answering at all.
 *
 * Null in both cases, which every caller already handles as "we do not know" —
 * an honest gap, and the answer this app is supposed to give when it has no
 * business claiming otherwise.
 *
 * **`Accuracy.High`, not `Balanced`.** Balanced is documented at ~100 m, and
 * `maxAccuracyM` is 60 — so every reading this returned would have been thrown
 * away by the filter before reaching a segment, and the feature that depends on
 * it would have done nothing at all while appearing to work.
 */
export async function currentFix(): Promise<Fix | null> {
  try {
    const fix = toFix(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.High }));
    if (!(fix.accuracyM <= MAX_FIX_ACCURACY_M)) return null;
    // `Math.abs`, because a clock that has just been corrected can put a fresh
    // reading slightly in the future, and that is not staleness.
    if (Math.abs(now() - fix.at) > MAX_FIX_AGE_MS) return null;
    return fix;
  } catch {
    return null;
  }
}
