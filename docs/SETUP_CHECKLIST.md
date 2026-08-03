# Setup & deployment checklist

Work top to bottom. Each phase is independently useful — you can stop after
Phase 2 and have the app running on your own phone forever.

---

## Phase 0 — Local development

No Apple account needed.

- [ ] **Node 20.19 or later.** `node -v`
- [ ] `npm install`
- [ ] `cp .env.example .env`
- [ ] `npm run verify` — typecheck, lint, format, 248 tests. Should pass in well
      under a minute, entirely on Linux or macOS.
- [ ] _(optional)_ Install [gitleaks](https://github.com/gitleaks/gitleaks) so
      the pre-commit hook can scan staged changes. CI enforces it either way.

> The whole engine is testable without a phone. If you only want to work on
> segmentation, classification, places or calories, you can stop here.

---

## Phase 1 — Apple account

- [ ] **Apple Developer Program membership**, $99/year. Required for background
      location on a real device beyond 7 days.
- [ ] **Team ID**: developer.apple.com → Membership. 10 characters. Note it down.
- [ ] **Register an App ID**: Identifiers → App IDs → **+** → App.
  - [ ] Bundle ID: explicit, reverse-DNS, globally unique
        (e.g. `com.yourname.activitytracker`).
  - [ ] **Tick no capabilities.** This app needs none — Core Location is gated by
        Info.plist strings and the user's consent, not by an entitlement. See
        [DEPLOYMENT.md § 3](DEPLOYMENT.md).
- [ ] Put the bundle id in your local `.env` as `IOS_BUNDLE_IDENTIFIER`.

---

## Phase 2 — Run it on your phone

- [ ] `npm run ios` with the phone connected, or open the prebuilt project in
      Xcode and run.
- [ ] Grant location when asked, then **choose "Always"** at the second prompt.
      "While Using" works but leaves gaps whenever the app is closed, and the app
      says so on Today.
- [ ] Walk somewhere for five minutes. Reopen the app. There should be a move
      segment with a distance and a route shape.
- [ ] Tap a stay and give it a name. Go away, come back, confirm it is recognised.
- [ ] Check Settings → **Signal today**. If "too vague to use" is most of your
      fixes, you were indoors — that is the app being honest, not broken.

> **Background location does not work usefully in the simulator.** It has no GPS
> and the location simulation does not survive backgrounding. Test on hardware.

---

## Phase 3 — CI

- [ ] Push to GitHub. `ci.yml` and `security.yml` run with no configuration.
- [ ] Confirm both are green. `security.yml` needs no secrets — gitleaks, npm
      audit, CodeQL and the SHA-pinning check all run on the public token.
- [ ] Branch protection (optional, solo repo): require CI to pass before merge.
      **Leave "Require review from Code Owners" off** — a code owner cannot
      approve their own PR, and you would be unable to merge your own work.

---

## Phase 4 — TestFlight

Only needed if you want builds delivered over the air rather than via Xcode.

### App Store Connect

- [ ] **Create the app**: App Store Connect → Apps → **+** → New App. Same bundle
      id as Phase 1.
- [ ] **Create an API key**: Users and Access → Integrations → App Store Connect
      API → **+**. Role: **App Manager**.
- [ ] **Download the `.p8`.** You get exactly one chance. If you miss it, revoke
      and generate another.

### GitHub secrets

Settings → Secrets and variables → Actions → **Secrets**:

- [ ] `APP_STORE_CONNECT_ISSUER_ID` — the UUID above the key list.
- [ ] `APP_STORE_CONNECT_KEY_ID` — 10 characters.
- [ ] `APP_STORE_CONNECT_PRIVATE_KEY` — the **entire contents** of the `.p8`,
      including the `-----BEGIN PRIVATE KEY-----` and `-----END-----` lines.

Leave `IOS_DIST_CERT_P12_BASE64` and `IOS_DIST_CERT_PASSWORD` **unset** unless you
are supplying your own distribution certificate. Unset means cloud-managed
signing, which is the intended path and has nothing to rotate by hand.

### GitHub variables

Same page → **Variables**:

- [ ] `IOS_BUNDLE_IDENTIFIER`
- [ ] `APPLE_TEAM_ID`
- [ ] `ENABLE_SMOKE_TEST` = `true` _(optional)_
- [ ] `MACOS_RUNNER_LABEL` _(optional; defaults to a GitHub-hosted macOS image)_

### First release

- [ ] Rehearse with **workflow_dispatch** on `ios-release.yml` before tagging.
- [ ] Then:
      `bash
git tag v0.1.0 && git push origin v0.1.0
`
- [ ] Watch Actions. On failure at `-exportArchive`, the cause is almost always
      signing: App ID missing, bundle id mismatch, or the API key lacking the App
      Manager role.
- [ ] TestFlight → install on your phone.

---

## Phase 5 — Before you rely on it as a diary

The things worth confirming on real hardware, because no test can:

- [ ] **A full day.** Leave it on from morning to night. Compare the timeline
      against what you actually did — the stays should be the places you stopped,
      not a scatter of ten-minute fragments.
- [ ] **The app killed mid-walk.** Force-quit it while out. iOS should relaunch it
      in the background at the next distance trip; the walk should be intact when
      you reopen.
- [ ] **A long indoor stretch.** Should read as one stay or an honest gap, never
      as a walk around the building.
- [ ] **Local midnight crossed mid-journey.** A drive from 23:40 to 00:20 must
      appear once, whole, filed under the day it started.
- [ ] **Battery.** Check Settings → Battery after a full day. If it is more than
      you want, drop to the Battery saver preset and compare.
- [ ] **Erase everything.** Confirm the day list empties and does not come back
      after a relaunch. This destroys the encryption key and is irreversible —
      which is the point.

---

## Not in scope yet

- [ ] **Export** — GPX per activity, JSON dump. On demand, never automatic.
- [ ] **Apple Watch** — standalone recording, syncing when back in range. Needs a
      native Swift target (React Native cannot build for watchOS) and **Series 2
      or later**, since that is where built-in GPS starts. See
      [ARCHITECTURE.md § 15](ARCHITECTURE.md).
- [ ] **Core Motion activity classification** — needs a custom native module.
