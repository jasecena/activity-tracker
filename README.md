# Activity Tracker

An iPhone app that records where you went during the day, on the phone and
nowhere else.

Leave it running and it keeps a diary: two hours at a restaurant, a walk to the
shops, a drive to the beach — each with the distance, the duration, the speed and
the shape of the route. Name a journey afterwards if it deserves one, play a day
back to watch it happen, and attach a photo, a clip or a voice note to the moment
it belongs to. Nothing you record is uploaded, because there is nothing to upload
to.

```
Today
────────────────────────────────────────────
07:12  ●  Home                        2h 40m
09:52  ▸  Walk        1.42 km  18m  4.7 km/h
10:10  ●  abc restaurant              2h 04m
12:18  ▸  Walk to Coles  0.84 km  11m     🏷
12:29  ●  Coles                          24m
12:53  ▸  Drive      11.2 km  24m  46 km/h
13:17  ●  xyz beach                   1h 40m
```

## What it does

**Records your day without being asked.** Background location runs all day and
the engine splits the raw fix stream into places you stayed and journeys you
made, classifying each journey as a walk, run, ride or drive from its speed. You
open the app to see what already happened.

**Lets you name the parts that matter.** Tap a stay to name the place — every
future stay within about 120 m is then recognised as the same place. When more
than one named place covers a spot, or when a stay lands just outside one, the
app shows you the candidates with distances and visit counts and asks, rather
than guessing. A journey is named the same way, after it happened: tap it and
say what it was. There is no Record button — the app is already recording, and
asking you to declare a journey before it has happened only invites naming one
that never took place.

**Counts what it can honestly count.** Distance, moving time, average and top
speed per segment, per-point speed along a route, and an active-calorie estimate
from a MET model. Rest is not counted as calories; unrecorded hours are not
counted as time spent standing still.

**Plays a day back.** Pick a day, press play, and watch the icon travel the route
at up to 1200×. Where the fixes stopped, so does the icon — the player says "No
signal" rather than sliding smoothly through two hours it knows nothing about.

**Captures the moment, and where you were standing in it.** A photo, a video from
either camera, or a voice note takes one position reading and writes it both onto
the capture and into the day's fix stream — one reading, so the pin on the photo
and the route drawn under it can never disagree. The reading is taken when it
matters: the shutter for a photo, the _start_ for a clip or a voice note, because
by the time either finishes you may be somewhere else. A reading the engine does
not believe is refused, and a capture with no position honestly has none.

**Has a camera with real numbers on it.** Three zoom stops — 0.5×, 1× and 3× —
sitting exactly where the lenses hand over, with the millimetres derived from each
lens's measured field of view rather than looked up. The controls turn with the
phone while the interface stays upright, and nothing is ever rotated on disk: a
rotation is a property of looking, applied when the picture is drawn.

**Keeps the captures in one place.** Media is a whole tab: swipe sideways through
every capture, swipe up for what the app knows about one — the fields, the map
with it pinned to the spot, Forget — and swipe down for every day's captures as a
grid. Tapping a thumbnail on the timeline lands you on that capture.

**Shows a route on a map, if you want one.** Off by default. The offline canvas
draws the route, the stops, a scale bar and north from your own coordinates and
nothing else; one switch in Settings swaps in Apple Maps underneath, and says
plainly what that costs.

**Keeps everything encrypted, on one device.** Days, places, labels, settings and
the media index are sealed with XChaCha20-Poly1305 under a key generated on first
launch, held in the iOS keychain and marked so it never enters an iCloud or iTunes
backup. "Erase everything" destroys that key.

Photos, video and voice notes are the deliberate exception: they are ordinary
files in the app's own container, which iOS already encrypts under the passcode.
A second pass in JavaScript bought very little against a stolen phone and cost
forty megabytes of pure-TypeScript AEAD on the thread that draws the screen, which
made the gallery unusable. What it did buy — a restored backup holding ciphertext
— is bought back a cheaper way: the media directory is flagged
`NSURLIsExcludedFromBackupKey`, so those files are never copied into a backup in
the first place. The cost is that a lost phone takes them with it, which is what
the S3 sync in [`docs/BACKLOG.md`](docs/BACKLOG.md) is for. See
[`SECURITY.md`](SECURITY.md) for what that changes.

## What it does not do

- **No map imagery unless you turn it on.** A fresh install draws routes from
  your own coordinates and asks nobody. With the switch on, Apple sees which part
  of the map you are looking at — never your track, which is drawn on the phone.
  It is the only network request in the app.
- **No geocoding.** A place has no name until you type one. There is nothing to
  ask.
- **Nothing in the camera roll, and nothing in a backup.** Captures stay in this
  app's own storage rather than syncing to iCloud Photos, and the directory they
  live in is flagged so backups skip it.
- **No accounts, no sync, no analytics, no crash reporting.** App Transport
  Security stays fully enforced.
- **No Core Motion activity classification** — yet. See _Known limits_.

## Getting started

Requires Node 20.19+ and an Apple Developer account to run on a real device.
Background location does not work in the simulator in any useful way.

```bash
npm install
cp .env.example .env      # then set IOS_BUNDLE_IDENTIFIER to something you own
npm run ios
```

`npm run verify` runs the whole check suite — typecheck, lint, format and 575
tests — in well under a minute, entirely on Linux.

Full first-time setup, including the Apple side: [`docs/SETUP_CHECKLIST.md`](docs/SETUP_CHECKLIST.md).

## How it is put together

```
src/core/        pure TypeScript. No React, no Expo, no clock, no I/O.
  geo/           distance, bearing, and deciding whether a fix is worth believing
  segments/      the segmenter: fixes in, a timeline of stays and moves out
  day/           local days, summaries, and freezing finished ones
  places/        matching a stay to a place you named
  energy/        calories, from a MET model
  format/        every string the UI shows for a number
  replay/        where the day was at an instant, and where it has no idea
  media/         captures on the timeline, plus lens optics and orientation
  power/         what a low battery coarsens, and what it never touches
  export/        the CSV bytes, asserted in a test rather than eyeballed
src/services/    the only files that touch a native module or ask the time
src/features/    screens and their hooks — activities, replay, capture, media,
                 places, labels, history, data, settings
src/components/  shared UI, including the map and its offline canvas
src/shell/       four tabs and a minimal page stack, no router
modules/         local native modules: camera-optics, one Swift file
```

The whole engine is a fold — `(state, fix) => state` — with no clock, no entropy
and no I/O. Two things follow, and most of the design follows from them:

**The timeline is never stored.** It is re-derived from the raw fix buffer
whenever it is needed. There is no persisted machine state to migrate, version,
or find half-written after a crash; recomputing _is_ the recovery story.

**Re-deriving is byte-identical, ids included.** Segment ids come from the
segment's start instant, so folding the same buffer twice merges over the same
rows rather than duplicating them.

Both are asserted as properties over generated fix streams in
[`src/core/segments/__tests__/properties.test.ts`](src/core/segments/__tests__/properties.test.ts).

Why each decision was made: [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md).

## Battery

The two things that cost power on iOS are the accuracy class and how often the
app is woken. This app sets a **distance filter**, not a timer — Core Location
does the comparison in hardware, so standing still costs nothing and the app is
never woken at all.

| Preset                 | Accuracy             | Point every |
| ---------------------- | -------------------- | ----------- |
| Battery saver          | ~100 m (Wi-Fi class) | 100 m       |
| **Balanced** (default) | ~10 m                | 25 m        |
| Detailed               | ~10 m                | 10 m        |

`pausesUpdatesAutomatically` is deliberately **off**. iOS offers to stop updates
when it decides you have stopped moving, but it does not reliably resume, and the
failure is silent and total — the app looks like it is tracking and records
nothing. A day missing from a diary is worse than a percent of battery.

**Below 20% the app coarsens itself**, and it is a lens rather than a setting: the
preset you chose is never overwritten, so a charged phone returns to full detail
on its own. It only ever coarsens, never refines, and it restores at 25% rather
than 20% — dropping and restoring at one figure would restart Core Location on
every flicker, which costs more than the coarse preset saves. Charging suppresses
it entirely, and a missing reading is not a low reading.

## Privacy

The threat this design addresses is not someone holding your unlocked phone —
against that, nothing an app does helps. It is the ordinary ways a file leaks: a
backup, a device handed on, a forensic extraction, a bug in some other app.

- Every stored _value_ — days, places, labels, settings, the media index — is
  encrypted with XChaCha20-Poly1305 (authenticated, so a tampered or truncated
  store fails to decrypt rather than parsing into something that looks like a
  day). Media files are the exception and rely on the iOS container encryption
  instead; the trade is written out in [`SECURITY.md`](SECURITY.md).
- The key is 32 bytes from the system CSPRNG, held in the keychain as
  `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. `THIS_DEVICE_ONLY` keeps it out of every
  backup; `AFTER_FIRST_UNLOCK` rather than `WHEN_UNLOCKED` because background
  location arrives while the phone is locked, and a key unreadable then would
  leave a hole in every day.
- Test fixtures are synthetic, and a gitleaks rule fails the build on anything
  that looks like a real latitude. A committed track is a permanent record of
  where its author was.

Reporting a vulnerability: [`SECURITY.md`](SECURITY.md).

## Known limits

**Mode is inferred from speed alone.** `CMMotionActivityManager`, the Core Motion
classifier that reports walking/running/automotive with a confidence, has no Expo
binding — it needs a custom native module. A slow cycle and a fast walk are
genuinely hard to tell apart, which is why you can correct the mode by hand: hold
a journey and pick what it really was. The barrier is procedural rather than
structural now — `modules/camera-optics` establishes the local-native-module
pattern — but nothing has needed it enough to write it.

**A stay is only as accurate as indoor GPS.** Fixes taken inside are often 65 m
to 3 km wide and are rejected, so a long stay indoors can end up thinner than it
was. Settings shows how many fixes were dropped and why — "two thirds were too
vague to use" is the difference between a broken app and a day spent inside.

**Export is CSV, and GPX is not built yet.** Settings will hand you three files —
raw fixes, every route point kept, and the timeline itself — through the share
sheet, on demand and never automatically. GPX per activity is still to come;
`services/dayLog.ts` stores a plain array of `Segment` precisely so that stays
straightforward.

**No watch app yet.** Planned: record on the wrist without the phone, sync when
they are back together. The design already accommodates it — the watch would be
another producer of fixes and the integration surface is one function — but it
needs a native Swift target, because React Native cannot build for watchOS.
Note the hardware floor: **Series 2 or later**, since that is where built-in GPS
starts. The original 2015 Apple Watch (watchOS 4.3.2, models like MLCH2LL/A) has
no GPS receiver and takes its location from a tethered iPhone, so standalone
tracking on it is impossible regardless of software. See
[`docs/ARCHITECTURE.md` § 15](docs/ARCHITECTURE.md).

## Licence

MIT. See [`LICENSE`](LICENSE).
