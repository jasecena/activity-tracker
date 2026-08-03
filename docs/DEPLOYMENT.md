# Deployment

How a commit becomes a TestFlight build. Everything Apple-specific is a
repository secret or variable; nothing account-specific is committed.

---

## 1. The pipeline

| Workflow          | Trigger                           | What it does                                                                                           |
| ----------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `ci.yml`          | every push and PR                 | typecheck, lint, format, 248 tests, `expo config`, `expo-doctor`. All on Linux, all under a minute.    |
| `security.yml`    | every push/PR + Mondays 03:00 UTC | gitleaks over full history, `npm audit`, CodeQL, and a job that fails if any action is not SHA-pinned. |
| `ios-release.yml` | a `v*` tag, or manual dispatch    | macOS runner: prebuild, archive, sign, optional Maestro smoke test, upload to TestFlight.              |

The release workflow derives the marketing version from the tag (`v1.2.3` →
`1.2.3`) and the build number from the workflow run number, which is unique and
strictly increasing — both requirements for a TestFlight upload.

---

## 2. Secrets and variables

Set these at **Settings → Secrets and variables → Actions**. Placeholders below
are the literal shape of each value, not real ones.

### Repository secrets

| Name                            | What it is                                                                                                                                                  | Placeholder                                                                                           |
| ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `APP_STORE_CONNECT_ISSUER_ID`   | Issuer ID from App Store Connect → Users and Access → Integrations → App Store Connect API. One per team.                                                   | `00000000-0000-0000-0000-000000000000`                                                                |
| `APP_STORE_CONNECT_KEY_ID`      | Key ID of the API key you generated there. 10 characters.                                                                                                   | `ABCD123456`                                                                                          |
| `APP_STORE_CONNECT_PRIVATE_KEY` | The **contents** of the `AuthKey_XXXXXXXXXX.p8` file, including the BEGIN/END lines. Downloadable exactly once — if you lost it, revoke and make a new one. | `-----BEGIN PRIVATE KEY-----`<br>`MIGTAgEAMBMGByqGSM49AgEGCCqGSM49...`<br>`-----END PRIVATE KEY-----` |

### Optional secrets — manual signing only

Leave both unset to use **cloud-managed signing**, which is the intended path:
App Store Connect issues the certificate and provisioning profile from the API
key above, and there is nothing to rotate by hand. Set them only if you must
supply your own distribution certificate.

| Name                       | What it is                                                                                                       | Placeholder                           |
| -------------------------- | ---------------------------------------------------------------------------------------------------------------- | ------------------------------------- |
| `IOS_DIST_CERT_P12_BASE64` | Apple Distribution certificate + private key, exported as `.p12`, base64-encoded: `base64 -i dist.p12 \| pbcopy` | `MIIMigIBAzCCDFAGCSqGSIb3DQEHAaCC...` |
| `IOS_DIST_CERT_PASSWORD`   | The password you set when exporting that `.p12`.                                                                 | `a-long-random-passphrase`            |

### Repository variables

Not secrets — they end up in the binary anyway — but kept out of committed source
so the repository holds no account-specific values.

| Name                    | What it is                                                                                                  | Placeholder                   |
| ----------------------- | ----------------------------------------------------------------------------------------------------------- | ----------------------------- |
| `IOS_BUNDLE_IDENTIFIER` | Your reverse-DNS bundle id. Must be globally unique and match the App ID registered at developer.apple.com. | `com.example.activitytracker` |
| `APPLE_TEAM_ID`         | Apple Developer Team ID, 10 characters, from developer.apple.com → Membership.                              | `ABCDE12345`                  |
| `MACOS_RUNNER_LABEL`    | Which runner to build on. Optional; defaults to a GitHub-hosted macOS image.                                | `macos-15`                    |
| `ENABLE_SMOKE_TEST`     | `true` to run the Maestro flow against a simulator before uploading.                                        | `true`                        |

### Local `.env`

Only for `npm run ios` on your own machine. Never contains a credential — copy
[`.env.example`](../.env.example) and fill in the two identifiers:

```bash
IOS_BUNDLE_IDENTIFIER=com.example.activitytracker
APPLE_TEAM_ID=
APP_VARIANT=development
```

`.env` is gitignored and must stay that way.

---

## 3. The Apple side

**This app needs no App ID capabilities.** That is worth stating because it is
unusual and it makes setup shorter.

Core Location — including background updates and "Always" permission — is gated
by Info.plist usage strings and the user's answer to the prompt, **not** by an
entitlement. So a plain App ID with nothing ticked signs fine. Compare an app
using push notifications, where `expo-notifications` writes an `aps-environment`
entitlement and cloud signing cannot issue a profile unless Push Notifications is
enabled on the App ID.

What the app does declare, all written by the `expo-location` plugin from
[`app.config.ts`](../app.config.ts):

- `NSLocationWhenInUseUsageDescription`
- `NSLocationAlwaysAndWhenInUseUsageDescription`
- `UIBackgroundModes: ['location']`

Setup:

1. **developer.apple.com → Identifiers → App IDs → +.** Description anything,
   Bundle ID = your `IOS_BUNDLE_IDENTIFIER`, explicit (not wildcard). Tick
   nothing under Capabilities.
2. **App Store Connect → Apps → +.** Same bundle id. Only needed before the
   first TestFlight upload.
3. **App Store Connect → Users and Access → Integrations → App Store Connect
   API.** Generate a key with the **App Manager** role. Download the `.p8` once
   and put its contents in `APP_STORE_CONNECT_PRIVATE_KEY`.

---

## 4. If you submit to the App Store

Not required for personal TestFlight use, but for completeness:

**Background location is the most-scrutinised background mode there is.** The
review notes must say plainly why the app needs location while closed. The usage
strings must be specific — "this app uses your location" is what gets rejected;
naming what is recorded, and that it stays on the phone, is what does not. The
strings in `app.config.ts` are written for this.

**Privacy nutrition label: Data Not Collected.** Apple defines "collect" as
transmitted off device. Nothing leaves the phone, so that is the accurate answer
— but you have to be able to defend it, which is why the strict-ATS, no-network,
no-analytics posture is worth keeping intact.

**Required-reason APIs.** `ios.privacyManifests` in `app.config.ts` declares
`NSPrivacyAccessedAPICategoryUserDefaults` with reason `CA92.1`, because
AsyncStorage is UserDefaults underneath. Missing this is an automatic rejection
email rather than a review finding. Location is _not_ a required-reason API — it
is permission-gated — and has no entry to make.

---

## 5. Releasing

```bash
git tag v0.1.0
git push origin v0.1.0
```

That is the whole procedure. Watch the run in Actions. To rehearse without a
tag, use **workflow_dispatch** on `ios-release.yml`.

If it fails at `-exportArchive`, the cause is almost always signing: the App ID
does not exist, the bundle id in `IOS_BUNDLE_IDENTIFIER` does not match it, or
the API key lacks the App Manager role.

---

## 6. Rotating a credential

If a key is ever exposed:

1. **Revoke it first.** App Store Connect → Users and Access → Integrations →
   Revoke. This takes a minute; scrubbing git history does not undo the clones
   that already happened.
2. Generate a replacement and update the secret.
3. Then, if you like, deal with the history.

The pre-commit hook and the CI gitleaks job exist to make step 1 unnecessary.
