# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Project conventions

**iPhone only.** `platforms: ['ios']`. Do not add Android or web targets.

**`src/core` is pure TypeScript.** No React, React Native, Expo or `src/services`
imports — ESLint enforces this. The `core` Jest project compiles it with nothing
but `@babel/preset-typescript`, so any new dependency there breaks the suite.
That is intentional: it is how a location app is testable on a Linux runner that
is not, and never will be, moving. Every core domain (`geo`, `segments`, `day`,
`format`, `places`, `energy`) has its own coverage gate. `core` also reads no
clock, no timezone and no entropy source: ids are derived from the data, "what
time is it" is a parameter, and so is the UTC offset.

**The engine is a fold, and the timeline is never stored.** Segments are
re-derived from the raw fix buffer every time they are needed. That is what
makes recomputation the recovery story — there is no persisted machine state to
migrate, version or find half-written. Anything that would require storing
derived state is the wrong shape.

**Segment ids are derived from `startedAt`.** Re-deriving a day produces
byte-identical segments with identical ids, so folding the same buffer twice
merges over the same rows rather than duplicating them. Never generate an id.

**Never trust a fix.** Everything from Core Location goes through `judgeFix`
first. The three rejections that are not hypothetical — a 3 km accuracy circle
indoors, a replayed fix older than the last one, and a cold-start position from
40 km away stamped `now` — are each capable of inventing a journey that never
happened. A rejected fix must never become the reference for the next one.

**Run `npm run verify` before finishing.** Typecheck, lint, format check and 230
tests, in well under a minute.

**Refs may not be read during render.** `react-hooks/refs` is an error, not a
warning. A value the render depends on goes in `useState`.

**Never commit credentials, and never commit real coordinates.** `.gitignore`
blocks the credential patterns and gitleaks scans history in CI. There is also a
gitleaks rule for plausible latitudes: a fixture built from a real track is a
permanent record of where its author was, which is the same class of mistake as
a leaked key and rather harder to rotate. Fixtures live at the equator — see
`src/core/segments/__tests__/fixtures.ts`.

**React 19 notes.** `act` is asynchronous — await it and `fireEvent` in tests.
So are `render`, `renderHook` and `rerender` in this version of the testing
library; not awaiting one leaves the act scope open and the _next_ render in the
file silently never runs its effects.

# Settled decisions

These were worked out against the platform's limits and are not open to casual
revision. Changing one means changing the reasoning in `docs/ARCHITECTURE.md`
with it.

**One fix stream, always. Manual recording is a lens over it, not a second
source.** Pressing Record writes down an instant and a name; `applyManualWindows`
labels the automatic timeline on read. Two subscriptions would mean twice the
battery, two answers to "how far did I walk", and no principled way to choose
between them. It is also why you can stop a recording you forgot to start.

**Stays and moves alternate, and short ones are absorbed rather than emitted.**
Deciding "moving" from "still" on a single step is noisy, so the machine lets the
flip happen and then checks, at close, whether the segment earned its place. If
it did not, it is merged into the segment before it — keeping its time and its
metres, so the day's totals stay honest even though the row disappears. This is
why the machine holds one closed-but-unemitted segment (`pending`).

**The timeline is contiguous: a segment ends exactly where the next begins.** The
fix at a transition belongs to both. Without that, every change of activity
leaves a hole a few seconds wide and a day of errands loses minutes nobody can
account for.

**A gap is a hole, never a straight line.** No fix for `gapMs` closes whatever is
open and the timeline simply stops until the next one. Interpolating across two
hours indoors turns a building into a four-kilometre walk through it.

**Distance is apportioned when a segment is split, never recomputed.**
Recomputing each half from its own thinned path loses whatever the thinning
dropped, so the halves sum to less than the original — and a day's total that
shrinks every time you label part of it is a genuinely confusing thing for an app
to do.

**Speed is always derived from consecutive positions, never the platform's
estimate.** Core Location's Doppler speed reads 8 m/s for several seconds after
you stop. Deriving it means a speed and the distance printed beside it can never
contradict each other.

**Calories count movement only.** Including rest would add fifteen hundred
kilocalories to every day, most of them for being asleep, and drown the walk the
number is about. This is active energy, like a watch's move ring.

**`pausesUpdatesAutomatically` stays false.** iOS offers to stop location updates
when it decides you have stopped moving, which sounds exactly like the battery
saving this app wants — but it does not reliably resume, and the failure is
silent and total. The distance filter already means no wake-ups while you sit
still. A day missing from a diary is worse than a percent of battery.

**Nothing is stored in plaintext, and the key never leaves the device.**
`services/vault.ts` seals every value with XChaCha20-Poly1305 under a 32-byte key
in the keychain, marked `THIS_DEVICE_ONLY` so it enters no backup. It is
`AFTER_FIRST_UNLOCK`, not `WHEN_UNLOCKED`, because background location arrives
while the phone is locked in a pocket and a key unreadable then would leave a
hole in every day. "Erase everything" destroys the key.

**The app makes no network requests, of any kind.** There is no analytics, no
telemetry, no crash reporting, no geocoder and no map tile server. That is why a
place has no name until you type one, and why routes are drawn as a sparkline
rather than on a map. App Transport Security stays fully enforced because there
is nothing for it to permit.

**The background task appends fixes and does nothing else.** It has seconds to
live and can be killed at any point. Everything else the app knows how to do can
be redone later from those fixes; nothing can recover a fix that was never
written because the handler was busy segmenting the last one.

**Native modules live behind `src/services`.** `location.ts`, `vault.ts`,
`storage.ts` and `motion.ts` are the only files importing an Expo native module.
Feature code builds values and hands them over.

**No navigation library.** Three tabs need no router. Every screen stays mounted
with the inactive ones hidden — not an optimisation, but so that switching tabs
cannot throw away a running recording.

**The Jest suite is pinned to UTC** in `jest.config.js`, before the workers fork.
A "day" is a wall-clock concept, so without it `jest.setSystemTime` means a
different date depending on where the machine is.

# Known limits

**Core Motion's activity classifier is not available.**
`CMMotionActivityManager` — the thing that reports "walking"/"automotive" with a
confidence — has no Expo binding and needs a custom native module. Mode is
inferred from speed alone, which is why a slow cycle and a fast walk are hard to
tell apart. `services/motion.ts` uses the pedometer, which is reachable.

**Export is not built yet.** GPX per activity and a JSON dump are planned, on
demand and never automatic. `services/dayLog.ts` stores a plain array of
`Segment` precisely so that stays straightforward.

Architecture rationale: `docs/ARCHITECTURE.md`. Release pipeline:
`docs/DEPLOYMENT.md`. First-time setup: `docs/SETUP_CHECKLIST.md`.
