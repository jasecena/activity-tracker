# Architecture

Why this app is shaped the way it is. Each section is a decision that was made
against a real constraint; if you change one, change the reasoning here with it.

---

## 1. The engine is a pure fold, and the timeline is never stored

`src/core/segments/machine.ts` is `(state, fix) => state`. It reads no clock,
draws no random number and performs no I/O. `src/core` as a whole imports nothing
from React, React Native, Expo or `src/services`, and ESLint makes that an error
rather than a convention.

The obvious reason is testability: an app about being in motion is otherwise
untestable on a CI runner that is bolted to a rack. 248 tests run in about three
seconds on Linux, including property tests over generated fix streams.

The less obvious reason is the persistence design. Because folding is
deterministic, **the derived timeline is not stored at all** — it is recomputed
from the raw fix buffer every time it is needed. A day is a few thousand fixes;
folding it is milliseconds. What that buys:

- No persisted machine state to version or migrate.
- No half-written segment after a crash. The fixes were written; everything else
  is a function of them.
- No "catch up" code path. A fix that arrived in the background while the app was
  closed for a week goes through exactly the same code as one from a second ago.

**Segment ids are derived from `startedAt`**, never generated. So re-deriving a
day produces byte-identical segments with identical ids, and merging them into
the permanent log updates rows rather than doubling them. This is what makes it
safe to fold the buffer twice, or on every launch, or after a crash midway.
Asserted in `properties.test.ts`.

### Consequence: `core` gets everything, `services` gets the rest

Anything that can be expressed as a function of data lives in `core` and is
tested to a coverage gate. Anything that needs the platform lives in `services`
and is deliberately thin. The freeze logic, for instance, is `core/day/freeze.ts`
— pure — and `services/dayLog.ts` is thirty lines of read, call, write.

---

## 2. Stays and moves alternate, and short ones are absorbed

The segmenter emits two kinds of thing: a **stay** (you were somewhere) and a
**move** (you went somewhere). Each fix is classified by the derived speed of the
step that reached it, against `stillSpeedMps` (0.5 m/s — slower than an amble,
faster than the jitter a stationary phone produces).

Classifying a single step is noisy. One 3 m wobble at a desk looks like a walk.
The naive fixes are both bad:

- Smoothing the input loses the sharp start of a real journey.
- Requiring N consecutive steps to agree delays every transition by N samples and
  needs a lookahead buffer.

Instead the machine lets the flip happen immediately and then, **when the segment
closes**, asks whether it earned its place: a stay must last `minStayMs`
(3 minutes — clears a red light); a move must cover `minMoveDistanceM` **and**
last `minMoveMs` (60 m and 45 s — both, not either). A segment that fails is
merged back into the one before it, keeping its time and its metres so the day's
totals stay correct even though the row disappears.

This is why the machine holds `pending`: one closed-but-unemitted segment, so the
merge target is still reachable when the verdict arrives.

### The timeline is contiguous

A segment ends at exactly the instant the next one starts, because the fix at a
transition belongs to both — it is the last of the old and the first of the new.
Without that, every change of activity leaves a hole a few seconds wide, and a
day of errands loses minutes nobody can account for. It also means
`movingMs + stillMs == spanMs` exactly, which is a property worth being able to
assert.

### A gap is a hole

No fix for `gapMs` (15 minutes) closes whatever is open, and the timeline stops
until the next fix. It is never bridged. Drawing a straight line across two hours
spent inside a building turns the building into a four-kilometre walk through it,
and the app has no idea what actually happened during it.

---

## 3. Every fix is untrusted

`geo/filter.ts` runs before anything else. Three of its five rejections are
things an iPhone genuinely does:

| Rejection      | What it is                                                                                                                                                                                                                     |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `inaccurate`   | Indoors, iOS falls back to Wi-Fi and cell positioning: 65 m to 3 km accuracy, consecutive readings hundreds of metres apart. Left in, sitting at a desk records a lunchtime run around the building.                           |
| `out-of-order` | On wake, iOS can deliver a batch including readings already seen, occasionally one older than the last. A negative time delta makes every derived speed negative or infinite.                                                  |
| `teleport`     | The first fix after a cold start is often where the phone was hours ago, stamped `now`. The step from it to reality crosses a city at 400 km/h. This is the single most common way a tracker lies to its owner about distance. |

**A rejected fix never becomes the reference for the next one.** Comparing
against a fix that was itself bad is how one glitch becomes a cascade — the
"correction" back from a 40 km teleport looks like a second teleport.

The counts are surfaced in Settings rather than swallowed. "Two thirds of today's
fixes were too vague to use" is the difference between a broken app and a day
spent indoors.

---

## 4. One fix stream. Manual recording is a lens over it

Pressing Record does **not** start a second location subscription. It writes down
an instant and a name; `core/segments/manual.ts` applies the window to the
automatic timeline when it is read.

Two subscriptions would mean twice the battery, two answers to "how far did I
walk today", and no principled way to choose between them for the daily total.
The lens approach also gives two things for free:

- Starting a recording cannot fail. There is no permission to check at that
  moment and no hardware to spin up.
- You can stop a recording you forgot to start. The fixes were being collected
  anyway; only the label was missing.

### Splitting apportions distance, it does not recompute it

Applying a window cuts segments at its edges. The two halves of a cut move
**share out** the original distance in proportion to the shape that survived
thinning, rather than each recomputing from its own points. Recomputing loses
whatever the 25 m thinning dropped, so the halves would sum to less than the
original — and a day's total that shrinks every time you label part of it is a
genuinely confusing thing for an app to do.

Segments fully inside a window are coalesced into one, stays included. You
pressed Record at the start of a walk, so the four minutes waiting at the
crossing are part of the walk, not a place you went.

---

## 5. Speed is always derived

`Fix.reportedSpeedMps` carries Core Location's own estimate and nothing uses it
for anything displayed or decided. Every speed the app reasons about comes from
distance over elapsed time between two accepted fixes.

The reason is consistency, not accuracy. The platform's Doppler speed keeps
reading 8 m/s for several seconds after you stop; a segment could then report
"1.2 km, 40 minutes, top speed 29 km/h" where the numbers contradict each other.
Deriving speed makes that impossible by construction.

Per-point speeds are stored on the retained route points, so "how fast was I at
that corner" is answerable.

---

## 6. Places are named by hand, because there is nothing to ask

`core/places` matches a stay to a place by distance, nearest first. A place is
created when you type a name; there is no geocoder and no lookup service, because
asking a server "what is at these coordinates" is exactly what this app does not
do.

The radius defaults to a generous 120 m: a stay's centre is the mean of fixes
taken indoors, where accuracy is worst, and the same café can come out 80 m apart
on two visits. Too tight and you name the same restaurant every week.

Place ids are derived from the rounded coordinate (five decimal places, about a
metre), so naming the same spot twice updates one entry rather than accumulating
two.

---

## 7. Calories count movement only

`core/energy` uses METs from the Compendium of Physical Activities:
`kcal = MET × kg × hours`, with a speed ladder per mode.

A body at rest burns about 1 MET continuously. Counting stays would therefore add
roughly fifteen hundred kilocalories to every day, most of them for being asleep,
and completely drown the walk the number is supposed to be about. This is active
energy — the same thing a watch's move ring shows — not total daily expenditure.

Treat the number as an indication. It is wrong by a good 20% for any particular
person, and wrong _consistently_, which is what makes comparing one day to the
next worth anything.

---

## 8. Battery: a distance filter, not a timer

The two things that cost power are the accuracy class (whether the GPS chip is
powered at all, or whether Wi-Fi positioning will do) and how often the app is
woken to be told something.

`distanceInterval` is the lever, because Core Location does the comparison
without waking the app: standing still costs nothing. `timeInterval` is set to
zero — a time-based update would wake the app while it sits on a desk, which is
most of the day and none of the interesting part of it.

**`pausesUpdatesAutomatically` is false, deliberately.** iOS offers to stop
location updates when it decides you have not moved for a while, which sounds
exactly like the saving this app wants. It does not reliably resume: the
documented trigger is the user starting to move again, and in practice updates
can stay paused until something else restarts them. The failure is silent and
total — the app looks like it is tracking and records nothing. A day missing from
a diary is worse than a percent of battery, and the distance filter already
covers the case it was meant to.

`showsBackgroundLocationIndicator` is true. Honest, and the fastest way to notice
tracking was left on.

---

## 9. The background task appends and returns

`services/locationTask.ts` is registered at module scope of a file imported first
by `index.ts`. iOS relaunches the app into the background with no UI when the
distance filter trips, and `TaskManager` looks for the handler at that instant;
if the bundle has not yet run `defineTask`, the launch is wasted and that stretch
of the day is gone.

The handler does one thing: write the fixes down. No segmentation, no day
arithmetic, no pruning. It has seconds to live and can be killed at any point —
and everything else the app knows how to do can be redone later from those same
fixes, while nothing can recover a fix that was never written because the handler
was busy.

Appends are serialised through a promise chain in `services/fixBuffer.ts`. An
append is a read-modify-write, and the background task and the foreground app
share one JavaScript context but not one execution order; two interleaving
appends lose whichever read first — which, since the background task is the one
running while you are actually out, would lose exactly the fixes that matter.

---

## 10. Freezing, and the segment that straddles midnight

The buffer cannot grow forever. `core/day/freeze.ts` decides what is finished.

The subtle case is a journey in progress at local midnight: a drive from 23:40 to
00:20. Cutting the buffer at midnight would leave its second half to be re-derived
alone, and it would come out as a twenty-minute drive starting from nowhere. So
the cut is made at the **start of whichever segment straddles the boundary**, not
at the boundary.

The log is written **before** the buffer is pruned. If the process dies between
the two, the worst outcome is a buffer holding fixes for days already frozen —
which the next fold merges back over the same ids, losing nothing. Pruning first
and dying would lose the day outright.

A segment that crosses midnight is filed under the day it **started**, whole.
Splitting it is more literally correct and much worse to look at: a night ride
home becomes two rides, neither of them the distance you actually went.

---

## 11. Encryption at rest

`services/vault.ts`. The threat is not a determined attacker holding your
unlocked phone; against that nothing an app does helps. It is the ordinary ways a
file leaks — an iCloud or iTunes backup, a device handed on, a forensic
extraction, a bug in some other app that can read the container. A year of
location history is the most sensitive thing most people carry and should not sit
in a plaintext JSON blob under Documents.

- **XChaCha20-Poly1305**, from `@noble/ciphers`: audited, pure TypeScript, so no
  native module in the build. Its 24-byte nonce is large enough to draw at random
  for every write without birthday-bound worries, removing the mistake
  implementations of AES-GCM most often make. Poly1305 makes it authenticated: a
  truncated or tampered store fails to decrypt rather than parsing into something
  that looks like a day.
- **The key** is 32 bytes from the system CSPRNG on first launch, in the keychain
  as `AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY`. `THIS_DEVICE_ONLY` keeps it out of
  every backup — so a restored backup contains ciphertext and no way to read it,
  which is the intended outcome. `AFTER_FIRST_UNLOCK` rather than `WHEN_UNLOCKED`
  because background location arrives while the phone is locked in a pocket, and
  a key unreadable then would leave a hole in every day.
- Key generation is coalesced through a single in-flight promise. Without it, the
  first render and the background task can race into generating two keys, the
  second overwriting the first, and everything written before that moment becomes
  permanently unreadable.
- **"Erase everything" destroys the key** rather than walking the store and
  hoping every row really left the flash. The key is destroyed _before_ the rows
  are removed: dying halfway then leaves unreadable ciphertext, whereas the other
  order leaves a key protecting nothing.

Hex, not base64, for the envelope: it costs 50% more bytes and does not depend on
`btoa`/`atob` being present as globals, which they are in some React Native
runtimes and not others. A missing global there is a crash on first launch rather
than a test failure.

---

## 12. No map, no network

The app makes no HTTP request of any kind. There is no analytics, no telemetry,
no crash reporting upload, no remote config, no geocoder and no map tile server —
and therefore no endpoint a coordinate could be sent to, deliberately or by
accident. `NSAllowsArbitraryLoads` is false and there are no exception domains,
because there is nothing for App Transport Security to permit.

Routes are drawn as an SVG sparkline (`components/RouteSparkline.tsx`), scaled by
`cos(latitude)` so the shape is not stretched sideways. The shape alone is enough
to recognise a journey you took — the loop round the park, the dogleg to the
shops — which is what a timeline row actually needs. A map would mean a request
per route carrying your coordinates to someone else's server, which is the one
thing this app is built not to do.

---

## 13. UI: no navigation library, one fold for four tabs

Four tabs — Today, History, Places, Settings — with one level of detail below two
of them. `shell/usePageStack.ts` is an array and three functions, against a
router that would bring a native screen container, a navigation state tree and a
serialisation format to solve the same problem.

This revises an earlier version of this decision, which read "three tabs need no
router". The reasoning survives a fourth tab and one level of depth. It would not
survive a fifth level, deep links or modal routes, and at that point a router is
the right answer rather than a heavier one.

Every tab stays **mounted**, with the inactive ones hidden, and a detail page
renders _over_ its tab rather than replacing it. Both for the same reason: Today
holds a running recording and a timeline it just derived, and neither should be
lost because you opened a place you visited in March.

The hooks live in the shell rather than in the screens because they are shared —
the timeline needs the manual windows and the segmentation settings, Settings
needs the rejection counts the timeline produced, and Places needs every segment
ever recorded. Lifting them is what keeps a single fold serving all four tabs.

### Naming a place asks rather than guesses

`matchPlace` returns one place, because a timeline row needs one label. But two
named places can overlap — a café inside a shopping centre you also named — and
picking the nearer one is a guess presented as a fact.

So `rankPlaceCandidates` returns the whole list with distances, and
`isAmbiguous` is true when more than one claims the stay. The picker shows the
candidates with what the engine actually knows about each: how far, whether it
currently matches, and how many times you have been. Only the person who was
there can settle it.

Candidates deliberately include places the stay fell _outside_ of, flagged as
such, because a place named from a visit with good signal and the same place
recorded from indoors can sit a couple of hundred metres apart. Confirming one of
those calls `widenToInclude`, which grows the existing place rather than creating
a second one with the same name — two identical rows with the totals split
between them being the outcome nobody wants and everybody gets. The centre never
moves: dragging it towards each new stay would let a place wander down the street
over a year of visits.

## 14. What is deliberately absent

**Core Motion activity classification.** `CMMotionActivityManager` has no Expo
binding and needs a custom native module plus a config plugin. Mode is inferred
from speed alone, which is why a slow cycle and a fast walk are hard to tell
apart — and why the Record button exists. `services/motion.ts` uses the
pedometer, which _is_ reachable and costs approximately nothing since the motion
coprocessor counts steps whether the app asks or not.

**Export.** GPX per activity and a JSON dump are planned, on demand and never
automatic. `services/dayLog.ts` stores a plain array of `Segment` precisely so
that stays a small piece of work.

**A watchOS app.** Planned — standalone tracking on the wrist, syncing when the
phone comes back in range. See § 15 for what that needs and what it cannot run
on.

**A committed `ios/` directory.** `expo prebuild` regenerates it from
`app.config.ts` on every build, so it is output rather than source. Committing it
means the config and the native project can silently diverge. If custom native
code ever becomes necessary — the Core Motion module above, or the watch target
below — delete the two lines from `.gitignore` and commit `ios/` deliberately.

---

## 15. A watchOS app: what it would take

Planned, not built. Recording on the wrist without the phone, and syncing when
they are back together.

### The design fits already

The watch would be **another producer of fixes**, nothing more. It records, it
buffers, and when `WCSession` reports the phone is reachable it transfers its
buffer; the phone appends it and folds as usual. The watch runs no segmentation,
keeps no timeline and needs no port of `src/core`.

Three properties of the existing design are what make that work, and none of them
were added for the watch:

- **The engine is a deterministic fold over fixes.** One buffer or two merged
  buffers make no difference to it, as long as the result is sorted.
- **`judgeFix` rejects out-of-order fixes**, and `normalizeFixes` sorts on the
  way out. A late batch arriving from the watch after the phone recorded its own
  is exactly the case that already has a rule.
- **Segment ids are derived from `startedAt`.** Re-folding after a watch sync
  updates the same rows rather than duplicating the day.

So the integration surface is one function: `appendFixes` in
`services/fixBuffer.ts`. Everything else is transport.

Two things would need deciding when it is built. **Duplicate coverage** — the
watch and phone both recording the same walk produces two fixes per instant;
`minIntervalMs` in `judgeFix` already drops the second, but which source wins
should be a decision rather than an accident of ordering. And **clock skew**
between the two devices, which is small but not zero, and which the ordering rule
turns into dropped fixes rather than wrong ones.

### What it cannot run on

**The watch in question — MLCH2LL/A — is the original, first-generation Apple
Watch (2015), and it has no GPS receiver.** It obtains location only from a
tethered iPhone. Standalone tracking on it is impossible in hardware; no amount
of software changes that. watchOS 4.3.2 is also its terminal release, so it
cannot be moved forward.

The practical floor is therefore **Apple Watch Series 2 or later**, which is
where built-in GPS starts. Realistically it should be higher: watchOS 6 is where
SwiftUI arrives, and a watchOS 4 target means WatchKit, a framework Apple has
since retired in favour of it.

### What it cannot be written in

**React Native and Expo cannot produce a watchOS app.** There is no JavaScript
runtime on the watch and no supported bridge; a watch app is a native target in
Xcode, written in Swift. That means:

- Committing `ios/` (see above) or writing an Expo config plugin that injects the
  watch target on every prebuild.
- A Swift implementation of the recorder: `CLLocationManager` with the same
  accuracy and distance-filter settings as `services/location.ts`, plus
  `HKWorkoutSession` — which on watchOS is what keeps an app running and its
  location updates alive with the wrist down.
- `WCSession.transferFile` for the sync, not `sendMessage`: transfers are queued
  and survive the app being suspended, which is the whole point of recording
  while out of range.

None of that touches `src/core`, which is the argument for the boundary being
where it is.
