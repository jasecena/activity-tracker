# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Project conventions

**iPhone only.** `platforms: ['ios']`. Do not add Android or web targets.

**`src/core` is pure TypeScript.** No React, React Native, Expo or `src/services`
imports — ESLint enforces this. The `core` Jest project compiles it with nothing
but `@babel/preset-typescript`, so any new dependency there breaks the suite.
That is intentional: it is how a location app is testable on a Linux runner that
is not, and never will be, moving. Every core domain (`geo`, `segments`, `day`,
`format`, `places`, `energy`, `replay`, `media`, `power`) has its own coverage gate. `core` also reads no
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

**Run `npm run verify` before finishing.** Typecheck, lint, format check and 372
tests, in well under a minute. Watch the test _time_ as well as the result: a
byte-for-byte `toEqual` over a megabyte-scale `Uint8Array` costs tens of seconds
in Jest's structural equality, and a loop with an early exit costs milliseconds.

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

**One fix stream, always, and there is no Record button.** Tracking is on or it
is off; everything that happens while it is on is recorded. There is nothing to
start and nothing to stop.

This revises the decision that used to stand here — that manual recording was a
lens over the stream rather than a second source. The lens was right; the button
was a lie about it. It said "Record" over an app already recording, and asked
you to declare a journey before it had happened. The cost was not cosmetic: a
window with one end open could outlive its day, claim time that had not arrived,
and print a row on a timeline it had nothing to do with — which is exactly what
was reported from a real phone.

**Naming a journey is retrospective.** Tap a journey the app already recorded
and say what it was, the same way you name a stay. A `JourneyLabel` is made
_from_ a segment, so it has both ends and always has something behind it —
open-ended windows, phantom rows and the midnight rule they needed are not
fixed so much as unrepresentable. A label covering no segments emits nothing.

**Labels are stored as time ranges, not segment ids.** A different tracking
preset folds the same fixes into different journeys, so an id would be orphaned
by a settings change; a range is re-cut against whatever the day looks like now.

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

**Below 20% the app coarsens itself, and it is a lens rather than a setting.**
`core/power` decides; `effectivePreset` derives what runs from what you chose.
`settings.preset` is never overwritten, so a charged phone returns to full
detail on its own. It only ever coarsens, never refines. The 20/25% hysteresis
is not a detail: dropping and restoring at one percentage restarts Core Location
on every flicker, and restarting costs more than the coarse preset saves.
Charging suppresses it; a missing reading is not a low reading.

**A phone that does not move produces no fixes, so the app asks every ten
minutes while it is open.** `useHeartbeat` — foreground only, and only while
tracking is on, because the switch being off means the app records nowhere you
are. It must request `Accuracy.High`: `Balanced` is ~100 m against a 60 m
`maxAccuracyM`, so every reading would be discarded as `inaccurate` and the
feature would appear to work while doing nothing.

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

Media is too big for that path, so `services/mediaStore.ts` seals it into its own
chunked container under the same key — a megabyte at a time, each chunk
independently authenticated, so a truncated file fails to open rather than
decrypting into noise. The plaintext the OS handed over is deleted once sealed,
and playback decrypts to the cache directory and cleans up after itself.

**The app makes exactly one kind of network request, and only when you ask.**
There is no analytics, no telemetry, no crash reporting and no geocoder — that is
still why a place has no name until you type one. The one exception is Apple Maps
imagery, behind `settings.mapsEnabled`, which is **off on a fresh install**. Your
track is never sent: it is an overlay drawn on the device. With it off, every map
is the offline canvas in `components/MapCanvas.tsx`, which is also the only file
that may import `expo-maps`. App Transport Security stays fully enforced.

**A capture stores where it was taken, in two places, from one reading.** On
the item and in the fix stream: the copy on the item is what the media screen
shows and survives the fixes being pruned or tracking having been off; the fix
in the stream puts you on the timeline at that moment. This revises the note
that used to stand here — that a capture stores only a time and derives where.
Deriving was right in principle and wrong in outcome: a phone that does not move
produces no fixes, so a photo taken sitting still had nowhere to be placed.

The reading is taken at the moment that _matters_, which the caller decides:
the shutter for a photo, the **start** for a video or a voice note. By the time
either finishes you may be somewhere else.

**Ask for a position through `services/position.ts`, never `currentFix`
directly.** A capture draws a pin straight off `item.at`, so this is the one
path that states a position where the fold never gets to reject it. Core
Location's worst failure here is not a vague reading but a **confident and
wrong** one: positioned from a Wi-Fi network whose database entry was recorded
in another city, reported at 25 m accuracy. No property of the reading gives it
away — only the step from the last fix on record does, which is `judgeFix`'s
`teleport` rule, reused so a photo's pin and the timeline can never disagree
about which readings are real. `currentFix` still refuses a stale or
kilometre-wide reading on its own; `askPosition` is what adds the step. Null is
the honest answer and every caller already handles it.

The same jump becomes believable once enough time has passed to cover it, which
is what keeps a flight from being permanently unrepresentable.

**A capture is two files, and everything that walks the directory must know
it.** `sweepOrphans` deletes sealed files the index has never heard of, and
being told only about the captures meant it deleted every thumbnail on the
following launch — invisibly, since the gallery just drew nothing. Build the
list with `filesOf`. Captures stored before thumbnails existed are given one on
the next launch, after the index settles, one at a time.

The tracking switch governs what the app records **on its own**. Pressing the
shutter is not the app acting on its own.

**The player stops at a hole; it never slides across one.** `positionAt` returns
null wherever the fixes stopped and the screen says "No signal". An icon gliding
smoothly through two hours indoors is the four-kilometre walk through a building
that the segmenter already refuses to draw.

**The background task appends fixes and does nothing else.** It has seconds to
live and can be killed at any point. Everything else the app knows how to do can
be redone later from those fixes; nothing can recover a fix that was never
written because the handler was busy segmenting the last one.

**Native modules live behind `src/services`.** `location.ts`, `vault.ts`,
`storage.ts` and `motion.ts` are the only files importing an Expo native module.
Feature code builds values and hands them over.

**No navigation library.** Four tabs — Day, Capture, Media, Settings — and one
level of detail below each. Capture and Media take the two middle slots: one is
the only tab that is an action rather than a view, the other the only one you
open to _look_ at something rather than read it.

**One screen shows a day, and it defaults to today.** "Today", "History" and
"Replay" were all _look at a day_, differing only in which one and whether it
moved — three renderers of one thing, a Today that could not show yesterday and
a History that could not show today. The day is a parameter now; arrows walk
backwards and the full list is a page under it.

**Back is a swipe as well as a button.** `shell/SwipeBackPage.tsx` is a
`PanResponder` and one `Animated.Value`, edge-initiated so it can never fight
the horizontal scrollers inside a page. Its two decisions are exported and
tested directly: a `PanResponder` cannot be driven faithfully by synthetic
events, so testing the gesture through the renderer proves nothing. Places is a page under
Settings, not a tab: iOS collapses a sixth tab into a "More" list.
`shell/usePageStack.ts` is an array and three functions, against a router that
would bring a native screen container, a navigation state tree and a
serialisation format. Every tab stays mounted with the inactive ones hidden, and
a detail page renders _over_ its tab rather than replacing it — not an
optimisation, but so that switching tabs or opening a day cannot throw away a
running recording or a timeline that was just derived. This reasoning survives a
fifth tab and one level of depth; it would not survive a fifth level, deep links
or modal routes.

Two screens are deliberate exceptions, both because they hold something a hidden
tab must not. `CaptureScreen` mounts `CameraView` only while Capture is visible:
a session running behind three hidden screens costs battery and leaves the
recording indicator lit. `MediaGalleryScreen` opens a capture only while Media is
visible, so a video cannot play out of sight and no decrypted file sits in the
cache for a tab nobody is looking at.

**The gallery holds thumbnails, and exactly one capture.** Both lists are
windowed and only the centre page is decrypted; the pages either side draw the
sealed thumbnail written beside the original. A gallery that decrypted what it
rendered would hold several videos in memory to show you one.

**Naming a place asks rather than guesses.** `matchPlace` returns one place
because a timeline row needs one label, but `rankPlaceCandidates` returns all of
them with distances, and the picker offers the list whenever more than one named
place covers a stay. Confirming a stay that fell _outside_ a place widens that
place (`widenToInclude`) rather than creating a second one with the same name —
two identical rows with the totals split between them is the outcome nobody
wants and everybody gets.

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

**A precompiled Expo module can fail to link at launch, and the smoke test is
the only thing that will tell you.** `expo-image-manipulator@57.0.8` ships an
xcframework built against a newer `ExpoModulesCore` than `expo@57.0.9` provides,
so the app aborted in dyld before any JavaScript ran — `Symbol not found:
BaseModule.willDestroy`. Jest cannot see this; every module is mocked. The fix
is `expo.autolinking.buildFromSource` in `package.json`, which compiles that one
module against the core actually present. Making the JS import lazy does _not_
help: the framework is linked because it is in the bundle, not because something
imported it.

**Expo Go no longer runs this app.** `expo-camera`, `expo-audio`, `expo-video`
and `expo-maps` are native modules, so development needs a dev client build.

Architecture rationale: `docs/ARCHITECTURE.md`. Release pipeline:
`docs/DEPLOYMENT.md`. First-time setup: `docs/SETUP_CHECKLIST.md`.
