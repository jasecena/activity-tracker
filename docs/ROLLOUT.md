# Rollout plan

A sequenced plan for taking this from a repository to an app on your phone, via
TestFlight. Written to be picked up cold: each stage says what it needs, what it
costs, roughly how long it takes, and how you know it worked.

Nothing here is urgent. Stages 0–2 need no Apple account and no money. The app is
fully usable at the end of Stage 3 without ever touching TestFlight.

| Stage | What you get                   | Needs            | Rough time             |
| ----- | ------------------------------ | ---------------- | ---------------------- |
| 0     | Code runs, tests pass          | Node 20.19+      | 10 min                 |
| 1     | App on your phone for 7 days   | Free Apple ID    | 30 min                 |
| 2     | Apple Developer membership     | $99/yr, ID check | 20 min + 1–2 days wait |
| 3     | App on your phone permanently  | Stage 2          | 20 min                 |
| 4     | CI green on every push         | GitHub repo      | 10 min                 |
| 5     | Builds delivered over the air  | Stages 2–4       | 45 min                 |
| 6     | Confidence it works as a diary | A real week      | 1 week, passive        |

---

## Stage 0 — Get it running locally

**Needs:** Node 20.19 or later. Nothing else.

```bash
npm install
cp .env.example .env
npm run verify
```

**Done when:** 230 tests pass in well under a minute. This is the whole engine —
segmentation, classification, places, calories, encryption — verified without a
phone, a simulator or a network.

**If you stop here** you still have something: the engine is the part that has to
be correct, and it is fully exercised.

---

## Stage 1 — On your phone, the free way

**Needs:** a free Apple ID and a Mac with Xcode. **Cost:** nothing.

A free Apple ID can sign an app onto your own device, but the provisioning
profile **expires after 7 days** and background location entitlements are
limited. This is for confirming the app works on your hardware before you spend
anything.

1. Set `IOS_BUNDLE_IDENTIFIER` in `.env` to something unique
   (`com.yourname.activitytracker`).
2. `npx expo prebuild --platform ios`
3. `open ios/*.xcworkspace`, select your device, set the Team to your personal
   Apple ID under Signing & Capabilities, Run.

**Done when:** the app launches, you grant location, and after a five-minute walk
there is a move segment with a distance and a route shape.

**Expect friction here.** "Untrusted Developer" needs
Settings → General → VPN & Device Management on the phone. This is normal for
free-account signing and goes away at Stage 3.

---

## Stage 2 — Apple Developer Program

**Cost:** $99/year, recurring. **Time:** 20 minutes to apply, then **1–2 business
days** for Apple to approve. Occasionally longer if they ask for ID.

Enrol at [developer.apple.com/programs](https://developer.apple.com/programs/).
Enrol as an **individual** unless you have a company with a D-U-N-S number —
individual is faster and is what you want for a personal project. Your legal name
becomes the seller name; that only matters if you ever publish publicly.

**This is the only stage with a mandatory wait.** Start it early if you know you
want TestFlight, and carry on with Stages 0–1 and 4 meanwhile.

**Done when:** you can see a Team ID at developer.apple.com → Membership.

Note it down — it is `APPLE_TEAM_ID` later. It is not a secret (it is embedded in
every provisioning profile) but it is kept out of committed source anyway.

---

## Stage 3 — On your phone, permanently

**Needs:** Stage 2 approved.

1. **Register the App ID.** developer.apple.com → Identifiers → **+** → App IDs →
   App. Bundle ID: explicit, matching your `.env`.
   **Tick no capabilities.** This app needs none — Core Location, including
   "Always" and background updates, is gated by Info.plist usage strings and the
   user's consent, not by an entitlement. If you are used to iOS projects this
   will feel wrong; it is correct. See [DEPLOYMENT.md § 3](DEPLOYMENT.md).
2. Rebuild from Xcode with the real Team selected.
3. Grant location and **choose "Always"** at the second prompt.

**Done when:** the app is on your phone with a profile that does not expire in a
week, and Today shows segments after a walk.

**You could stop here forever.** Everything past this point is about delivering
builds without plugging in a cable.

---

## Stage 4 — CI

**Needs:** the repository on GitHub. Independent of Stages 1–3 — do it whenever.

Push. `ci.yml` and `security.yml` run with **no configuration and no secrets**:
typecheck, lint, format, 230 tests, `expo-doctor`, gitleaks over full history,
`npm audit`, CodeQL, and a job that fails if any action is not pinned to a commit
SHA.

**Done when:** both workflows are green.

Optional: branch protection requiring CI to pass. **Leave "Require review from
Code Owners" off** — a code owner cannot approve their own PR, and you would be
unable to merge your own work on a solo repo.

---

## Stage 5 — TestFlight

**Needs:** Stages 2 and 4. **Time:** ~45 minutes of setup, then every release is
one `git tag`.

### 5a. App Store Connect

1. **Create the app.** App Store Connect → Apps → **+** → New App. Same bundle
   id. Platform iOS. SKU can be anything.
2. **Create an API key.** Users and Access → Integrations → App Store Connect API
   → **+**. Role: **App Manager**.
3. **Download the `.p8` immediately.** You get exactly one chance. If you miss
   it, revoke the key and generate another — there is no recovery.

### 5b. GitHub secrets and variables

Placeholders and exact shapes: [DEPLOYMENT.md § 2](DEPLOYMENT.md).

Secrets: `APP_STORE_CONNECT_ISSUER_ID`, `APP_STORE_CONNECT_KEY_ID`,
`APP_STORE_CONNECT_PRIVATE_KEY`.

Variables: `IOS_BUNDLE_IDENTIFIER`, `APPLE_TEAM_ID`, optionally
`ENABLE_SMOKE_TEST=true` and `MACOS_RUNNER_LABEL`.

Leave the two `IOS_DIST_CERT_*` secrets **unset**. Unset means cloud-managed
signing — App Store Connect issues the certificate and profile from the API key,
and there is nothing to rotate by hand. Setting them is the fallback, not the
path.

### 5c. Rehearse, then release

Run `ios-release.yml` via **workflow_dispatch** first. It exercises the whole
pipeline without creating a tag you would have to delete.

Then:

```bash
git tag v0.1.0
git push origin v0.1.0
```

The workflow derives the version from the tag (`v1.2.3` → `1.2.3`) and the build
number from the run number — unique and strictly increasing, which TestFlight
requires.

### 5d. Install it

- **Internal testers** (up to 100, all on your team): available as soon as
  processing finishes, usually 5–15 minutes. **No beta review.** For a personal
  project this is the only tier you need — add yourself and you are done.
- **External testers** (up to 10,000): require **Beta App Review**, typically
  1–3 days. Only relevant if you share it with people outside your team.
- Builds expire after **90 days**. For continuous personal use, either re-tag
  quarterly or install via Xcode, which does not expire.

**Done when:** the build appears in the TestFlight app on your phone and installs.

### If it fails

Almost always signing, at `-exportArchive`. In order of likelihood: the App ID
does not exist; `IOS_BUNDLE_IDENTIFIER` does not match it; the API key lacks the
App Manager role; `APPLE_TEAM_ID` is wrong.

---

## Stage 6 — Trust it

The things no test can establish, because they need real hardware and real time.
Run through [SETUP_CHECKLIST.md § Phase 5](SETUP_CHECKLIST.md) — in particular:

- A full day, compared against what you actually did.
- The app force-quit mid-walk; it should relaunch in the background and the walk
  should be intact.
- A long stretch indoors: one stay or an honest gap, never a walk around the
  building.
- Midnight crossed mid-journey: one whole segment, filed under the day it started.
- Battery after a full day. If it is more than you want, drop to Battery saver and
  compare.

**Done when:** you would believe the timeline over your own memory.

---

## Not in this rollout

Deliberately deferred, each with its reasoning in
[ARCHITECTURE.md § 14–15](ARCHITECTURE.md):

- **Export** — GPX per activity and a JSON dump, on demand, never automatic.
- **Apple Watch** — standalone recording with deferred sync. Needs a native Swift
  target, since React Native cannot build for watchOS, and **Series 2 or later**
  for built-in GPS. The design already accommodates it: a watch is just another
  producer of fixes, and the integration surface is one function.
- **Core Motion activity classification** — a custom native module wrapping
  `CMMotionActivityManager`, which has no Expo binding.
- **App Store submission** — not needed for personal use. If it ever happens, the
  two things to prepare are a background-location justification in the review
  notes and a "Data Not Collected" privacy label you can defend.
  [DEPLOYMENT.md § 4](DEPLOYMENT.md) covers both.
