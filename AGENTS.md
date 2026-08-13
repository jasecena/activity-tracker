# Expo HAS CHANGED

Read the exact versioned docs at https://docs.expo.dev/versions/v57.0.0/ before writing any code.

# Project conventions

**iPhone only.** `platforms: ['ios']`. Do not add Android or web targets.

**`src/core` is pure TypeScript.** No React, React Native, Expo or `src/services`
imports — ESLint enforces this. The `core` Jest project compiles it with nothing
but `@babel/preset-typescript`, so any new dependency there breaks the suite.
That is intentional: it is how a location app is testable on a Linux runner that
is not, and never will be, moving. Every core domain (`geo`, `segments`, `day`,
`format`, `places`, `energy`, `replay`, `media`, `power`, `export`, `compact`) has its own coverage gate. `core` also reads no
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

**Run `npm run verify` before finishing.** Typecheck, lint, format check and 804
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

**Anything that erases something its owner made asks first — recording over an
existing recording included**, since the new file replaces the old one and the
old one is deleted on save. Recording onto a note with nothing on it asks
nothing: there is nothing to lose, and a dialog there is a dialog in front of
the thing the button is for.
`confirmDestructive` is one function rather than a habit, because the rule is
easy to state and easy to forget at the call site that matters — three places
deleted without asking (a note, a recording on a note, the name given to a
journey) and each was written by somebody who knew the rule. The bar is **data
its owner made**, not "an action that changes something": a fix or a segment
would not qualify, because the app collected those and can collect them again.

**The multipart part for a recording is a real `File`, not `{ uri, name, type }`.**
That object is the old React Native idiom and every guide still shows it; Expo's
`fetch` is WinterCG-compliant and its `FormData` rejects it with `Unsupported
FormDataPart implementation`, thrown while the body is assembled — so it arrives
as a _failed request_ rather than a type error and reads on a device as "no
connection". `expo-file-system`'s `File` implements `Blob`, streams from disk,
and carries its own name and type.

This is also the case for the on-screen raw error. The failure was undiagnosable
from a laptop: no log, no crash reporter, no telemetry, and a generic message. It
was found in one attempt once the service's own words were printed under the
button — see `docs/BACKLOG.md` § 16, which asks for that as a general facility
rather than a per-feature afterthought.

**A note in a list is a heading, not the entry.** The title, or the first line
where there is no title, and the recording's play button. Printing every note in
full was right when a day held one and wrong once days hold several: the section
became a wall of text to scroll past, and "which note is which" was buried in it.

**A `Section`'s accessibility label is its name; the count is its accessibility
_value_.** iOS collapses a labelled element's children, so the count cannot be
its own node — and folding it into the label would make the only handle on the
control change whenever the contents do, which the Maestro flow matches
whole-string. VoiceOver reads the value after the label, so nothing is lost.

**The smoke flow has to open a collapsed section before asserting into it, and
forgetting that failed the v0.6.2 release.** The sections shipped, the Jest suite
was updated for them, `.maestro/smoke.yaml` was not — so it asserted on text that
had become rendered-but-invisible. Jest cannot tell those apart and Maestro can,
which is the entire reason the smoke test exists. **A change to what is visible
on the Day screen is a change to that flow.**

**The Day screen has no header bar.** It used to carry one — a title, a subtitle
counting journeys and stops, a Today button and a calendar button — directly
above a second row holding the day arrows and the same date. Two bars of chrome
saying overlapping things, above a map that is the reason for the page.
Everything the header did now lives where it was already implied: **the date is
the title**, **tapping the date is the calendar** (an icon beside a date is the
same thing twice, and the date is the bigger target), and **pressing the Day tab
is the Today button**. The subtitle went entirely, and each section heading
carries its own count now.

**The three stat tiles went too — distance, moving time and calories.** They
were the last of the chrome above the map, and they answered a question this
app is not for: a day is where you were and what you wrote about it, not a
score out of three. A watch already counts these, counts them better, and
counts them all day rather than only while an app is open. What they cost was
the top of the page on the one screen whose reason for existing is below them.

The consequence to keep in view: `core/energy` and `settings.weightKg` now have
no reader. Both are kept rather than deleted — `core/energy` is pure and has a
coverage gate, and the weight is one number in a store that would be awkward to
put back — but the Settings row still says the weight is "used for the calorie
estimate", which is now nothing. That is a claim about the app that is no
longer true, which this file has an unhappy history of.

**That one bar is sticky.** It holds the only way to change day and the page is
long; arrows that scroll off the top mean scrolling back up to use them.

**It is three cells that cannot wrap, and the gaps belong to nobody.** Arrow,
date, arrow, with `flexWrap: 'nowrap'`, arrows that never shrink and a date that
gives up its width first — so a long date truncates rather than pushing a
control onto a second line, which is what was reported from a phone. The arrows
are 44 points with `ARROW_SLOP` beyond that, and the date keeps `DEAD_STRIP`
either side: **the slop must stay smaller than the strip**, so an enlarged
target never reaches into the date's. The asymmetry of the mistake is the
reason — a press that walks a day by accident is one press back, and a press
that opens the day list by accident is a page in your face.

**The Day screen goes map, player, notes, timeline — in that order, and the
player is against the map.** The player drives the map, so anything between them
detaches the scrubber from the thing it scrubs, which is what a notes section
wedged in there did. Notes and the timeline are `Section`s: **collapsed by
default**, with a count in the heading, because a page holding four things each
worth a screen is a page you scroll rather than read. The count is what makes
collapsing safe — it hides the contents without hiding that there are any.

**A transcript is appended to a note, never written over it.** `appendTranscript`
puts the text under whatever was there, so a bad transcription costs a paragraph
deleted by hand and no press of a button can eat something its owner wrote.
Transcribing twice appends twice, on purpose — a second attempt at a misheard
name is a normal thing to want. It lands in the sheet's **draft**, so Save is the
approval rather than a second confirmation, and a note that was only a recording
gets no separator because that is the ordinary case for the feature rather than
an edge of it.

**The diary is its own tab, and the Day screen no longer carries notes.** A note
was filed under the day it was about and reached by walking to that day, which
`docs/BACKLOG.md` already called "fine for a week and not for a year". It is one
list now — every note, **newest first**, grouped by the day it is about, because
a diary is still indexed by the date. `groupNotesByDay` does that arithmetic in
`core`; `notesForDay` remains for anything that wants one day forwards. The same
rows in two places would be two things to keep in step and one always slightly
wrong, which is the reasoning that retired `MediaScreen`.

A row is a **heading and a play button** — the title, or the first line where
there is no title. The whole entry is one tap away in the sheet, which is also
the only place it can be edited.

**A note may be dated ahead, and the ones that are sit in a dashed box at the
top.** Preparing for something — a meeting next week, added to over the days
before it — is the same act as writing about a Tuesday that has been, and the
date picker never had a maximum, so it was already possible to make one and
then never find it again: a note about next Thursday sorted below a note about
this morning, three hundred rows down a list that reads backwards. `splitAtNow`
cuts the diary at now, and the two halves read in **opposite directions** —
what has happened runs backwards from now, what has not runs forwards to the
next thing, so both put the entry nearest to now first. The boundary counts as
behind: a note stamped exactly now is about the moment it was written.

**Dashed rather than a colour or a badge.** An outline that is not solid reads
as "not settled yet" without needing a legend, and it survives greyscale and
colourblindness in a way a tint does not.

The same cut is why `daysWorthOpening` filters to `at <= now`. It builds the
list of days the Day screen can walk, `days[0]` is what that screen calls
today, and a note about next Thursday would otherwise make next Thursday
today — an app claiming to have data from a day that has not happened.

**A note is the one thing here that is not derived from anything.** Every other
row on a timeline is the fold's reading of a fix stream; none of it can say what
the day was _like_ or who you were with. `core/day/notes.ts` — several per day,
each with an optional title, a body and a recording, stamped with the moment it
is about and shown in **their own tab**, in date order. Never rows on a
timeline: a timeline is a record of where the phone was minute by minute, and a
sentence threaded through it arrives as another reading the app took. A diary is
indexed by the date; the time is a detail within the day.
**Any one of the three alone is a note**: a title says the day ("Moved house"), so
does a paragraph nobody wanted to name, and so does half a minute of talking with
neither — requiring more would be the app deciding how somebody keeps a diary.
Titles arrived after the first notes did and recordings after those, which is why
`normalizeDayNotes` requires none of them in particular: insisting on the field
that happened to come first would discard every entry made of the ones that came
later. **Retention never deletes one**, which is the rule
captures already draw: a fix is something the app collected on its own and may
discard on its own, a note is something you sat down and wrote. So a day can
outlive its own readings as a sentence about what happened.

Two consequences follow from it being unreconstructable. `normalizeDayNotes`
**repairs rather than drops** wherever it can — an id no build ever wrote is
rebuilt from the instant, and a recording that has lost its duration is still a
recording you can play, because a malformed fix can go when thousands more are
coming and a sentence about a Tuesday cannot. The one field with no repair
available is the recording's **file name**, which a service joins onto a
directory: `isStoredFileName` is the same check the media index uses. And it is
the fourth CSV: an app whose argument is that your data is yours cannot be the
one place your own writing is trapped — which is why a spoken entry exports the
name and length of its recording rather than a blank row with a time on it.

The instant is **chosen, with a default**. `whereToWrite` answers now for today
and the end of the day for one already over; the sheet offers a compact date and
time picker over the top, because when something is written down and when it
happened are routinely different. Ids come from the instant, so `freeInstant`
nudges a collision forward a millisecond — without it the second note about a
finished day would silently replace the first, since both want the same default.

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

**Stationary runs are compacted, and the two halves get different shapes.**
`core/compact` throws away readings that say nothing the readings beside them do
not. It only ever removes: nothing is rewritten or invented, which is what keeps
the raw export honest. What leaves for the archive keeps **only its two ends**,
in a **60 m** circle, because nothing folds those again. What stays in the buffer
keeps a **skeleton**, one reading per `gapMs / 3`, in a **25 m** circle, because
today is re-derived on every refresh and the rule above is unforgiving: delete
the middle of a three-hour stay and the fold sees two lonely fixes an hour apart,
so the stay becomes a hole and the cleanup has eaten an afternoon. Naive deletion
is not a smaller buffer, it is a different day. A run is measured from its
**first** fix, never the previous one, or metre-at-a-time drift is followed
across a car park. The trigger is the freeze, automatically — this app coarsens
and maintains itself rather than handing its owner a Clean Up button.

**The radius must exceed the tracking preset's distance filter, and this cost a
release to learn.** iOS delivers a location update only once the phone has moved
further than the filter from the last one, so consecutive fixes are already that
far apart: a radius at or under it means every fix starts a new run, no run holds
a third, and compaction is arithmetically incapable of dropping anything. Both
halves shipped at `pathResolutionM` — 25 m, exactly the balanced preset's filter
— and did nothing on a phone while every test passed, because the fixtures sample
a stationary phone every ten seconds and this app never does. The archive is
`minMoveDistanceM` (60 m) now. The buffer keeps 25 m on purpose: a wide circle
absorbs the start of a departure and under-counts movement confined inside it,
which costs nothing where nothing folds again and costs today's timeline where it
does.

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

**Media is the exception, and this revises what used to stand here.** Photos and
video are stored as ordinary files under `Documents/media`; a voice note is a
note now, so its file sits in `Documents/note-audio` under the same rules —
plain, backup-excluded, swept by its own store. Two directories, because
`sweepOrphans` deletes anything in the media one its index has never heard of.
They used to be sealed into a chunked container of their own under the same
key, and the reasoning was consistent — but iOS already encrypts the container
with a key derived from the passcode, so the second pass bought very little
against a stolen phone and cost every read: forty megabytes of pure-JavaScript
AEAD, on the one thread that also draws the screen, before anything could be
looked at. The gallery was unusable and the cause was entirely self-inflicted.

What that layer really protected was a **backup**: the key is
`THIS_DEVICE_ONLY`, so a restored backup held ciphertext. That was given up for
one release and has been bought back without the cipher — `Documents/media`
carries `NSURLIsExcludedFromBackupKey`, so the files are never copied into a
backup at all — and so does `Documents/note-audio`. Not being there beats being
there unreadable, and it costs
nothing on the read path, which was the entire complaint against the container.
Encryption still belongs at the boundary where data actually leaves the phone —
the sync that is coming — and the bytes get sealed on the way out.

The flag has no JavaScript API in `expo-file-system`, so it is the second local
native module: `modules/file-backup`, one Swift function, applied from
`ensureDirectory` on **every** write rather than once at creation. That is
deliberate and it is the migration — a library written before the flag existed
has an unflagged directory and there is no launch step that would find it — and
the Swift reads the current value before writing so the repeats cost a
`getattr`. The price is that a capture does not survive a lost phone, which is
the same property everything the vault covers already has, and is what makes
the S3 sync the backlog item that matters most.

**Erase everything deletes the plaintext first, then the key, then the rows.**
Ordering can only protect what is not already protected, and the files on disk
are now the only thing a crash halfway through could leave readable — destroying
the key does nothing to a JPEG, and nothing to a voice note either.
`eraseAllMedia` and `eraseAllNoteAudio` are both synchronous, so they complete
before the first `await` and there is no window at all. This reverses the rule that
used to stand: key first, so dying halfway left ciphertext. That was right while
media was sealed under the same key and wrong the moment it wasn't.

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

**The app makes exactly two kinds of network request, and only when you ask.**
This revises "exactly one", which held until transcription shipped. There is
still no analytics, no telemetry, no crash reporting and no geocoder — that is
still why a place has no name until you type one — and the list is still
enumerable in a sentence, which is the property worth defending rather than the
number.

The first is **Apple Maps imagery**, behind `settings.mapsEnabled`, **off on a
fresh install**. Your track is never sent: it is an overlay drawn on the device.
With it off, every map is the offline canvas in `components/MapCanvas.tsx`, which
is also the only file that may import `expo-maps`.

The second is **one voice note to ElevenLabs**, and it is heavier than the first
because it is a recording of the app's owner rather than a region of a map.
`services/transcribe.ts` is the only file that knows the endpoint exists. Three
properties hold it down, and all three are asserted in tests rather than merely
intended: **an empty `settings.transcriptionKey` is the only gate**, so a fresh
install cannot transcribe at all and clearing the field withdraws the feature;
**nothing is automatic**, so a recording is uploaded on a press and never by a
queue, a launch or a retry; and **the request carries the audio, the model and
the language and nothing else** — not the note's words, its title, its day or the
position on it.

App Transport Security stays fully enforced for both.

**Every claim about this is state-dependent now, and that is a trap.** The
Settings paragraph reads four ways (`networkNote`), and the microphone
permission string stopped saying "never uploaded" — it was true through v0.5.3
and false the moment a key could be entered. The v0.4.0 audit found this exact
failure twice, both times in the direction of claiming more protection than the
app provided; a third time would be in a string somebody reads once, at a
permission prompt, while deciding whether to trust the app.

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

**A five-second "live" capture was built and withdrawn, and the kind is still
readable.** It recorded forwards from the shutter because `expo-camera` has no
rolling buffer, and it was not what a Live Photo is. `normalizeMedia` reads the
retired kind as `video`, which is what it always was on disk — a clip and a
still. Dropping the kind outright would have dropped the row, and `sweepOrphans`
would have deleted the file on the next launch: somebody's capture gone for a
feature being taken away.

**A capture is two files, and everything that walks the directory must know
it.** `sweepOrphans` deletes sealed files the index has never heard of, and
being told only about the captures meant it deleted every thumbnail on the
following launch — invisibly, since the gallery just drew nothing. Build the
list with `filesOf`. Captures stored before thumbnails existed are given one on
the next launch, after the index settles, one at a time.

The tracking switch governs what the app records **on its own**. Pressing the
shutter is not the app acting on its own.

**Retention deletes days and fixes, never captures.** `retentionDays` reaches
the day log and the fix archive and stops there, so "keep 30 days" does not mean
what it sounds like once there are photographs — and the asymmetry is the point
rather than an oversight. It is the line the tracking switch already draws: a
fix is something the app collected on its own and may discard on its own, a
capture is something you chose to take. Deleting the second on a timer is not
the app's call, and with media excluded from backups there is now no copy
anywhere to recover from until the sync exists.

What was wrong was that nothing said so. The retention picker states it now,
because captures are also the **only store in the app with no bound on them** —
a minute of 1080p is forty megabytes, so a handful of clips outweigh a year of
archived fixes. `formatBytes` exists so the total on the Data screen stays
readable that far up: it was `bytes / 1024` labelled `kB`, wrong in both
directions and illegible at exactly the size where it starts to matter. It
counts in powers of ten so the figure agrees with iPhone Storage.

**The player stops at a hole; it never slides across one.** `positionAt` returns
null wherever the fixes stopped and the screen says "No signal". An icon gliding
smoothly through two hours indoors is the four-kilometre walk through a building
that the segmenter already refuses to draw.

**The background task appends fixes and does nothing else.** It has seconds to
live and can be killed at any point. Everything else the app knows how to do can
be redone later from those fixes; nothing can recover a fix that was never
written because the handler was busy segmenting the last one.

**A day exists whether or not the app recorded anything on it.** `groupByDay`
builds its list from segments, so `daysWorthOpening` adds the days that have
only a note, and today. Without it a day with no readings has no arrow, no page
and nowhere to write — failing on a fresh install and on a day spent somewhere
with no signal, which are the two days most worth a sentence rather than a
measurement.

**A note can be copied out, and the pasteboard is write-only.**
`services/clipboard.ts` writes and never reads — reading raises a system prompt
on iOS and hands the app whatever its owner last copied from somewhere else,
which is a thing a diary has no business seeing. The button sits in the body
field's own top-right corner, absent rather than disabled while there is nothing
to copy, and the tick means "this text is on the pasteboard" — so editing makes
it false, which is why it needs no timer to undo it. Until item 17 exists this is
how a transcript reaches anything else.

**Native modules live behind `src/services`.** `location.ts`, `vault.ts`,
`storage.ts`, `battery.ts`, `mediaStore.ts`, `noteAudio.ts`, `transcribe.ts` and
`clipboard.ts` are the only files importing an Expo native module.
Feature code builds values and hands them over.

The exception is a native module that _is_ a view, or a hook over a native
object a service cannot build and hand over: `expo-camera` in `CaptureScreen`,
`expo-maps` in `MapCanvas`, `@react-native-community/datetimepicker` in
`NoteSheet`, `expo-audio`'s player in `components/VoiceNotePlayer` and its
recorder in `features/notes/hooks/useVoiceNote`. One file each, and that is the rule — the point of the boundary
is that there is a single place to look, not that the import lives in a
particular directory.

**No navigation library.** Five tabs — Day, Capture, Media, Notes, Settings — and
one level of detail below each. **Five is the ceiling**: iOS collapses a sixth
into a "More" list, which is why Places is a page under Settings. Capture and Media take the two middle slots: one is
the only tab that is an action rather than a view, the other the only one you
open to _look_ at something rather than read it.

**One screen shows a day, and it defaults to today.** "Today", "History" and
"Replay" were all _look at a day_, differing only in which one and whether it
moved — three renderers of one thing, a Today that could not show yesterday and
a History that could not show today. The day is a parameter now; arrows walk
backwards and the full list is a page under it.

**Pressing the tab you are already on goes home.** Every detail page above it
closes, and on Day the day itself returns to today — the day is a parameter of
one screen rather than a page of its own, so "the root of the Day tab" and
"today" are the same place. A press on a tab you are _not_ on only switches to
it: moving about is not asking to go home.

This replaces a double-press inside a 300 ms window, and the simplification came
from deleting the Day screen's Today button — with the button gone this _is_ the
way back to today, so it has to be the obvious gesture rather than a hidden one.
It is also what every other iOS app does. The cost is that a stray press on the
current tab loses the day you were looking at, which is one tap to recover
through the date.

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
tabs exist to look at a picture. Controls float over it: the counter at the
top, the filmstrip along the bottom, the mode rail down one edge and the zoom
wheel over the shutter. Only the empty gallery keeps a heading, because there
is nothing behind it to look at.

**Zoom is three buttons — 0.5, 1 and 3 — and the numbers behind them are real.**
A wheel you turned with a finger was built, refined over four releases and
withdrawn: it was never reliably better than tapping a lens, and the gesture
cost more than the control was worth. What survives is the part that was always
sound — `modules/camera-optics`, one Swift file reading what AVFoundation knows
and Expo does not pass on, so the stops sit exactly where the lenses take over
(`virtualDeviceSwitchOverVideoZoomFactors`) and the millimetres are derived
from each lens's measured field of view rather than looked up.

The dial drives the **virtual** camera (Triple, or Dual Wide), and that is the
difference between a zoom and a crop: the default device is the bare wide lens
and cannot reach the ultra-wide at all.

Two number spaces run through `core/media/optics.ts`: device factors, where 1.0
is the widest lens and AVFoundation speaks, and display factors, where 1× is the
main lens and a person speaks. They differ by the wide lens's switch-over
factor, and confusing them puts every number out by exactly 2×.

**The value goes through `expo-camera`'s own `zoom` prop**, which its Swift
raises the running format's `videoMaxZoomFactor` to the power of — so
`zoomPropFor` inverts it exactly. Read the Swift, not the docs: the published
formula is the older linear one and is wrong for this version. The description
is re-read when the mode changes, because photo and video run different formats
and the exponent's base changes with them.

**What the withdrawn wheel taught, kept so it is not re-learned.** `CameraView`
interfering with touches on iOS is an accepted expo bug (expo#28966); zoom not
applying is an open one (expo#33279); and the wider advice — expo#11032,
VisionCamera's own guide — is that camera zoom should not be driven from React
state at all. A `PanResponder` rebuilt each render closes over that render, so
a gesture re-granted mid-drag runs an older closure and reverts to its base;
the shutter being a `Pressable` means only a _capture_-phase handler can take a
drag off it. Any future gesture over this camera meets all three.

**Correcting a journey's activity type is a long press, not a swipe.** A row on
a vertically scrolling list has to hand a horizontal drag back to the scroller
often enough that a swipe is unreliable by nature — reported from a phone as
simply not working — and a correction that only sometimes happens is worse than
a menu that always does. `SegmentRow` already had `onLongPress`; the gesture
component built for this is gone.

**That rule is about `PanResponder`, and the Notes tab is the exception that
proves what it was really saying.** Swipe-to-delete there is
`react-native-gesture-handler`, whose recognisers are native and negotiate with
the scroll view through the platform's own failure and simultaneity
relationships — the thing the responder system cannot express, and the reason
UIKit's own swipe actions feel reliable where a hand-rolled one does not. So:
**a horizontal gesture on a vertical list needs the library, or it needs to be a
long press.** Never a third `PanResponder` attempt.

`GestureHandlerRootView` wraps the whole app in `App.tsx` rather than the one
screen using it: the library installs its touch handling at the root, and a
gesture inside a subtree it does not own never fires. The legacy `Swipeable` is
imported deliberately — the `ReanimatedSwipeable` replacement would pull in
`react-native-reanimated`, a babel plugin and a worklets runtime, for one row
action.

**Deleting a note is a swipe on the Notes tab, and nowhere else.** The sheet's
"Delete this note" text button is gone: a row of red text under a form is a
worse place for it than the row itself, and the swipe reveals a button rather
than deleting — so it is two deliberate acts and a confirmation for something
nothing can reconstruct. Deleting a _recording_ stays in the sheet, because that
is where the recording is.

**The zoom is measured from the start of each gesture, never accumulated.**
Adding deltas per movement drifts, and it means letting go and repeating the
same movement from the same place gives a different answer the second time.

**A voice note is a note, and it is recorded inside the note sheet.** This
revises the decision that used to stand here twice over — it was the camera's
third mode, then a button beside the pen on the Day screen — and both earlier
versions filed a recording by the hardware it came out of rather than by what it
is. Saying something about a day and writing it down are one act with two hands:
the same entry, at the same instant, on the same day, with a title if it wants
one. So `voice` is a **field of `DayNote`**, the bytes go to
`services/noteAudio.ts`, and the microphone lives under the fields in
`NoteSheet` — record, then type under it, or type and then add a sentence aloud,
and it is still one note. Item 15 in `docs/BACKLOG.md` is the test of that: a
transcript belongs _on the note_, beside what was typed, and that is only simple
to build if the recording was never a row of its own. Capture has two modes.

Four consequences, each of which cost something to get right:

**A separate directory, `Documents/note-audio`, not the media one.**
`sweepOrphans` deletes any file in the media directory the media index has never
heard of, on launch, as soon as that index settles — and a recording referenced
only from the notes is by definition a file it has never heard of. Two stores,
two directories, two sweeps: the race stops existing rather than being timed
correctly. `sweepNoteAudio` is the diary's own, and it runs only against a diary
that has actually loaded, because an empty list means "not read yet" rather than
"no notes".

**Nothing shows a recording in the Media tab, and the old ones move.**
`capturesOnly` is what the gallery, the map and the Data screen mean by a
capture. Hiding a row is not the same as moving it, so
`useAdoptVoiceCaptures` turns every voice note an earlier build filed as a
capture into a note holding the same recording — one at a time, because both
stores read their list out of the closure they were built in and a loop would
write five notes over one snapshot.

**Tap to start, tap to stop, and the hold-to-record ring was withdrawn after
being used.** The ring was a one-second hold that filled an arc before recording
began, built so an accidental double tap could not become a recording that
started and stopped. It worked, and it was still wrong: it taxed the deliberate
case every single time to prevent an occasional mistake, and the tax was a
second of holding still and watching an arc on the one control whose whole job
is to be pressed the moment you have something to say. No duration tunes that
away — it is the shape that is wrong.

What prevents the double tap now is the **glyph changing** — a microphone
becomes a square — so the state survives a glance, a greyscale screen and a
colourblind reader. Colour moves with it as a second signal and nothing depends
on it. `RecordButton` is deliberately dumb: it renders the state it is handed
and calls one of two callbacks.

**Stopping is synchronous to the eye.** `stop` flips `recording` before its
first `await`, and the file is written behind the change. A control that waits
for a file system before admitting it was pressed is a control people press
twice — which is the very thing the hold existed to prevent, arriving through
the other door. Save is held shut for that fraction of a second instead, because
the note has no `voice` until the file lands.

**The recorder sits on the right of the row and playback on the left.** The
right is where the thumb is, and the recorder is the button reached for with
something to say; the player is only ever reached afterwards.

**The two things that were hard-won on the camera screen survive both moves:**
the position is read at the **start** and kept in a **ref** (`stop` resolves
inside a closure created before the reading arrived, so as state it is null then
and null for ever after), and the screen is held awake on **busy** rather than
on recording, so the hold does not drop between stopping and saving.

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

**A video in the gallery starts muted, and the speaker is a first-class
control.** It plays as soon as you swipe to it, which is right — you swiped to
it — but sound arriving unasked is a different thing from a picture that does:
it carries into the room. So `muted` is set in the `useVideoPlayer` setup and
the transport carries a speaker beside the play button, both at 48 points
because they are the two things pressed one-handed over a moving picture.
Different glyphs rather than one in two colours, as the record button does it.

Muting is the **one `eslint-disable` in `src`**, and it is justified where it
sits: the immutability rule is right in general — it is why the scrubber calls
`seekBy` instead of assigning `currentTime` — but `expo-video` documents the
property assignment _as_ the mute API, so there is no method to call. A
`VideoPlayer` is a handle to a native object rather than a value to replace,
which is the case the rule does not model. The write lives in the component that
_created_ the player; `ClipControls` takes a callback, because a write to a prop
is a different and worse thing.

**A video plays under the app's own transport, never AVKit's.** The reason is
touch routing rather than appearance: `nativeControls` sit in a native view
that consumes every drag beginning on them, so no gesture of the gallery's —
the swipe up for details, the swipe down to the grid — could start over a
playing video. The controls are `ClipControls`: play/pause, the same `Scrubber`
the replay screen drags through a day, and the two times. AirPlay,
picture-in-picture and system captions went with the native controls,
knowingly — none of the three earns the touch routing back for a diary's own
clips. `timeUpdateEventInterval` must be set on the player or `timeUpdate`
never fires and the scrubber is a still image of zero.

**A capture has one screen, and the gestures are the Photos gestures.** The
detail page is gone — the gallery absorbed it. Swipe up and everything the app
knows about the capture rises under it: the fields, the map with the capture
pinned to the spot, Forget. Swipe down and every day's captures arrive as a
grid, newest first, where tapping a thumbnail lands the pager on it. The Day
timeline's captures are small thumbnails now, and tapping one switches to the
Media tab focused on that capture — one screen that shows a capture rather
than two drifting apart, which is what retiring `MediaScreen` bought. The ⋯
went with it, at its owner's suggestion: the swipe is the affordance.

The vertical gesture can be reliable where the timeline swipe could not, and
the difference is structural rather than a better threshold: the pager
underneath scrolls _horizontally_, so a decisively vertical drag has no other
claimant. Its two decisions are exported from `verticalIntent.ts` and tested
directly, per `SwipeBackPage`'s precedent.

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

**Measuring the app must not become a second way of recording its owner.**
`services/timing.ts` is the instrumentation the performance audits rank by, and
it is in memory, this session only, capped, and shown on the Data screen. Three
rules hold it there. **A span name says a shape, never a content** — a duration,
a count and a byte size are facts about the machine, while a coordinate, a place
name, a note or a capture's file name are the diary; `fold (4200 fixes)` is a
measurement and `stay at Home 2h` would be an entry. This is why a store read
records `read archived day` rather than the key, which carries a date its owner
had data on. **Nothing goes to `console`** — that is the vector that actually
exists, and it is not the network: device logs are readable through Console.app
and are swept into a sysdiagnose, which is a bundle a person deliberately sends
to Apple, so a printed span has left the sandbox and a held one has not. And
**nothing is persisted or exported**, the CSV included, because that one goes
through the share sheet.

No analytics SDK can satisfy any of this, and the enumerable-requests rule
already forbids the thing that would otherwise be reached for — the list of what
leaves the phone is two entries long and each one is a deliberate press. Most of what the
remaining audits need ships nothing at all: Instruments, the Hermes sampling
profiler and the RN performance monitor attach from outside, cost the release
binary nothing, and never leave the Mac. In-app spans are for what a profiler
cannot name — it hands you a stack, not "the fold took 340 ms for 4,200 fixes".

**Durations are measured with `monotonicNow`, never `now`.** The wall clock is
corrected — iOS pulls it back into line with the network — and a correction
landing inside a measurement produces a duration wrong by however far the clock
moved, including a negative one that sorts straight to the top of "what was
slow". The reverse holds just as firmly: a _fix_ is stamped with the wall clock,
because which day it belongs to is a wall-clock fact and monotonic time has no
answer to "which Tuesday". `timing.test.ts` makes `now` throw, so a module that
reaches for the wrong clock fails rather than passing quietly.

**An instrument must cost less than what it measures.** `record` pushes rather
than rebuilding the array, takes the count as a number so `labelOf` formats only
the rows actually drawn, and checks the cap before the caller has done work
that would be discarded. The Data screen calls `measuredSpans()` once per
render, not once per reference — it sorts a copy, and calling it twice was the
instrument being the overhead.

**The Jest suite is pinned to UTC** in `jest.config.js`, before the workers fork.
A "day" is a wall-clock concept, so without it `jest.setSystemTime` means a
different date depending on where the machine is.

# Known limits

**Core Motion's activity classifier is not available.**
`CMMotionActivityManager` — the thing that reports "walking"/"automotive" with a
confidence — has no Expo binding and needs a custom native module. That barrier
is procedural now rather than structural: `modules/camera-optics` establishes
the local-native-module pattern, so binding it is a file in `modules/` when
something wants it, not a change of project shape. Mode is
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
that just ended, compacted on the way in. **Never one blob**: a single entry means every freeze reads the
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

**CSV export is built; GPX is not.** Three files rather than one — raw fixes,
route points, the timeline — because the app holds three genuinely different
things and flattening them loses the distinction. `core/export` builds the bytes
so a test can assert them, and `services/exportFile.ts` hands the result to the
share sheet, which is not a network request. GPX per activity is still to come,
on demand and never automatic; `services/dayLog.ts` stores a plain array of
`Segment` precisely so that stays straightforward.

**Keep the Expo patch versions in step, and check the audit is still readable.**
`npm run verify` does not run either: `npx expo-doctor` and `npx audit-ci
--config audit-ci.jsonc` are CI's job, and both were red on every push for days
— doctor over six patch releases that had moved upstream, the audit over two
advisories with no fixed version published anywhere. A check that cannot pass
is one nobody reads. `audit-ci` exists so an advisory can be _reviewed_ rather
than merely ignored; every entry in the allowlist names why, and a stale one
fails the build rather than passing quietly.

**An Expo package nothing imports is not necessarily unused: it may be a
required peer dependency.** `expo-font` and `expo-asset` appear in no `import`
anywhere in this repository and are in `package.json` deliberately —
`@expo/vector-icons` needs the first, `expo-audio` the second. They were
removed in a dead-code sweep on the reasoning that npm installs them
transitively anyway, and `npm run verify` passed: nothing imports them, so
nothing broke on Linux. `expo-doctor` failed on the next push, and its wording
is the rule worth keeping — _native module peer dependencies must be installed
directly_. Transitive resolution is not the same contract, and the failure this
avoids is a crash on a device rather than an error in CI.

So a package with no importer is a question for `npx expo-doctor`, not a
conclusion. This is the second entry here about a check `verify` cannot run;
both cost a red build to learn.

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
