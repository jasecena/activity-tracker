# Activity Tracker

An iPhone app that records where you went during the day, on the phone and
nowhere else.

Leave it running and it keeps a diary: two hours at a restaurant, a walk to the
shops, a drive to the beach — each with the distance, the duration, the speed and
the shape of the route. Press Record when you want a stretch named. Nothing is
uploaded, because there is nothing to upload to: the app makes no network
requests of any kind.

```
Today
────────────────────────────────────────────
07:12  ●  Home                        2h 40m
09:52  ▸  Walk        1.42 km  18m  4.7 km/h
10:10  ●  abc restaurant              2h 04m
12:18  ▸  Walk to Coles  0.84 km  11m   REC
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
than guessing. Press Record to name a journey; that does not start a second GPS
subscription, it labels the stream that is already there.

**Counts what it can honestly count.** Distance, moving time, average and top
speed per segment, per-point speed along a route, and an active-calorie estimate
from a MET model. Rest is not counted as calories; unrecorded hours are not
counted as time spent standing still.

**Keeps everything encrypted, on one device.** Every stored byte is sealed with
XChaCha20-Poly1305 under a key generated on first launch, held in the iOS
keychain and marked so it never enters an iCloud or iTunes backup. "Erase
everything" destroys that key.

## What it does not do

- **No map.** Routes are drawn as a shape, not on tiles. A map means a request
  per route carrying your coordinates to somebody else's server.
- **No geocoding.** A place has no name until you type one. There is nothing to
  ask.
- **No accounts, no sync, no analytics, no crash reporting.** App Transport
  Security stays fully enforced because there is nothing for it to permit.
- **No Core Motion activity classification** — yet. See _Known limits_.

## Getting started

Requires Node 20.19+ and an Apple Developer account to run on a real device.
Background location does not work in the simulator in any useful way.

```bash
npm install
cp .env.example .env      # then set IOS_BUNDLE_IDENTIFIER to something you own
npm run ios
```

`npm run verify` runs the whole check suite — typecheck, lint, format and 230
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
src/services/    the only files that touch a native module or ask the time
src/features/    screens and their hooks — today, history, places, record, settings
src/components/  shared UI
src/shell/       four tabs and a minimal page stack, no router
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

## Privacy

The threat this design addresses is not someone holding your unlocked phone —
against that, nothing an app does helps. It is the ordinary ways a file leaks: a
backup, a device handed on, a forensic extraction, a bug in some other app.

- Every stored value is encrypted with XChaCha20-Poly1305 (authenticated, so a
  tampered or truncated store fails to decrypt rather than parsing into
  something that looks like a day).
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
genuinely hard to tell apart, which is what the Record button is for. The
pedometer _is_ reachable and is used in `src/services/motion.ts`.

**A stay is only as accurate as indoor GPS.** Fixes taken inside are often 65 m
to 3 km wide and are rejected, so a long stay indoors can end up thinner than it
was. Settings shows how many fixes were dropped and why — "two thirds were too
vague to use" is the difference between a broken app and a day spent inside.

**Export is not built yet.** GPX per activity and a JSON dump are planned, on
demand and never automatic.

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
