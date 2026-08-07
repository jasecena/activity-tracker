import * as Location from 'expo-location';

import type { Fix } from '@/core/geo';

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
  },
  /** For a long day out. Wi-Fi-class positioning; routes come out coarse but the shape survives. */
  saver: {
    accuracy: Location.Accuracy.Balanced,
    distanceInterval: 100,
    label: 'Battery saver',
    detail: '~100 m accuracy, a point every 100 m',
  },
  /** For a run you care about. Noticeably more power. */
  detailed: {
    accuracy: Location.Accuracy.High,
    distanceInterval: 10,
    label: 'Detailed',
    detail: '~10 m accuracy, a point every 10 m',
  },
} as const;

export type TrackingPresetId = keyof typeof TRACKING_PRESETS;

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
 * One fix, now, for the "where am I" line at the top of Today.
 *
 * Never fed to the segmenter: a foreground request returns a cached position of
 * unknown age, and threading one into the fold would put a fix out of order in
 * a stream whose ordering the engine depends on.
 */
export async function currentFix(): Promise<Fix | null> {
  try {
    return toFix(await Location.getCurrentPositionAsync({ accuracy: Location.Accuracy.Balanced }));
  } catch {
    return null;
  }
}
