import type { ConfigContext, ExpoConfig } from 'expo/config';

/**
 * Dynamic Expo config.
 *
 * Everything environment-specific is read from env vars with a safe default, so
 * the same source tree builds a dev, preview or production app without edits
 * and without any identifier or credential being committed. See .env.example.
 */

type Variant = 'development' | 'preview' | 'production';

const VARIANT = (process.env.APP_VARIANT ?? 'production') as Variant;

/**
 * Your own reverse-DNS identifier. Must be globally unique across the App
 * Store, and must match the App ID registered in your Apple Developer account.
 */
const BASE_BUNDLE_ID = process.env.IOS_BUNDLE_IDENTIFIER ?? 'com.example.activitytracker';

const VARIANT_SUFFIX: Record<Variant, string> = {
  development: '.dev',
  preview: '.preview',
  production: '',
};

const VARIANT_NAME: Record<Variant, string> = {
  development: 'Activity Tracker (Dev)',
  preview: 'Activity Tracker (Preview)',
  production: 'Activity Tracker',
};

/**
 * Shown in the permission dialog, and read by App Review.
 *
 * Specific on purpose. "This app uses your location" is the string that gets a
 * background-location app rejected; naming what is recorded, and that it stays
 * on the phone, is what gets it approved. Changing these means re-reading
 * docs/DEPLOYMENT.md § 4.
 */
const WHEN_IN_USE_REASON =
  'Records the route of the walk, ride or drive you are on, so the day is logged without you having to press start.';
const ALWAYS_REASON =
  'Keeps logging your walks, rides and drives while the app is closed, so your day is recorded as it happens. Every fix stays on this phone and is never uploaded.';

/**
 * Capture. Same rule as the location strings: name what is recorded and where
 * it goes, because "this app uses your camera" is the sentence that gets a
 * review rejection rather than an approval.
 */
const CAMERA_REASON =
  'Takes the photos and videos you attach to a day in your diary. They stay in this app on this phone, are kept out of backups, and are never uploaded.';
const MICROPHONE_REASON =
  'Records the voice notes you attach to a day in your diary, and the sound on any video you capture. They stay in this app on this phone, are kept out of backups, and are never uploaded.';

export default ({ config }: ConfigContext): ExpoConfig => ({
  ...config,
  name: VARIANT_NAME[VARIANT],
  slug: 'activity-tracker',
  // CI derives the marketing version from the release tag (v1.2.3 -> 1.2.3).
  version: process.env.APP_VERSION || '0.1.0',
  orientation: 'portrait',
  icon: './assets/icon.png',
  scheme: 'activitytracker',
  userInterfaceStyle: 'dark',

  // iPhone only, for now. Listing a single platform keeps `expo start` from
  // offering targets that are not actually supported or tested.
  platforms: ['ios'],

  plugins: [
    [
      'expo-splash-screen',
      {
        image: './assets/splash-icon.png',
        resizeMode: 'contain',
        // Matches colors.background, so launch does not flash white into a dark UI.
        backgroundColor: '#0B0F14',
      },
    ],
    [
      // Writes the three Info.plist keys below and, with
      // `isIosBackgroundLocationEnabled`, the `location` background mode.
      //
      // Note what it does NOT write: an entitlement. Core Location — including
      // always-on background updates — is gated by these usage strings and the
      // user's answer to the prompt, not by a capability on the App ID. So
      // unlike an app using push, this one signs against a plain App ID with
      // nothing ticked at developer.apple.com. See docs/DEPLOYMENT.md § 3.
      'expo-location',
      {
        locationWhenInUsePermission: WHEN_IN_USE_REASON,
        locationAlwaysAndWhenInUsePermission: ALWAYS_REASON,
        locationAlwaysPermission: ALWAYS_REASON,
        isIosBackgroundLocationEnabled: true,
      },
    ],
    [
      // Photo and video capture. `microphonePermission` here covers the audio
      // track of a video; expo-audio below covers a voice note. Both write the
      // same Info.plist key, so the two strings must agree — iOS shows
      // whichever one landed in the plist, not the one belonging to the API
      // that happened to ask.
      'expo-camera',
      {
        cameraPermission: CAMERA_REASON,
        microphonePermission: MICROPHONE_REASON,
        // No barcode scanning here, and leaving it on links a framework and a
        // required-reason API for a feature this app does not have.
        barcodeScannerEnabled: false,
      },
    ],
    [
      // Both background flags off, and this is not a detail.
      //
      // `enableBackgroundPlayback` defaults to **true**, which pushes `audio`
      // into `UIBackgroundModes`. This app plays a voice note while you are
      // looking at it and nothing else, so that would be claiming a background
      // capability it never uses — and an unused background mode is a review
      // rejection on an app whose whole submission argument is that it asks for
      // exactly one, for a reason it can name.
      'expo-audio',
      {
        microphonePermission: MICROPHONE_REASON,
        enableBackgroundPlayback: false,
        enableBackgroundRecording: false,
      },
    ],
    [
      // Apple Maps. `requestLocationPermission` is false deliberately: the app
      // already holds its own always-on permission and asks for it with a
      // string that explains background tracking. Letting the map plugin ask
      // again would put a second, vaguer prompt in front of the same person
      // for the same capability.
      //
      // This module is the one place the app touches the network, and only
      // when `settings.mapsEnabled` is on — see MapCanvas and ARCHITECTURE §12.
      'expo-maps',
      { requestLocationPermission: false },
    ],
  ],

  ios: {
    bundleIdentifier: `${BASE_BUNDLE_ID}${VARIANT_SUFFIX[VARIANT]}`,
    // Must be unique and strictly increasing per marketing version for every
    // TestFlight upload; CI supplies the workflow run number.
    buildNumber: process.env.IOS_BUILD_NUMBER || '1',
    supportsTablet: false,
    infoPlist: {
      // No analytics, no telemetry, no remote config, no crash reporting
      // upload, and — the one that matters for a location app — no endpoint
      // that a fix could be sent to. Nothing this app records ever leaves it.
      //
      // The single exception is map imagery, which MapKit fetches from Apple,
      // and only while `settings.mapsEnabled` is on. It is off until you turn
      // it on, it carries the region you are looking at and never the track
      // (that is drawn as an overlay on this device), and it is the reason
      // this key is now load-bearing rather than moot: declaring no exception
      // domains keeps App Transport Security fully enforced over it.
      NSAppTransportSecurity: { NSAllowsArbitraryLoads: false },
      // Declares we use no non-exempt encryption, which skips the export
      // compliance questionnaire on every single upload.
      ITSAppUsesNonExemptEncryption: false,
      // Set by the expo-location plugin too; stated here so that the one
      // capability this app actually claims is visible in the config rather
      // than only in generated native output.
      UIBackgroundModes: ['location'],
    },
    // Required-reason API declarations. AsyncStorage is UserDefaults
    // underneath, and shipping without this is an automatic rejection email
    // from App Store Connect rather than a review finding.
    //
    // Location is deliberately absent: it is a permission-gated API, not a
    // required-reason one, and it has no entry to make here.
    privacyManifests: {
      NSPrivacyAccessedAPITypes: [
        {
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryUserDefaults',
          // CA92.1 — access to data written by this app itself.
          NSPrivacyAccessedAPITypeReasons: ['CA92.1'],
        },
        {
          // Media capture reads the size and modification time of files this
          // app wrote, to show what a recording costs on disk.
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryFileTimestamp',
          // C617.1 — files created by, or provided to, this app.
          NSPrivacyAccessedAPITypeReasons: ['C617.1'],
        },
        {
          // Refusing a video capture that would not fit is better than one
          // that fails halfway through and leaves a truncated file.
          NSPrivacyAccessedAPIType: 'NSPrivacyAccessedAPICategoryDiskSpace',
          // E174.1 — to display space to the user, or to decide whether an
          // operation can proceed.
          NSPrivacyAccessedAPITypeReasons: ['E174.1'],
        },
      ],
      // Still nothing to declare as collected. Photos, video and voice notes
      // are encrypted on this device and have no upload path; map imagery is
      // a request *to* Apple for tiles, not data collected *by* this app.
      NSPrivacyCollectedDataTypes: [],
      NSPrivacyTracking: false,
    },
  },

  extra: {
    variant: VARIANT,
    eas: {
      // Populated by `eas init`. Not a secret — it is a public project handle.
      projectId: process.env.EAS_PROJECT_ID ?? undefined,
    },
  },

  experiments: {
    typedRoutes: false,
  },
});
