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
untestable on a CI runner that is bolted to a rack. 669 tests run in about nine
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

## 4. One fix stream, and no Record button

Tracking is on or it is off. While it is on, everything is recorded; there is
nothing to start and nothing to stop. Naming a journey happens **afterwards**:
tap a journey the app already recorded and say what it was.

This revises the decision that stood here, which was that manual recording was a
lens over the fix stream rather than a second source. The lens was right — two
subscriptions would mean twice the battery, two answers to "how far did I walk
today", and no principled way to choose between them. What was wrong was the
button on top of it. It said "Record", with a red pulse and a Stop, over an app
that was already recording, and it asked you to declare a journey before it had
happened.

That was not merely misleading, and the bill arrived from a real phone: a
journey appeared on Today at 16:37, a time that had not arrived, with no fixes
behind it and so absent from every export. The cause was a window with one end
left open. Because `applyManualWindows` closed a running window at _now_, and
emitted a row even when it covered nothing, a name from one day printed a hollow
row on every day after it — and a recording properly stopped did the same, so
forgetting to press Stop was not even required.

### What the shape change buys

`JourneyLabel` is the old window with its one nullable field removed:

```ts
{
  (id, label, mode, startedAt, endedAt);
} // endedAt: number, not number | null
```

A label is made _from_ a segment, so it has both ends and something behind it.
Everything that was propping up the old shape then disappears rather than being
fixed:

- **No clock.** `applyJourneyLabels(segments, labels)` takes no `now`, so a
  frozen day and a live one go through identical code and give identical
  answers.
- **No fallback row.** A label covering no segments emits nothing. The old
  fallback existed for a Record pressed where there was no signal; with
  retrospective naming, covering nothing means the journey is gone — the fixes
  were pruned, or a new preset folded them differently — and silence is the
  honest answer.
- **No day arithmetic.** The window-closing rule and the day filter that were
  added to contain open windows are both deleted.

### Stored as a time range, not a segment id

Segments are re-derived from the fix buffer whenever they are needed, and a
different tracking preset folds the same fixes into different journeys. An id
would be orphaned by a settings change; a range is re-cut against whatever the
day looks like now, which is what `splitSegment` below is for.

### Merging was the same thing with nothing said, and it has gone

Joining several rows into one journey was a label over their combined span with
**no name and no mode** — not a second concept, just a label nobody had filled
in. It was cheap to build for exactly that reason, and it was removed anyway.

What went wrong was not the storage, it was the shape. A label is a span, so
everything between the first and last selected row came too and "these two but
not the middle" was inexpressible. Undoing a merge meant finding the label
behind a row from its id. And because a merge and a name were one object, a
merged journey that had also been named could not be separated without throwing
the name away. Each had an answer; the answers did not add up to a feature.

The merges are dropped on launch — a label with an empty name is exactly what a
merge was, so nothing else has to be interpreted. Without that, a build with no
merge button would go on applying every merge ever made and offer no way out of
any of them. Names survive: naming was never the part that did not work.

`applyJourneyLabels` still splits and coalesces, because a _name_ covering a
span does the same thing — the stays in the middle of a labelled journey are
part of that journey.

### Why naming is worth keeping at all

The engine can tell a bike from a car by speed. It cannot tell a slow cycle from
a fast walk, and it can never know that _this_ drive was the commute. Those two
things are what a name fixes — and both are things you know better afterwards
than during.

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

### The cost of that, and the one place it is paid back

A phone that does not move produces **no fixes at all**. That is the saving, and
it is also a hole: an afternoon at a desk can leave a day with nothing in it, and
a stay is only a stay if something observed it. It is what made "I sat down and
it recorded nothing" a real report rather than a misunderstanding.

So `features/activities/hooks/useHeartbeat.ts` asks where the phone is every ten
minutes — **only while the app is open, and only while tracking is on**. Both
halves are load-bearing. In the background the distance filter is the whole
battery argument and a timer there would undo it; and the tracking switch being
off means the app records nowhere you are, so a heartbeat that ignored it would
write down your position after you asked it not to.

It reschedules from the moment each fix lands rather than running on an
interval, so returning to the app after two minutes takes nothing and returning
after twenty takes one immediately. An interval would fire on a fixed grid and
take a reading every time you glanced at the screen.

Two details that decide whether it works at all:

- **`Accuracy.High`, not `Balanced`.** Balanced is documented at ~100 m and
  `maxAccuracyM` is 60, so every heartbeat would have been discarded by
  `judgeFix` as `inaccurate` — a feature that appears to run and does nothing.
- **A foreground request can return a cached position**, which is why this used
  to be forbidden from reaching the fold. The engine already handles both ways
  that goes wrong: a reading no newer than the last is `out-of-order`, and a
  cold-start position stamped now from where the phone was hours ago is a
  `teleport`. A stale heartbeat is discarded, not believed.

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

### Below 20%, the app gives way first

A location app is the thing draining the phone, so it is the thing that should
yield when the phone is nearly flat. Under 20% and off the charger, tracking
drops to the `saver` preset — Wi-Fi-class positioning, a point every 100 m —
which costs a route some detail and buys the rest of the day.

Three properties, each of which is the interesting part:

**It is a lens, not a setting.** `settings.preset` still holds what you chose;
`effectivePreset(chosen, savingBattery)` derives what actually runs. Nothing is
persisted, so a phone that reaches a charger goes back to full detail without
anyone having to remember to put the setting back — the same shape as manual
recording over the fix stream (§ 4), and for the same reason.

**It only ever coarsens.** A low battery can move `detailed` down to `saver` and
can do nothing at all to a `saver` you chose yourself. Choosing `detailed` on a
flat phone stores the choice and keeps running the coarse preset until there is
charge to honour it.

**It has hysteresis, and that is load-bearing.** `core/power` drops below 20%
and restores only above 25%. Applying both at one percentage means a phone
hovering at the threshold restarts Core Location every time the reading
flickers — and restarting location updates is itself expensive, so the naive
version spends more battery than it saves at exactly the moment there is none to
spare. A property test pins that the decision reaches a fixed point for any
steady reading, which is what makes it safe to run on every event.

Charging suppresses it entirely: a phone at 15% and climbing does not need
saving. A missing reading — the simulator, or the first moment after launch —
is not treated as a low one, because "I do not know" is never a reason to record
less.

It runs while the app is open, since the listeners do not survive suspension and
re-reading on return to the foreground is cheaper and more honest than
pretending to know what the battery did meanwhile. What has already been applied
_does_ survive backgrounding: a phone that hit 15% in your hand is still at 15%
in your pocket.

Both screens that would otherwise quietly show less say so — Settings above the
preset list, Today while it is recording. An app that silently records less than
you asked for is the failure this is guarding against as much as a flat phone.

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

### Pruned fixes are archived, not dropped

Freezing removes a day's raw readings from the buffer — the fold never needs them
again, because the day's segments are its record. They used to be **deleted**,
which is why exporting "all raw fixes" produced a file containing today and
nothing else.

`pruneBuffer` now writes them under `fix-archive/<YYYY-MM-DD>`, **one key for the
day that just ended, and never one blob.** A single entry would mean every freeze
reads the whole archive, sorts it and writes it back, sealed as hex — 337 KB on
day one and 120 MB a year later, on the thread that draws the screen. That is the
same shape as the failure that made the media gallery unusable (§ 12b), and it
degrades silently over months rather than failing anywhere a person would see it.

The date in the key is load-bearing. `YYYY-MM-DD` compares as a string exactly as
it compares as a day, so `trimArchive` deletes whole days by name and reads only
the one the cutoff lands inside. It runs on the same cutoff as the log, so an
archive can never outlive the days it describes. `eraseEverything` enumerates by
**prefix** rather than by a list of names, or it would leave a year of days
behind.

**Nothing reads the archive to build a timeline**, and adding a caller that does
would undo the reason freezing exists.

### Compacting the stationary runs

An afternoon at a desk is hundreds of readings at one spot at zero speed, and
between them they say one thing: _here, from then until then_. The arrival and
the departure say it just as well. Everything else is the non-necessary data this
app should not be hoarding — and the fix archive is the one store nothing else
bounds, since retention only reaches its far end while a phone that never moves
fills it as fast as one out walking.

`core/compact` is where that arithmetic lives, and it is pure: readings in,
fewer readings out, thresholds as parameters. It only ever **removes**. Nothing
is rewritten, averaged or invented, which is what keeps "raw fixes" an honest
name for what the export produces.

**The trap it is built around.** The timeline is re-derived from the buffer, and
_a gap is a hole, never a straight line_ (§ 2): no fix for `gapMs` closes whatever
is open and the day simply stops. Delete the middle of a three-hour stay and the
fold sees two lonely readings an hour apart — the stay becomes a hole, and the
cleanup has eaten an afternoon. **Naive deletion is not a smaller buffer, it is a
different day.**

So there are two shapes, decided by where the readings are going:

- **Into the archive: endpoints only, in a 60 m circle.** Nothing folds these
  again — a frozen day's segments are its record — so there is nobody downstream
  to disturb. This is the half that does the work.
- **Staying in the buffer: a skeleton, in a 25 m circle.** Today is re-folded on
  every refresh, so a run keeps one reading every `gapMs / 3` — a third of the
  tolerance left spare so a coarser preset or a delayed reading cannot eat the
  margin.

A run is the readings within `stillRadiusM` of **the first of them**, never of
the previous one. That is the difference between a desk and a slow amble: drift
of a few metres at a time leaves the circle after a few readings and ends the
run, where a previous-reading test would follow it across a car park and compact
a walk to its endpoints.

### Why the two radii differ, and why 25 m was wrong for the archive

The radius has to be **wider than the tracking preset's distance filter**, and
this is arithmetic rather than taste. iOS delivers a location update only once
the phone has moved further than the filter from the last one it delivered, so
consecutive readings in the buffer are already that far apart by construction. A
radius at or under the filter means every reading starts a new run, no run ever
holds a third, and compaction cannot drop anything at all.

Both halves shipped first at `pathResolutionM`, which is 25 m, which is exactly
the balanced preset's filter. The feature did nothing whatsoever on a phone while
every test in `core/compact` passed — the fixtures sample a stationary phone
every ten seconds, which is a thing this app never does. The only readings that
genuinely cluster are the ten-minute heartbeats (§ 8), which bypass the filter by
asking directly.

The archive now uses `minMoveDistanceM`, 60 m, which clears the balanced preset's
25 m and the detailed preset's 10 m. The saver preset filters at 100 m and stays
out of reach, which is right: a stream sampled every 100 m has nothing redundant
in it.

The buffer keeps the tight 25 m **deliberately**, because it is the half that
gets folded again, and a wide circle costs something there. It absorbs the first
readings of a departure, and it under-counts movement _confined_ to the circle —
pacing a garden or a shop floor comes out with less distance than it had. Neither
matters where nothing folds again; both matter for today. What the buffer is
bounding is a single day, which midnight bounds anyway, so the timid setting is
the right trade and the archive is where the saving lives.

Two properties hold whatever the input, and they are what make this safe to run
over a buffer that will be folded again. **Every reading outside a run survives**,
along with the first and last of every run — so the arrival, the departure and
every step of an actual journey are byte-for-byte what they were. And **no
spacing is created that was not already there**: a reading is kept as soon as the
_next_ one would put the gap past the hold, which bounds the spacing at the hold
rather than at twice it. A hole wider than that in a compacted stream is the
phone's, not ours.

What it does **not** promise is a byte-identical fold, and the honest version is
worth writing down: jitter inside the radius can accumulate enough path length to
have been emitted as a phantom move — 60 m of wandering inside a 25 m circle is a
desk — so a timeline can come out slightly cleaner than it did. Stays keep their
ids, because a run's first reading is always kept and an id is derived from
`startedAt`.

It records a span, `compact buffer` or `compact archived day`, with the number of
readings dropped — **only when some were**. The caller runs every twenty seconds,
and a span per no-op would fill the 120-entry cap in forty minutes with rows
saying nothing happened. The count is what makes it worth having: whether this is
doing anything on a real phone is otherwise unanswerable until the next freeze.

**The trigger is the freeze, automatically**, which is the same house style as the
battery lens and the archive trimmed on the log's own cutoff: the app coarsens and
maintains itself rather than handing its owner a Clean Up button. It runs in
`pruneBuffer` because that is the pass that already visits every fix. The live
half runs on **every** call and not only on the ones that prune, because a day
spent at a desk with the app open fills the buffer whether or not midnight has
passed since the last freeze; `compactFixes` returns its input untouched when
there was nothing to drop, so that is not a write every twenty seconds.

---

## 10a. The diary: the one thing that is not derived

`core/day/notes.ts`. Everything else on a timeline is the fold's reading of a fix
stream — where you were, how fast, how far. None of it can say what the day was
_like_, who you were with, or that the long way home was on purpose. A note is
the part only its author has, and it is the only record in this app that nothing
can rebuild.

**A title and a body, and either alone is enough.** A title is what makes a
diary readable at a glance — "Sam's birthday" over four lines about a birthday —
but insisting on one turns a jotted line into a form to fill in, and the note you
do not write because it wanted a heading is worse than an untitled one. Titles
arrived a release after the notes did, so a stored entry may have none:
`normalizeDayNotes` defaults it rather than dropping the row, which is the same
instinct as everything else here — the body is the part nothing can reconstruct.

**Timestamped, several per day.** A page per date would have been the smaller
model, but the app already knows the shape of a day to the minute, and a note
dropped between the walk and the café reads as part of that day rather than as a
paragraph filed under it. `withNotes` interleaves them at draw time — nothing
combined is stored, the same way `applyJourneyLabels` re-cuts labels against a
re-derived day.

**Ids are derived from the instant**, `note-<at>`, because `core` has no entropy
source. That makes an edit at the same instant an update rather than a duplicate,
and it makes two notes at one instant a single note that ate the other — so
`freeInstant` nudges a collision forward a millisecond. Not hypothetical: every
note added to a finished day wants the same default instant, the end of its last
segment.

**The instant is chosen, with a default.** `whereToWrite` answers now when the
day on screen is today, and the end of the day when it is over — an evening's
reflection goes after the last thing that happened. Noon is the fallback for a
day that recorded nothing, because midnight reads as the day before. Over the top
of that, the sheet offers the system date and time pickers in their compact iOS
style: two small fields, not a wheel owning a third of the screen. The default is
right often enough that they are usually there to be ignored, and when it is
wrong the fix is one tap. Changing the date moves the note to another day, which
is how one written in the wrong place gets put right.

**Retention never deletes one**, and this is the same line captures already draw
(§ 10): a fix is something the app collected on its own and may discard on its
own; a note is something you sat down and wrote, and deleting that on a timer is
not the app's call. A day can therefore outlive its own readings as a sentence
about what happened, which is the right way round — the readings were the
disposable half all along. The retention picker says so.

Two more consequences of being unreconstructable. `normalizeDayNotes` **repairs
rather than drops** wherever it can: an id no build ever wrote is rebuilt from the
instant, where a malformed fix would simply be discarded. And the diary is the
**fourth CSV** — an app whose whole argument is that your data is yours cannot be
the one place your own writing is trapped.

**Both controls sit above the player, and that is the second attempt.** The
first put writing a note behind caption-sized text at the end of the TIMELINE
heading, below the whole map — findable only by somebody who already knew it was
there, which is the one thing an entry point must not be. They are 44-point icon
buttons now, above the scrubber and **outside** the player's `segments.length`
guard, so a day with no fixes keeps them: that day is the one most worth writing
about, because the app recording nothing is not the same as nothing happening.

The voice recorder is the second of the two. It was the camera's third mode, and
a voice note has no viewfinder — reaching it meant opening a camera you were
going to ignore. `useVoiceNote` carries over the two things that were expensive
to learn there: the position is read at the start and held in a **ref**, since
`stop` resolves inside a closure created before the reading arrived; and the
screen is held awake on **busy** rather than on recording, so the hold does not
drop in the window between stopping and saving where the phone would lock.

**A day exists whether or not anything was recorded on it.** `groupByDay` builds
its list out of segments, so `daysWorthOpening` adds the days that have only a
note, and today. Without it a day with no readings has no arrow, no page and
nowhere to write, which fails on a fresh install and on a day spent somewhere
with no signal — the two days most worth a sentence rather than a measurement.

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

## 12. One network request, and only when you ask for it

The app makes no HTTP request of any kind on its own. There is no analytics, no
telemetry, no crash reporting upload, no remote config and no geocoder — and
therefore no endpoint a fix, a photo or a place name could be sent to,
deliberately or by accident.

**The single exception is map imagery.** `settings.mapsEnabled` is false on a
fresh install, and while it stays false the app behaves exactly as every earlier
version did: nothing it holds leaves the phone and nothing it draws comes from
anywhere else. Turning it on lets MapKit fetch tiles for the region being looked
at.

This revises an earlier version of this decision, which read "no map, no
network", and it is worth being precise about what changed and what did not:

- **Your track is never sent.** The route is an overlay, drawn on this device
  from coordinates that stay on it. What Apple learns is which part of the world
  is on screen — which, at the zoom a day's travel implies, is not nothing, and
  is why this is a switch rather than a default.
- **`NSAllowsArbitraryLoads` stays false with no exception domains.** Apple's
  tile endpoints are HTTPS, so the key that used to be moot because there was no
  traffic is now load-bearing over the only traffic there is.
- **Nothing else gained a network path.** The privacy manifest still declares no
  collected data types, because a request _to_ Apple for imagery is not this app
  collecting anything.
- **The Settings screen's own copy changes with the switch.** It used to say
  "makes no network requests of any kind" unconditionally; leaving that there
  once maps existed would make the one screen that promises honesty the one
  screen that lies.

`components/MapCanvas.tsx` is the only file that imports `expo-maps`, and it
presents both backends behind one prop shape so no caller branches on the
setting. With imagery off it draws the **offline canvas**: the same polylines and
stops, plus a scale bar and a north mark, projected by `core/geo/project.ts` —
equirectangular with longitude scaled by `cos(latitude)`, or a route at 55° comes
out nearly twice as wide as it was. That projection is shared with
`components/RouteSparkline.tsx`, which still draws the shape of a journey in the
space of a timeline row, because a row needs "which journey was this" rather than
streets.

Keeping `expo-maps` behind one file matters more than usual: it is alpha and
documents frequent breaking changes.

---

## 12a. Replay: the player must not invent a journey

`core/replay` flattens a day into one ordered path through time and answers
"where was I at twenty past two". It stores nothing: the track comes from the
segments, the position comes from the track and the playhead.

`positionAt` returns **null across a hole**, and that is the whole point of the
module. A player is where the temptation to interpolate is strongest — an icon
that stops dead looks like a bug and one that glides looks correct — and a smooth
line across two hours indoors is § 2's four-kilometre walk through a building,
animated. The screen says "No signal" and the scrubber draws the gap.

The hole is found structurally rather than by a threshold. The timeline is
contiguous (§ 2), so two consecutive track points belonging to different segments
and separated by real time can only mean the segmenter closed one and opened the
next with nothing in between. There is no `gapMs` to pass in and no way for this
to disagree with the config the day was folded under.

The corollary is that the duplicated boundary instant must be **kept**: a segment
ends exactly where the next begins, so every transition produces two points
stamped the same moment. Dropping one leaves the old segment's last point beside
the new segment's _second_ point, separated by real time — which is exactly the
shape read as a hole, and the timeline would sprout a gap at every change of
activity.

---

## 12b. Capture stores a position twice, and the same one both times

Photos, video and voice notes take one reading at the shutter and write it to
**two** places: onto the item as `at`, and into the fix buffer as an ordinary
fix. One reading, so the two can never disagree — the pin on the photo and the
route drawn under it are literally the same coordinate.

This reverses an earlier decision, which was that a capture stores a time and
nothing else and its position is derived on read from the day's own track. The
reasoning was § 4's: one fix stream, one answer to "where was I". The reasoning
was right and the conclusion was wrong. Deriving works only where the track has
something to say, and the moment you most want a photo's location — indoors, at
the end of a long stay, in a lift, seconds after the app woke — is exactly when
the distance filter has produced no fix for minutes and the answer is null.

The single-stream rule survives intact because there is still one stream. The
capture does not subscribe to anything; it asks `currentFix()` once, that fix
goes through `judgeFix` like every other, and it is the same value that lands on
the item. A capture is a reason to ask, not a second source.

`placeMedia` therefore prefers `item.at` and falls back to `positionAt` over the
day's track. The fallback is not legacy handling to be removed later: it is what
gives every capture taken before this existed a location, and what covers a
reading the judge rejected.

**Nothing links a capture to a segment, and nothing ever did on disk.** There
was an `attachToSegments` that bucketed items by which row contained their
instant, derived on read rather than written onto a segment — because segments
are re-derived from the fix buffer every time they are needed (§ 1), and a
stored link would orphan every photo the first time a day was folded under a
different config.

It went with the capture's own detail page. A capture is selected by _time_
now: the gallery groups by day (`groupMediaByDay`), the day screen filters by
day (`mediaForDay`), and the map places each item with `placeMedia`. Time is
what the item stores and what no re-fold can change, so the question the
bucketing answered — which row owns this photo — stopped being asked. The
principle it demonstrated stands: if the link is ever wanted again, it is
derived on read and never written down.

### Showing them: thumbnails are what make a gallery possible

A sealed thumbnail — 240 points on the long edge — is written beside every photo
and video at capture time, in the same container format. It costs a few
kilobytes and it is the difference between a gallery that opens instantly and
one that decrypts forty megabytes to show you a postage stamp.

`MediaGalleryScreen` decrypts **exactly one** capture: the page you are looking
at. Both of its lists are windowed, and the pages either side draw thumbnails.
Video is played from the decrypted file on disk rather than read into memory, so
a ten-minute clip costs what a ten-second one does — AVFoundation reads the
frames it needs. That is also why the file has to exist decrypted for the length
of playback: there is no way to hand Core Media a stream this app decrypts as it
goes, and buffering the clip in JavaScript to avoid that would be the very thing
being avoided.

### The bytes: ordinary files, and why the container went

Media is stored as plain files under `Documents/media`. It used to be sealed
into a chunked container of its own — `"AVM1"`, a megabyte at a time, each chunk
independently authenticated — under the same device key as everything else.

That was consistent and it was wrong about the trade. **iOS already encrypts the
app container**, with a key derived from the passcode, so a second pass in
JavaScript added very little against the threat it was named for: someone with
the phone. What it added a great deal of was cost. `@noble/ciphers` is audited,
pure TypeScript and has no hardware acceleration, so opening a minute of video
meant forty megabytes of AEAD on the single thread that also draws the screen —
and the read path, unlike the write path, was shipped without a yield between
chunks. Switching to the Media tab took seconds and the swipe that got you there
had already been forgotten.

The one thing the layer genuinely bought was **backups**: the key is
`THIS_DEVICE_ONLY`, so an iCloud or Finder backup restored elsewhere held
ciphertext and nothing else. That was given up when the container went, and it
has since been bought back a different way — `Documents/media` carries
`NSURLIsExcludedFromBackupKey`, so the files are not copied into a backup at
all. Not being there is a stronger guarantee than being there unreadable, and
it costs nothing at read time, which is the whole complaint against the
container.

`expo-file-system` exposes no way to set that key, so it is a second local
native module: `modules/file-backup`, one Swift function, in the mould
`modules/camera-optics` established. `mediaStore.ts` applies it from
`ensureDirectory` on every write rather than once at creation — that is also
the migration, since a library written by an earlier build has an unflagged
directory and there is no launch step to fix it. The native side reads before
it writes, so the repetition costs one `getattr`.

**What this does not do is survive the phone.** A capture excluded from backup
is gone with a lost or replaced device, and until the S3 sync in
`docs/BACKLOG.md` § 12 there is no other copy anywhere. That is the deliberate
position — a location diary's photographs should not sit in iCloud — and it is
the reason the sync is the item that matters most in the backlog.

What it buys instead is that video actually streams. `expo-video` is handed the
stored file and AVFoundation reads the frames it needs; a ten-minute clip costs
what a ten-second one does, and starting it costs nothing. That was impossible
before — there is no way to hand Core Media a stream this app decrypts as it
goes, so every clip had to be written out whole first.

Encryption has not gone away; it has moved to where data actually leaves the
device. The sync seals bytes on the way _out_. Everything else — fixes, places,
labels, settings, the media index — is still sealed by `services/vault.ts`,
because those are short strings and the cost there is not measurable.

**`unsealInPlace` is the migration**, run once per file on launch after the
index settles, and it is not optional: a build that cannot read a sealed file
silently loses every photo its owner ever took. It fails closed, leaving the
sealed original alone rather than replacing it with half a file.

### The container that was, and that the migration still reads

The vault seals _values_ — short strings bound for AsyncStorage. A minute of
1080p is forty megabytes, which does not go through `JSON.stringify` and should
not be turned into hex. So `services/mediaStore.ts` seals media into its own
file format under the same device key:

```
"AVM1"                       4-byte magic and format version
repeated until EOF:
  length   4 bytes, big-endian, of the sealed chunk that follows
  sealed   24-byte nonce || ciphertext || 16-byte Poly1305 tag
```

Chunked at a megabyte because sealing a whole video in one call holds three
copies of it in memory at once. Every chunk is independently authenticated, so a
file truncated by the phone dying mid-write fails to open rather than decrypting
into noise — a corrupt video that plays as garbage is worse than one that will
not play, because it looks like a recording and is not. The length prefix sits
outside the authenticated bytes and is therefore untrusted input, bounds-checked
before it is believed.

The plaintext the OS hands over is deleted once sealed, or the container would
hold an unencrypted copy of everything ever captured. Playback decrypts to the
**cache** directory for the reason `exportFile.ts` gives, and the copy is deleted
when the screen closes.

**Video capture is still capped at 60 seconds, and the reason has changed.** It
was the encryption: the bytes were sealed on the way in and decrypted again to
play, and both passes are something you would wait for at ten minutes. Neither
pass exists now. What remains is a diary's own judgement about what a capture is
for — a clip attached to a moment on a timeline, not a recording session — plus a
disk budget that grows without a ceiling if nothing bounds it. That is a weaker
argument than the old one, and it is the one to revisit if the segment model in
`docs/BACKLOG.md` is ever built, since pause and resume make "how long is one
clip" a different question.

### Interrupted mid-seal

Suspension is not an exception. If iOS stops the app between the camera handing
a clip over and the seal finishing, neither the `catch` nor the `finally` runs —
so the naive version lost the capture _and_ left a half-written container that
nothing pointed at: invisible in the app, absent from the "what is stored"
total, and occupying the phone until "erase everything".

Three things close it, and the order matters:

1. **The capture is staged under our own name first.** A move, not a copy —
   same container, so a rename, free however large the clip. The name is
   `<id>--<kind>`, and since the id encodes the instant, an interrupted capture
   describes itself with no extra bookkeeping to keep in step.
2. **Anything still staged is sealed on the next launch**, before the index is
   settled. A capture that cannot be sealed is discarded rather than retried
   every launch for the life of the install.
3. **Then sealed files the index has never heard of are swept.** After
   recovery, never before, or the sweep would delete what recovery just wrote.

The staging directory is in **cache, not documents**, and that is the one part
here that is not negotiable: the file is plaintext until it is sealed, and
documents is backed up to iCloud. Parking video there even for seconds would put
unencrypted recordings in a backup and undo the guarantee the whole store
exists to make. Cache is excluded from backups; iOS may reclaim it under storage
pressure, which costs an interrupted capture and never costs privacy.

"Erase everything" is unchanged in what it guarantees: destroying the key makes
every sealed file permanently unreadable. Deleting the media directory afterwards
is housekeeping so the bytes do not sit in the container for the life of the
install, not the thing that makes them safe.

---

## 13. UI: no navigation library, one fold for four tabs

Four tabs — Day, Capture, Media, Settings — with one level of detail below
each. Capture and Media take the two middle slots, where a thumb reaches without
moving the phone: Capture is the only tab that is a thing you _do_, and Media
the only one you open to _look_ at something rather than read it.

It was five, then three. "Today", "History" and "Replay" were all _look at a
day_ — the same stats, the same timeline, the same map — differing only in which
day and whether it moved. Three tabs meant three renderers of one thing, a Today that could not
show yesterday, and a History that could not show today. They are one screen
now: the day is a parameter, it defaults to today, arrows walk backwards, and
the full list of days is a page under it rather than a tab beside it.

### Back is a gesture, and it is still not a router

`shell/SwipeBackPage.tsx` gives every detail page the edge swipe an iOS user
expects: a `PanResponder`, one `Animated.Value`, `useNativeDriver` so the drag
survives a busy JS thread — which matters here, because opening a day is exactly
when the fold is running.

**Edge-initiated, not anywhere-initiated.** A page holds horizontal scrollers —
the mode chips, the speed buttons, the route table — and a gesture that could
begin anywhere would fight all of them. Starting within 28 points of the left
edge means the two can never both claim a touch.

The commit thresholds (`beganAtEdge`, `shouldGoBack`) are exported and tested as
functions. A `PanResponder` computes its gesture state from a touch history the
test renderer does not maintain, so firing synthetic responder events proves
nothing about what a finger would do — the decisions are testable even where the
plumbing is not. `shell/usePageStack.ts` is an array and three functions,
against a router that would bring a native screen container, a navigation state
tree and a serialisation format to solve the same problem.

This revises the decision three times over. It first read "three tabs need no
router", then four, then five, then three again, and now four. The reasoning
survives five tabs and one level of depth. It would not
survive a fifth level, deep links or modal routes, and at that point a router is
the right answer rather than a heavier one.

**Places lost its tab and is now a page under Settings.** iOS collapses a sixth
tab into a "More" list, which is worse than either choice available here, so
something had to give. Replay and Capture are things you _do_; Places is a
reference list you consult, and it keeps its full screen one tap away.

**Pressing a tab twice goes home.** Every detail page above it closes, and on Day
the day itself returns to today — the day is a parameter of one screen rather than
a page of its own, so "the root of the Day tab" and "today" are the same place.
Only a second press on the _same_ tab counts: two quick presses on two different
tabs is somebody looking around, not asking to go home.

Every tab stays **mounted**, with the inactive ones hidden, and a detail page
renders _over_ its tab rather than replacing it. Both for the same reason: Today
holds a running recording and a timeline it just derived, and neither should be
lost because you opened a place you visited in March.

**Two screens are the exceptions, and they prove the rule.** Both are told which
tab is showing, and both do less when it is not theirs.

`CaptureScreen` mounts `CameraView` only when Capture is visible. Keeping a
capture session alive behind three hidden screens costs battery, holds the
hardware, and leaves the recording indicator lit while you read Settings — the
opposite of what "stays mounted" is protecting.

`MediaGalleryScreen` opens a capture only when Media is visible, for two reasons
at once: a video should not keep playing where you cannot see it to stop it, and
a decrypted file should not sit in the cache directory for a tab nobody is
looking at. Coming back costs one decrypt, which is the right price.

The hooks live in the shell rather than in the screens because they are shared —
the timeline needs the manual windows and the segmentation settings, Settings
needs the rejection counts the timeline produced, Places needs every segment ever
recorded, and media is written by Capture and read by Replay. Lifting them is
what keeps a single fold serving all four tabs. The player's selected day lives
up there too, because History's "Replay this day" chooses it as well, and two
owners of one selection means one is a copy that renders the wrong day first and
corrects it afterwards.

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
binding and needs a custom native module. Mode is inferred from speed alone,
which is why a slow cycle and a fast walk are hard to tell apart — and why a
journey's mode can be corrected by hand, with a long press (§ 16).

The barrier is **procedural now rather than structural**: `modules/camera-optics`
(§ 16) established the local-native-module pattern, so binding the classifier is a
file in `modules/` when something wants it. Nothing does yet, and that is the
bar.

There was a `services/motion.ts` wrapping the pedometer, which _is_ reachable and
costs approximately nothing since the coprocessor counts steps whether the app
asks or not. It existed against the day something would use it to confirm that a
stretch called a walk had steps under it. Nothing ever did, so it has gone and
`expo-sensors` with it: an unused native module still links into the binary and
still carries a permission the app has no reason to want. Bring both back when
there is a caller, not before.

**GPX export.** CSV is built — three files, because the app holds three genuinely
different things and flattening them into one table would lose the distinction:
raw fixes as Core Location gave them, every route point kept with its derived
speed, and the timeline itself one row per segment. It is all string building in
`core/export`, so the exact bytes are asserted in a test rather than eyeballed in
a spreadsheet afterwards, and `services/exportFile.ts` hands the result to the
share sheet. That is not a network request: the app hands iOS a file and iOS
decides what happens to it.

GPX per activity is still to come, on demand and never automatic.
`services/dayLog.ts` stores a plain array of `Segment` precisely so that stays a
small piece of work.

**A watchOS app.** Planned — standalone tracking on the wrist, syncing when the
phone comes back in range. See § 15 for what that needs and what it cannot run
on.

**Map imagery by default.** The offline canvas is what a fresh install draws,
and it is not a degraded mode — it shows exactly what the app knows and invents
no streets around it. Apple Maps is one switch away and says what it costs. See
§ 12.

**Media in the Photos library.** Captures stay in this app's own storage rather
than the camera roll — files iOS encrypts under the passcode, flagged so they
are left out of backups. "Encrypted container" is what this said while media was
sealed under the vault key, and the phrase survived the container by a release;
it is worth being exact, because the roll is synced to iCloud and staying out of
it is the entire point. A photo attached to a location diary should not be the
one thing in it that leaves.

**A committed `ios/` directory.** `expo prebuild` regenerates it from
`app.config.ts` on every build, so it is output rather than source. Committing it
means the config and the native project can silently diverge.

Custom native code did become necessary, and it did **not** cost this: a local
Expo module under `modules/` is autolinked into the generated project on every
prebuild, so `modules/camera-optics` is source, `ios/` stays output, and the
question never arose. What would still force the issue is a target Expo cannot
generate — the watch app below being the obvious one — and at that point the two
lines come out of `.gitignore` deliberately rather than by accident.

Note that `expo-camera`, `expo-audio`, `expo-video` and `expo-maps` are native
modules, so the app no longer runs in stock Expo Go: development needs a dev
client build.

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

---

## 16. The camera: real optics, and a screen that never turns

The capture tab is a viewfinder rather than a page — the preview fills the screen,
the shutter sits under a thumb, and there is no header and no list. The controls
float over the picture, which is the same argument the gallery makes below: a
header and a subtitle cost about a fifth of a phone screen, and both tabs exist to
look at a picture.

### Zoom is three buttons, and the numbers behind them are real

0.5×, 1× and 3×. A wheel you turned with a finger was built, refined over four
releases and **withdrawn**: it was never reliably better than tapping a lens, and
the gesture cost more than the control was worth.

What survives is the part that was always sound. `modules/camera-optics` is one
Swift file reading what AVFoundation knows and Expo does not pass on, so the stops
sit exactly where the lenses hand over
(`virtualDeviceSwitchOverVideoZoomFactors`) and the millimetres are derived from
each lens's measured field of view rather than looked up from a table that goes
stale with the next phone.

**The module reads and does not write, and that is the second thing the wheel
took with it.** It used to set the zoom on the device by factor, through
`ramp(toVideoZoomFactor:withRate:)` — the call that makes zoom feel like glass
moving rather than a value changing, and one there is no reaching from
JavaScript. Three buttons do not need it: they drive `expo-camera`'s own prop,
and the format-dependence that justified going around the prop is handled where
it arises, by re-reading the description when the mode changes. Roughly a third
of the Swift went. The argument for bringing it back is in the git history
beside the code, and any future gesture over this camera will want to read it.

The dial drives the **virtual** device — Triple Camera, or Dual Wide — and that is
the difference between a zoom and a crop: `expo-camera`'s default device is the
bare wide lens, which cannot reach the ultra-wide at all. Asking for 0.5× on it
gets you a digital downscale of the wide lens and nothing else.

**Two number spaces run through `core/media/optics.ts`, and confusing them puts
every figure out by exactly 2×.** _Device_ factors are AVFoundation's, where 1.0
is the widest lens on the virtual device. _Display_ factors are the ones a person
says out loud, where 1× is the main lens. They differ by the wide lens's
switch-over factor.

The value reaches the camera through `expo-camera`'s own `zoom` prop, which its
Swift raises the running format's `videoMaxZoomFactor` to the power of — so
`zoomPropFor` inverts it exactly. **Read the Swift, not the docs:** the published
formula is the older linear one and is wrong for this version. The description is
re-read when the mode changes, because photo and video run different formats and
the exponent's base changes with them.

### What the withdrawn wheel taught, kept so it is not re-learned

Any future gesture over this camera meets all three of these:

- `CameraView` interfering with touches on iOS is an accepted expo bug
  (expo#28966), and zoom failing to apply is an open one (expo#33279).
- The wider advice — expo#11032, and VisionCamera's own guide — is that camera
  zoom should not be driven from React state at all.
- A `PanResponder` rebuilt each render closes over that render, so a gesture
  re-granted mid-drag runs an older closure and reverts to its base. The shutter
  being a `Pressable` means only a _capture_-phase handler can take a drag off
  it.

And the arithmetic rule that outlived the control: **zoom is measured from the
start of each gesture, never accumulated.** Adding deltas per movement drifts, and
it means letting go and repeating the same movement from the same place gives a
different answer the second time.

### Nothing is rotated on disk

`responsiveOrientationWhenOrientationLocked` on `CameraView` reports the device's
orientation while the interface stays locked to portrait — the signal iOS already
computes for the status bar, needing no permission and no `expo-sensors`.

The orientation goes onto the `MediaItem`. `core/media/orientation.ts` turns it
into an angle, and the gallery applies that angle **to the view, at the moment it
draws**. A rotation is a property of looking, in the same way the timeline is
derived rather than stored: a file rewritten on the way in is a file that can be
turned twice, and there is no way back from that.

The same angle turns the capture controls, and the same fact moves them — the mode
rail takes whichever edge is uppermost and zoom takes the other, because turning
the glyphs alone leaves the rail along the bottom half the time.

**Which landscape is which was a coin toss until a phone settled it.** iOS has
meant opposite things by "landscape left" — `UIDeviceOrientation` names it for
where the home button went, `AVCaptureVideoOrientation` for where the top of the
frame points — and the prop's documentation names neither. `UPRIGHT` in
`core/media/orientation.ts` is one table, and swapping its two landscape rows
fixes the photographs and the rails together. The tests assert only what holds
either way: that the two are opposite quarter turns.

**The camera turns the pixels itself, so the display turns nothing.**
`CAMERA_WRITES_UPRIGHT_PIXELS` is `true`, and a phone is what settled it: the
photograph came out **ninety** degrees off rather than a hundred and eighty. That
is the whole diagnosis — half a turn would have meant the landscape rows were the
wrong way round; a quarter meant a rotation had been applied to a file that was
already upright.

**A wrapper on the media stage must not take layout space.** Everything drawn
there positions itself with `absoluteFill`, so a plain sized `View` around the
picture stops being an overlay and becomes a flex child — which is how the
thumbnail beneath a capture became a band across the top with the photograph
pushed below it. `Turned` returns its children untouched when there is no angle,
and overlays rather than wraps when there is.

### The screen is held awake while a capture is in progress

Nothing about a camera preview counts as user activity, so a recording made
without touching the screen looks to the auto-lock timer exactly like a phone left
alone. That was reported from a real phone as a clip cut off half a minute in.

The lock covers **sealing as well**, and is keyed on "busy" rather than on the
recording state: dropping it between recording and saving would release it
precisely where the phone would lock, and the saving overlay asks you to keep the
app open while the app is letting the phone shut itself.

### The gallery's gestures are the Photos gestures

The capture detail page is gone; the gallery absorbed it. Swipe **up** and
everything the app knows about the capture rises under it — the fields, the map
with it pinned to the spot, Forget. Swipe **down** and every day's captures arrive
as a grid, newest first, where tapping a thumbnail lands the pager on it. The ⋯
menu went with the page: the swipe is the affordance.

The Day timeline's captures are small thumbnails, and tapping one switches to the
Media tab focused on that capture — one screen that shows a capture, rather than
two that drift apart, which is what retiring `MediaScreen` bought.

**This vertical gesture can be reliable where the timeline's horizontal swipe
could not, and the difference is structural rather than a better threshold.** The
pager underneath scrolls _horizontally_, so a decisively vertical drag has no
other claimant. Its two decisions are exported from `verticalIntent.ts` and tested
directly, per `SwipeBackPage`'s precedent.

The same reasoning is why **correcting a journey's activity type is a long press,
not a swipe**: a row on a vertically scrolling list has to hand a horizontal drag
back to the scroller often enough that the swipe is unreliable by nature — reported
from a phone as simply not working — and a correction that only sometimes happens
is worse than a menu that always does.

### A five-second "live" capture was built and withdrawn

It recorded forwards from the shutter, because `expo-camera` has no rolling
buffer, and that is not what a Live Photo is. `normalizeMedia` still reads the
retired kind as `video`, which is what it always was on disk — a clip and a still.
Dropping the kind outright would have dropped the row, and `sweepOrphans` would
have deleted the file on the next launch: somebody's capture gone, silently,
because a feature was taken away.

A real Live Photo is `AVCapturePhotoOutput.livePhotoCaptureEnabled`, which the
local-native-module pattern now makes reachable. It is parked, not refused.
