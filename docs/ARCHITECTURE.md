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

## 12b. Capture stores a time, never a position

Photos, video and voice notes record `capturedAt` and nothing about where they
were taken. Where is derived on read, by asking the day's own track where you
were at that instant — `core/media`'s `placeMedia`, over `core/replay`.

This is § 4's decision applied again. Reading Core Location at the shutter would
mean a second consumer of the fix stream, a second answer to "where was I", and a
photo whose pin disagrees with the route drawn under it. It also means a photo
taken in a lift with no signal has _no_ position, which is the honest answer
rather than the last one that happened to be lying around.

The link from a capture to a timeline row is derived the same way
(`attachToSegments`) rather than written onto a segment. Segments are re-derived
from the fix buffer every time they are needed (§ 1); a stored link would orphan
every photo the first time a day was folded under a different config.

### The bytes: a container of their own

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
when the screen closes. Video capture is capped at 60 seconds because the bytes
are encrypted on the way in and decrypted again to play, and both passes are
something you would wait for at ten minutes.

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

## 13. UI: no navigation library, one fold for three tabs

Three tabs — Day, Capture, Settings — with one level of detail below each.
Capture takes the middle slot: it is the only tab that is a thing you _do_
rather than a thing you read.

It was five. "Today", "History" and "Replay" were all _look at a day_ — the same
stats, the same timeline, the same map — differing only in which day and whether
it moved. Three tabs meant three renderers of one thing, a Today that could not
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

This revises the decision twice over. It first read "three tabs need no router",
then four. The reasoning survives five tabs and one level of depth. It would not
survive a fifth level, deep links or modal routes, and at that point a router is
the right answer rather than a heavier one.

**Places lost its tab and is now a page under Settings.** iOS collapses a sixth
tab into a "More" list, which is worse than either choice available here, so
something had to give. Replay and Capture are things you _do_; Places is a
reference list you consult, and it keeps its full screen one tap away.

Every tab stays **mounted**, with the inactive ones hidden, and a detail page
renders _over_ its tab rather than replacing it. Both for the same reason: Today
holds a running recording and a timeline it just derived, and neither should be
lost because you opened a place you visited in March.

**The camera is the one exception**, and it is the exception that proves the
rule. `CaptureScreen` is told which tab is showing and mounts `CameraView` only
when it is the visible one. Keeping a capture session alive behind four hidden
screens costs battery, holds the hardware, and leaves the recording indicator lit
while you read Settings — the opposite of what "stays mounted" is protecting.

The hooks live in the shell rather than in the screens because they are shared —
the timeline needs the manual windows and the segmentation settings, Settings
needs the rejection counts the timeline produced, Places needs every segment ever
recorded, and media is written by Capture and read by Replay. Lifting them is
what keeps a single fold serving all five tabs. The player's selected day lives
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

**Map imagery by default.** The offline canvas is what a fresh install draws,
and it is not a degraded mode — it shows exactly what the app knows and invents
no streets around it. Apple Maps is one switch away and says what it costs. See
§ 12.

**Media in the Photos library.** Captures stay in this app's encrypted container
rather than the camera roll. The roll is synced to iCloud, which is precisely the
guarantee the vault exists to make — a photo attached to a location diary should
not be the one thing in it that leaves.

**A committed `ios/` directory.** `expo prebuild` regenerates it from
`app.config.ts` on every build, so it is output rather than source. Committing it
means the config and the native project can silently diverge. If custom native
code ever becomes necessary — the Core Motion module above, or the watch target
below — delete the two lines from `.gitignore` and commit `ios/` deliberately.

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
