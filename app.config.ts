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
  ],

  ios: {
    bundleIdentifier: `${BASE_BUNDLE_ID}${VARIANT_SUFFIX[VARIANT]}`,
    // Must be unique and strictly increasing per marketing version for every
    // TestFlight upload; CI supplies the workflow run number.
    buildNumber: process.env.IOS_BUILD_NUMBER || '1',
    supportsTablet: false,
    infoPlist: {
      // The app is entirely offline: no analytics, no telemetry, no remote
      // config, no crash reporting upload, and — the one that matters for a
      // location app — no endpoint that a fix could be sent to. Declaring no
      // exception domains means App Transport Security stays fully enforced.
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
      ],
      // Nothing leaves the device, so there is nothing to declare as collected.
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
