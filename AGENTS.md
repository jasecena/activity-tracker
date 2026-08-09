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

**Run `npm run verify` before finishing.** Typecheck, lint, format check and 583
tests, in well under a minute. Watch the test _time_ as well as the result: a
byte-for-byte `toEqual` over a megabyte-scale `Uint8Array` costs tens of seconds
in Jest's structural equality, and a loop with an early exit costs milliseconds.

**Refs may not be read during render.** `react-hooks/refs` is an error, not a
warning. A value the render depends on goes in `useState`.

**Fixtures at the origin hide multiplicative errors, so test the centre away
from it.** (0, 0) keeps distances checkable in your head and real places out of
the repository, but a coordinate scaled by the wrong factor is still exactly
zero. One shipped: `merge` counted the boundary fix once and summed it twice,
so a stay's centre came out as the true mean times (n + merges) / n — invisible
in every test and, on a phone in Victoria, a stay 800 km out in the Tasman Sea.
`ELSEWHERE` and `shifted` in the fixtures exist for assertions about _where_
something is, as opposed to how far apart two things are.

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

**Joining rows into one journey was built and removed.** Merge, then Unmerge to
undo it, and neither was the shape of the problem: a merge could only ever be a
span, so "these two but not the middle" was inexpressible, and undoing meant
finding the label behind a row by its id. Half a feature is worse than none. The
merges themselves are dropped on launch — a merge was a label with an empty
name, so anything nameless goes — because a build with no merge button would
otherwise apply every merge ever made and offer no way out of any of them.

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

**Media is the exception, and this revises what used to stand here.** Photos,
video and voice notes are stored as ordinary files under `Documents/media`.
They used to be sealed into a chunked container of their own under the same
key, and the reasoning was consistent — but iOS already encrypts the container
with a key derived from the passcode, so the second pass bought very little
against a stolen phone and cost every read: forty megabytes of pure-JavaScript
AEAD, on the one thread that also draws the screen, before anything could be
looked at. The gallery was unusable and the cause was entirely self-inflicted.

What that layer really protected was a **backup**: the key is
`THIS_DEVICE_ONLY`, so a restored backup held ciphertext. That is what has been
given up, knowingly. Encryption belongs at the boundary where data actually
leaves the phone — the sync that is coming — and the bytes get sealed on the
way out rather than on the way in.

`unsealInPlace` migrates a library written by an older build, once, on launch.
Do not delete it without a very good reason: a build that cannot read a sealed
file silently loses every photo its owner took.

**It writes the plain file and leaves the sealed one.** Deleting the original
there opens a window one suspension wide: the plain file exists, the index still
names the sealed one, and the next launch sweeps the plain file as an orphan.
The photo is gone, silently, on a phone that did nothing wrong. Write the new,
let the index move, let the next sweep take the old — it is an orphan by then by
definition, and the cost of dying anywhere in between is a duplicate on disk
rather than a capture.

**A sealed thumbnail counts as missing**, not as a thumbnail. It is ciphertext,
and an `<Image>` handed ciphertext draws nothing — so treating a non-null
`thumbFileName` as good enough left every old capture as a blank square in the
filmstrip, with an index that looked perfectly healthy.

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

**What a recording started with lives in a ref, not in state, and this is why.**
`recordAsync` resolves only when recording _stops_, so the call that hands the
clip to the store is running inside the closure that started it — created
before the position ever arrived. As state, the reading was `null` when the
closure captured it and `null` for ever after, so every video was stored with
no position at all: asked for, received, and dropped one render away. Nothing
errored; a pin simply never appeared. Nothing renders these values, which is
what the refs rule actually cares about.

**A capture records which way the phone was held, and nothing is ever rotated
on disk.** `responsiveOrientationWhenOrientationLocked` on `CameraView` reports
the device's orientation while the interface stays locked to portrait — the
signal iOS already computes for the status bar, needing no permission and no
`expo-sensors`, which was removed and is not worth bringing back for one value.
The orientation goes on the `MediaItem`; `core/media/orientation.ts` turns it
into an angle, and the gallery applies that angle to the _view_ at the moment
it draws. A rotation is a property of looking, the same way the timeline is
derived rather than stored: a file rewritten on the way in is a file that can
be turned twice, and there is no way back from it.

The same angle turns the capture controls, and the same fact moves them: the
mode rail takes whichever edge is uppermost and zoom takes the other, because
turning the glyphs alone leaves the rail along the bottom half the time.

**Which landscape is which is a coin toss until a phone settles it.** iOS has
meant opposite things by "landscape left" — `UIDeviceOrientation` names it for
where the home button went, `AVCaptureVideoOrientation` for where the top of
the frame points — and the prop's documentation names neither. `UPRIGHT` in
`core/media/orientation.ts` is one table and swapping its two landscape rows
fixes the photographs and the rails together. The tests assert only what holds
either way: that the two are opposite quarter turns.

**The camera turns the pixels itself, so the display turns nothing.** That was
the other half of the same unknown, and a phone settled it:
`CAMERA_WRITES_UPRIGHT_PIXELS` is `true`. The photograph came out **ninety**
degrees off rather than a hundred and eighty, which is the whole diagnosis —
half a turn would have meant the landscape rows were the wrong way round, a
quarter meant the rotation had been applied to a file that was already upright.
The orientation is still recorded and the controls still turn, because the
screen is locked whatever the file does.

**A wrapper on the media stage must not take layout space.** Everything drawn
there positions itself with `absoluteFill`, so a plain sized `View` around the
picture stops being an overlay and becomes a flex child: the thumbnail beneath
the capture became a band across the top with the photograph pushed below it.
`Turned` returns its children untouched when there is no angle, and overlays
rather than wraps when there is.

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

**The screen is held awake while a capture is in progress, sealing included.**
Nothing about a camera preview counts as user activity, so a recording made
without touching the screen looks to the auto-lock timer exactly like a phone
left alone — reported from a phone as a clip cut off half a minute in. The lock
covers sealing as well, and is keyed on "busy" rather than on the state itself:
dropping it between recording and saving would release it precisely where the
phone would lock, and the saving overlay asks you to keep the app open while
the app is letting the phone shut itself.

**A live capture is five seconds forwards, and forwards is the only direction
available.** Apple's Live Photo keeps a moment either side of the shutter;
`expo-camera` has no rolling buffer and no pre-shutter capture, so frames from
before the press were never handed over and cannot be fetched back — that half
needs a native module (`AVCapturePhotoOutput.livePhotoCaptureEnabled`) and is
not built. What is built is the half that needs nothing: `maxDuration` records
five seconds from the press and ends itself, so there is no Stop to forget.

On disk it is a clip and a still, which is what a video already was, so nothing
that walks the media directory has to learn a third file. `keyframeMs` says
which instant of the clip is the picture — zero at the shutter, stored rather
than assumed so it can be moved later, which the capture's own page now does:
the still is written again from the frame at that instant and the clip is never
re-encoded, so choosing again is reversible for ever. The position and orientation are read at the press, not
at the end: the seconds afterwards are what the picture was surrounded by, not
where it was taken.

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
`storage.ts`, `battery.ts` and `mediaStore.ts` are the only files importing an
Expo native module.
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

**The gallery and the camera are both full-bleed, and neither has a header.**
A header and a subtitle cost about a fifth of the screen on a phone, and both
tabs exist to look at a picture. Controls float over it: the counter and the ⋯
at the top, the filmstrip along the bottom, the mode rail and the zoom down the
two edges. Only the empty gallery keeps a heading, because there is nothing
behind it to look at.

**Zoom is a drag, and the number is a percentage of the range.** `CameraView`'s
`zoom` is 0 to 1 across whatever the lens offers, not a magnification, and there
is no way to ask what "2×" would be — so calling it 2× would be a guess printed
as a fact. The dial says what can honestly be said.

This revises the decision that used to stand here — that zoom was two buttons
because a gesture would fight the swipe between pages. Half of that reasoning
still holds: there is no pinch, because `expo-camera` has no gesture of its own
and a multi-touch responder plus a hand-rolled scale is a great deal of machinery.
But a _single_ finger sliding along the glass fights nothing. Capture has no
scroller, no pager and no detail page to swipe back from, so the viewfinder is
the one surface in this app with no other claim on a drag.

The buttons stay, because a gesture is not reachable by everyone and they are
what a screen reader can find.

**Which way is "up" comes from the phone, not the screen.** `dragUpBy` maps a
drag onto the axis the hand means: turn the phone sideways and the same movement
is a change in x, in one direction or the other. A zoom wired to `-dy` reverses
itself on rotation. It reads the same fact as the rails and a capture's stored
orientation — whichever edge is uppermost is where up is.

**A lens is chosen by name, never by magnification, and a recording keeps the
one it started on.** `expo-camera` reports the physical cameras as Apple's own
device-type strings and takes one back as `selectedLens`. Those say what a lens
_is_, not what it multiplies by — the telephoto is 2×, 3× or 5× depending on
the model and nothing in the API says which — so `core/media/lenses.ts`
translates and orders them and never prints a number. Unset is a real value: the
system's virtual camera switches between the real lenses as you zoom, and
overriding that before anyone has asked is choosing worse than the phone would.

The rail is locked while anything is recording. Changing the lens rebuilds the
capture session underneath, and the documented behaviour for the same rebuild —
flipping the camera — is that it _stops_ the recording. So whatever a clip
starts on it finishes on, while a photograph can be taken on any of them.

**The zoom is measured from the start of each gesture, never accumulated.**
Adding deltas per movement drifts, and it means letting go and repeating the
same movement from the same place gives a different answer the second time.

**Capture is a viewfinder, not a page.** The preview fills the screen and the
shutter sits at the bottom under a thumb; there is no header and no list. The
recent-captures list that used to live here is gone rather than moved — Media is
a whole tab now, and the same twelve rows in two places is two things to keep in
step and one of them always slightly wrong. It is the only tab with no detail
page above it.

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
tell apart.

There was a `services/motion.ts` wrapping the pedometer, which _is_ reachable,
against the day something used it to confirm that a stretch called a walk had
steps under it. Nothing ever did. It has gone, and `expo-sensors` with it: an
unused native module still links into the binary and still carries a permission
the app has no reason to want. Bring both back when there is a caller, not
before.

**Pruned fixes are archived, not dropped, and the archive is a key per day.**
Freezing a day removes its raw readings from the buffer — the fold never needs
them again, because the day's segments are its record. They used to be deleted,
which is why exporting "all raw fixes" produced a file containing today and
nothing else.

`pruneBuffer` writes them under `fix-archive/<YYYY-MM-DD>`, one key for the day
that just ended. **Never one blob**: a single entry means every freeze reads the
whole archive, sorts it and writes it back, sealed as hex — 337 KB on day one
and 120 MB a year later, on the thread that draws the screen. That is the same
shape as the failure that made the media gallery unusable, and it degrades
silently over months rather than failing where anyone would see it.

The date in the key is load-bearing: `YYYY-MM-DD` compares as a string exactly
as it compares as a day, so `trimArchive` deletes whole days by name and reads
only the one the cutoff lands inside. It runs on the same cutoff as the log, so
an archive can never outlive the days it describes. `eraseEverything` enumerates
by prefix rather than by a list of names, or it would leave a year of days
behind.

Nothing reads the archive to build a timeline; adding a caller that does would
undo the reason freezing exists.

**GPX export is not built yet.** Per activity, on demand and never automatic.
`services/dayLog.ts` stores a plain array of `Segment` precisely so that stays
straightforward.

**Keep the Expo patch versions in step, and check the audit is still readable.**
`npm run verify` does not run either: `npx expo-doctor` and `npx audit-ci
--config audit-ci.jsonc` are CI's job, and both were red on every push for days
— doctor over six patch releases that had moved upstream, the audit over two
advisories with no fixed version published anywhere. A check that cannot pass
is one nobody reads. `audit-ci` exists so an advisory can be _reviewed_ rather
than merely ignored; every entry in the allowlist names why, and a stale one
fails the build rather than passing quietly.

**A precompiled Expo module can fail to link at launch, and the smoke test is
the only thing that will tell you.** `expo-image-manipulator@57.0.8` shipped an
xcframework built against a newer `ExpoModulesCore` than `expo@57.0.9` provided,
so the app aborted in dyld before any JavaScript ran — `Symbol not found:
BaseModule.willDestroy`. Jest cannot see this; every module is mocked. The fix
is `expo.autolinking.buildFromSource` in `package.json`, which compiles that one
module against the core actually present. Making the JS import lazy does _not_
help: the framework is linked because it is in the bundle, not because something
imported it. It stays on now that the core is 57.0.11 and probably carries the
symbol: compiling one module from source costs CI minutes, and finding out the
hard way costs a release.

**Expo Go no longer runs this app.** `expo-camera`, `expo-audio`, `expo-video`
and `expo-maps` are native modules, so development needs a dev client build.

Architecture rationale: `docs/ARCHITECTURE.md`. Release pipeline:
`docs/DEPLOYMENT.md`. First-time setup: `docs/SETUP_CHECKLIST.md`.
