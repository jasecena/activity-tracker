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

**Run `npm run verify` before finishing.** Typecheck, lint, format check and 929
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
on any screen that flow walks is a change to that flow** — Day, Capture, Media,
Notes, Settings and Raw data, which is all of them.

That wording is wider than it was, because the narrower version said "the Day
screen" and was read as being about the Day screen. **v0.9.0 failed on Raw
data**: a bare `assertVisible` for a backup button that sits below the counts,
so it was rendered and off screen. `scrollUntilVisible` first, every time, for
anything not at the top of a page — which is the same lesson the v0.2.0 release
taught when the Places row pushed "Raw data & export" under the tab bar, written
down twice now and learned the hard way both times.

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

**So the weight went with them.** Its only purpose was the calorie estimate, and
the Settings row said so — "used for the calorie estimate" — which became a
claim about the app that was no longer true the moment the tile went. A stale
sentence in Settings is the same class of mistake as the microphone permission
string that promised recordings were never uploaded, and this file has an
unhappy history with exactly that.

What stays is the **stored value**: `settings.weightKg` is still read, still
normalized, still defaulted, and `core/energy` is still pure and still has its
coverage gate. Only the control and its setter are gone. That is the cheap
direction to be wrong in — a calorie readout can come back as a screen without a
migration, whereas dropping the field would need one to put it back.

**That one bar is sticky.** It holds the only way to change day and the page is
long; arrows that scroll off the top mean scrolling back up to use them.

**A sticky header's style is applied to a wrapper, not to the element you wrote
it on, and this shipped a broken bar to a phone.** React Native's
`ScrollViewStickyHeader` puts `child.props.style` on its own `Animated.View` and
clones the child with `style={styles.fill}` — its comment says so: _"We transfer
the child style to the wrapper."_ So a `flexDirection: 'row'` written on the
sticky child lands one level **above** the children it was meant to arrange, and
the element actually holding them falls back to the default, **column**. The day
bar rendered as an arrow, a date and an arrow stacked down the screen, out of a
file whose style said `row` the whole time — and every cosmetic part of that
style worked, which is what made it look like anything but a layout bug.

So the sticky child is a plain wrapper carrying the ground and the padding, and
the row lives in a `View` inside it. **Anything laid out inside a sticky header
needs that extra level.** `flexWrap: 'nowrap'` does not help, because nothing is
wrapping — it is stacking, which is what a column does with three children.

The transfer is plain JavaScript, so it happens identically under Jest. The
regression test asserts on **the element that contains the controls** rather
than on a named style, which is the only version that could have caught this:
the style was real, correct, and attached to the wrong node.

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

**A note can be about a photograph, and the link lives on the note.**
`DayNote.mediaId`. Swipe up on a capture and the panel that already held its
facts, its map and Forget now holds what you wrote about it and a button to
write more; the note itself goes into the diary, under its own day, beside
everything else written that day. It is not stored on the capture and it is not
a second copy — this is the other end of one link.

**The two have separate lives, and putting the pointer on the note is what
makes that free.** Forget the photograph and the note stays; delete the note and
the photograph stays. No code enforces either: forgetting a capture touches the
media index and the file, and nothing in the diary is on that path; deleting a
note touches the diary and its own audio directory, and `sweepOrphans` and
`filesOf` never hear about it. Pointing the other way — a note id on the
`MediaItem` — would have made a note's existence a fact the sweep had to know.

So **a dangling id is an ordinary state rather than corruption**, and every
reader expects it. `normalizeDayNotes` neither validates nor repairs it, because
the picture being forgotten is how this is _meant_ to end up and dropping the id
would be the app deciding the note had stopped being about a photograph. The
sheet says the picture has been deleted rather than drawing an empty square, and
Forget's dialog says what survives — otherwise it reads as taking the words too.

**It cannot make a note on its own.** A title says the day, so does a paragraph,
so does half a minute of talking; a bare pointer at a photograph says only what
opening the photograph says. `noteAt` is unchanged, and a link-only note would
be a blank row in the diary with a thumbnail on it.

**Several notes per capture.** A line in the moment and a paragraph that evening
are two notes about one picture, which is how somebody actually uses this — one
note per capture would mean the second thing you wrote overwrote the first.

**The way there and back is two parameters, not a page.** The row in the diary
carries the thumbnail; the sheet carries it larger with a chevron; tapping it
sets the Media tab's focus and remembers the note, and the gallery grows a Back
chip for exactly as long as it is remembered. No stack entry, no route — the day
is already a parameter of one screen and a capture of another, which is the same
reasoning that keeps `usePageStack` an array and three functions. The chip is
the only chrome on that screen that comes and goes, which is what lets it exist
at all on a screen whose whole argument is that it has no header. Pressing any
tab abandons the journey, in the handler rather than an effect.

**There is no full-size picture inside the sheet**, deliberately: a second place
that draws a photograph is a second place to keep in step with the gallery's
gestures, orientation and transport. That drift is what retired `MediaScreen`.

**`MediaItem.note` is the superseded version of this and nothing writes it.**
It was a caption on the media row from the old detail page — visible in one
place, in no list, no export and no search. It is kept only because
`useAdoptVoiceCaptures` still reads it and dropping the field would silently
discard what an early build's owner typed. Do not build on it.

**A plan is a note that looks forwards, and it is a `kind` rather than a second
store.** The diary records what a day was; a plan records what you want to
happen — "start doing affirmations", "fix the backyard garden" — said out loud
so it is not lost. Both are a sentence somebody sat down and wrote, both are
unreconstructable, and both want the same title, body, recording and instant. So
`DayNote.kind` is `'note' | 'plan'` and nothing else about a note changes.

**A second store would have cost a third sweep.** `sweepNoteAudio` already keeps
the diary's recordings and `sweepOrphans` already deletes anything in the media
directory its index has never heard of — which is exactly the race that forced
note audio into a directory of its own. A third directory means a third index, a
third sweep and a third chance to delete somebody's recording on launch. One
field has none of that: the recording is already swept, already repaired by
`normalizeDayNotes`, already spared by retention, already in the CSV export and
already in the backup.

**Nothing in `core` reads the field except the filter.** `splitAtNow`,
`groupNotesByDay`, `noteAt` and the day arithmetic treat the two identically,
because which Tuesday an entry is about does not change with what it is for.
`notesOfKind` is the whole of it.

**The segment is the mode, which is why there is no separate toggle.** The Notes
tab carries a two-cell switch above the list — Notes on the left, Plans on the
right — and the list you are looking at is what the microphone writes into. The
first design had a switch beside the microphone and a tag on the rows, which was
two controls and a legend for one decision. This asks nothing before you speak:
you are already standing in one list or the other, and the press means what the
screen in front of you says it means. It is also the withdrawn Record button's
lesson kept — that control asked you to declare a journey before it had
happened.

**Changing list ends a recording rather than carrying it across.** The switch's
whole claim is that the list in front of you is the list you are writing into,
and a recording still running under the other one breaks exactly that —
invisibly, with the counter going while the screen says something else. The first
version let it run and filed it under wherever it started, which was consistent
and still wrong. Nothing is lost by stopping: `stop` saves what has been said and
files it, so this is finishing a recording early rather than discarding one, and
`confirmDestructive`'s bar is not met. Pressing the cell you are already on does
nothing at all.

**Which list the talking started in still lives in a ref, and the reason
changed.** It is no longer that somebody can switch mid-sentence — they cannot
any more. It is that `stop` flips `recording` before its first `await` and saves
behind it, so the handler runs _after_ `setKind` has already moved the screen.
Reading state there would file the recording under the list you just moved to.
Same shape as a capture's position, same failure if it goes. The regression test
presses Plans, records, presses Notes, and asserts the recording is still a plan
— and it fails against a version that reads the state, which is the only way that
test is worth keeping.

**Editing never changes what an entry is for.** The sheet collects words, an
instant and a recording and never asks about the kind, so `edit` takes it off the
note rather than defaulting — otherwise opening a plan and pressing Save would
move it silently into the diary.

**Everything before the field reads as a diary entry**, including a garbled
value. The safe direction is the one that cannot lose a row: an entry whose kind
cannot be read is still an entry, and the diary is where somebody would go
looking for it. Same direction a recording's `locked` defaults in.

**A plan goes to the bucket on its own, and it is the one thing in the app that
does.** `usePlanSync`. Everything else waits to be asked — a map is drawn while
you look at one, a recording is transcribed when you press Transcribe, the backup
goes when you press Back up — and this does not. What holds the line is that your
press still made the thing it sends: nothing already on the phone is swept into
it, the diary is never a candidate however it was written, and there is nothing
to send until you have filed something under Plans.

**Only the words leave.** The recording stays here — already swept by
`sweepNoteAudio`, already spared by retention, already in the ordinary backup —
and the thing reading the bucket reads text. `plans/<note-id>.json` holds the
title, the text, the instant and how long the recording ran, sealed under the
backup key and put with the same `putObject` the backup uses. A test asserts the
file name is not in the bytes, because that is the promise Settings makes.

**The one-way property is untouched, and that is why this shape was chosen.**
The app still has no unseal path and still never reads an object back. No new
IAM permission, no second key, no second bucket. A stolen phone can add to the
backup and still cannot open it.

**The key is the note's id, so a retry overwrites rather than duplicates**, and
what decides a re-send is a fingerprint of the payload rather than a flag —
editing a plan has to send it again and only its content knows that. The same
discipline as segment ids and the backup's own object naming.

**Two passes, and the first one is one-at-a-time.** A spoken plan has its words
fetched and appended to the note — `appendTranscript`, so nothing can overwrite
what somebody typed — and only then does it have anything to send. That write
goes through the notes store, which reads its list out of the closure it was
built in, so a loop would write every result over one snapshot and keep the
last. One per pass; the list changing brings the effect round again. Uploading
is a loop because it writes no notes.

**The record is only written when it changed, and a test suite that never
finished is what found that.** `record` is a dependency of the effect, so
setting it to a fresh object saying the same thing re-runs the effect, which
re-sends, which sets it again — a failed upload became an infinite loop against
the bucket.

**A queue nobody can see is a queue that fails silently.** `planQueueLine` puts
the count under the Plans switch, and says where to go when there is nowhere to
send them — a phone with no bucket would otherwise hold everything for ever and
look perfectly healthy. The last failure's own words are printed there too, the
same reasoning as the transcription error: there is no log, no crash reporter
and no telemetry to look it up in afterwards.

**Nothing is lost by a failure.** The note is saved long before any of this
starts, a failed transcription is not marked answered, a failed upload is not
recorded as sent, and both are tried again when the list next changes. A silent
recording _is_ marked answered, because asking again would be asking for ever.

**`networkNote` stopped saying "none of it happens on its own".** That was true
until this existed and would have been the third string in this app's history to
promise more protection than it provides. It names the exception instead:
everything but the Plans list waits to be asked.

**An agenda item is wired back to the recordings it came out of, both ways.**
One recording holds several items; one item is heard in several recordings. The
first direction was always there — a commitment carries the plan it was read
from. The second is `subject`, a hash of the normalised title with **no plan id
in it**, so the same thing said again a fortnight later lands on the same subject
instead of becoming an unrelated row nothing could ever join.

**The linkage is plan ids and nothing else, and that is what keeps the promise.**
A plan id _is_ a `DayNote` id — the phone named the object `plans/<note-id>.json`
when it sent it — so handing the id back lets the phone find its own note and,
through it, the audio on disk. **No file name ever leaves the device**, which is
what Settings says, and none is needed. `notesBehind` is the whole walk.

**Repetition is emphasis, and it is the one place that changes anything.** Said
three times over a fortnight is on somebody's mind in a way said once is not, and
nothing inside a single reading can see that. `mentionCount` orders the agenda
after urgency — a deadline still outranks it, because repetition is emphasis and
a date is a date — and the scheduler is told, so the model can weigh it too.

**One subject is one item however often it was said.** Showing it twice would be
the app treating repetition as more work rather than as more emphasis, which is
the opposite of what it means.

**Title matching is the floor and that is stated rather than implied.** "Fix the
backyard garden" said twice merges; "fix the garden" and "sort out the backyard"
do not, because nothing here understands they mean the same thing. Merging those
needs a pass comparing meanings rather than strings. What exists is the linkage
and the place to put a better answer, not the better answer.

**Nothing on the phone draws any of it yet.** It is carried, validated and kept
so that the day something wants it the link is already there rather than lost —
and a test walks it end to end, from an agenda item to the recording on disk.

**The agenda is the way back, and it is the only thing this app reads out of
the bucket.** The machine at home publishes `agenda/current.json` — what it
decided and, for a few of them, when — and the Plans list draws it above the
plans it was decided from. `core/agenda` parses it, `services/agenda.ts` fetches
it, and the format is documented **once**, in `server/planner/agenda.py`, beside
the code that writes it: a format described in two places is a format that
drifts.

**This narrowed a guarantee, and that is written down rather than discovered.**
`docs/BACKLOG.md` § 12 chose one-way so a stolen phone could add to the backup
and open none of it, and "the app has no unseal path at all" was half of what
made that true. `unsealWithKey` exists now, so the other half — the bucket
policy — is the whole of it: the phone may `GetObject` on `agenda/` and nothing
else, and that `Condition` block is load-bearing rather than tidy. What did
**not** change is that no key was added to the device: the agenda is sealed with
the key the phone already seals with.

**One object, replaced whole, never a log.** A phone that has been off for a
week asks once and has the current answer, and the two ends cannot disagree
about what has been applied — which is the class of bug a diff-based channel
exists to have.

**A bad item is dropped and the rest kept; a newer version is refused whole.**
Not the diary's rule, and the difference is the point: `normalizeDayNotes`
repairs because a note is unreconstructable, whereas nothing in an agenda is —
the truth is in Postgres at home, and a missing row lasts until the next
publish. Repairing one would mean inventing a decision nobody made. A version
this build does not know is refused entirely rather than half-read, because half
a screen confidently missing what the new version added is worse than the last
agenda that was understood.

**It is cached, because the machine at home sleeps.** It is a computer in a
house rather than a service, and a phone that showed nothing whenever it could
not reach the bucket would be useless exactly when somebody is away from their
desk. So the last agenda is kept and shown **with how old it is** — stale is
said, never hidden. The cache is never a source of truth and nothing is ever
written back to it.

**Refreshed when the list is first looked at, and on a press. Never on a
timer.** The plan upload had to be automatic because there is no press after a
recording that could carry it; a download has an obvious one — you are looking
at the list. A poll would be this app's second automatic request, and the first
one already had to be written into Settings as the exception.

**Nothing on that section is a control.** No accept, no decline, no
reschedule — the channel is one-way in this direction, and drawing a button that
only changed something locally would be the app pretending to a conversation it
is not having.

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

**"I was here the whole time" is a claim over a time range, and nothing is
deleted to honour it.** `core/segments/stationary.ts`. A phone sitting still
produces drift, drift produces spurious short moves, and an afternoon at one
desk comes out as stay/move/stay/move — but the case that justifies the feature
is the **hole**, where the phone reported nothing for two hours indoors. The
fold is forbidden to guess across a gap and should be; this is the one place
where the person who was there can say what the app may not infer.

**Decide from segments, apply to segments**, and that is what settled the shape
against deleting the middle fixes. Deleting is a documented trap on its own —
two fixes three hours apart describe a hole, not a stay, which is why
`core/compact` keeps a skeleton — but the argument that decided it is that a
**frozen day has no fixes left**: its segments are its record, so anything
working on fixes works only on today, and looking back at a finished afternoon
is exactly when somebody wants this. A folded day and a frozen one are both a
`Segment[]`, so one function serves both and neither reads the archive.

**The refusal is measured from the anchor, net of the reading error**, and both
halves of that matter. Not total path length: a phone jittering in one place for
an hour accumulates hundreds of metres without having been anywhere, which would
refuse the exact case the feature exists for. Not the straight line from first
to last: a walk round the block returns to where it started and is still a walk.
And the error comes off before the comparison — a stay carries its own measured
error in `radiusM`, a move gets the **effective** preset's `readingErrorM`, so a
battery-saver day is more forgiving than a balanced one. A fix seventy metres out
from a reading worth ±20 m is not evidence anybody walked seventy metres.

**A refusal says what it found.** "You went about 400 m away in the middle of
this" is an answer; a control that quietly does nothing is the failure the
transcription button already taught this app.

**Long-press a stay to start, tap the row you were still until; long-press the
merged row to undo.** One gesture, three meanings, told apart by what the row
_is_ rather than by a menu — a claim's row unmerges, a stay starts a merge, a
journey still corrects its activity type. A stay has no activity type, so the
last two never compete. The merged row **carries the claim's own id**, which is
the direct answer to the withdrawn merge feature's recorded objection that
"undoing meant finding the label behind a row by its id".

**The pick is a mode, so it says so and can be escaped**, by the banner's Cancel
or by pressing the anchor again. And it is **derived from the day on screen**
rather than cleared by an effect: `react-hooks/set-state-in-effect` is an error
here, and clearing on a day change would draw the new day once with the old
day's selection over it.

**Why you were somewhere is the stay's counterpart to a journey's name.**
`core/segments/visits.ts`. The engine knows you were at a coordinate for fifty
minutes; the place list knows the coordinate is called the shopping centre, and
it knows that _every time you go_. Only you can say this visit was for
groceries — which is precisely why it cannot live on the `Place`: Saturday's
haircut would overwrite Tuesday's groceries. So it is per-visit, and the visit
list under a place stops being a column of identical rows distinguished only by
date.

**It is not a `DayNote`, and the line is worth keeping sharp.** A diary entry is
about a _day_: filed in the diary by date, several per day, with a title, a
recording, a picture and a life of its own. A purpose is one line about one
stop, and its whole value is appearing beside that stop wherever the stop
appears — the timeline row, the visit list, the `label` column of the export.
Filing it in the diary would put it somewhere you have to go and look for it.

**Stored as a time range, applied over a re-derived timeline**, exactly as a
`JourneyLabel` is, and for the same reason: a different preset folds the same
fixes into different stays, so an id would be orphaned by a settings change.
`applyVisitPurposes` runs **after** the labels and the claims — it reshapes
nothing, so it has no opinion about their order and everything to gain from
seeing the final shape.

**The match is on the purpose's midpoint.** Three ordinary things re-cut the
timeline underneath a stored range — a claim merges stops, a label splits one, a
preset re-folds the lot — and an end-to-end comparison breaks under all three. A
midpoint lands inside exactly one of whatever the stays have become.

**Several purposes on one stay are joined, never dropped**, because that is what
a merge leaves behind: an afternoon that was three stops with three reasons.
And **writing one replaces everything the stop covers**, not just the record
with the matching id — otherwise the merged row would read as the new text with
the two old ones still joined onto it, and typing again would never clear it.
What a merge joins, an edit collapses.

**Edited in place on the stop's own page, saved on blur, deleted by emptying
the field.** No sheet: naming a place is a picker over candidates, this is one
line of free text, and the page it belongs to is the page you are already on.
No confirmation either — `confirmDestructive`'s bar is data nothing can
reconstruct, and the undo here is retyping the line where you are standing.

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

**The app makes exactly three kinds of network request, and only when you ask.**
This revises "exactly two", which revised "exactly one". There is still no
analytics, no telemetry, no crash reporting and no geocoder — that is still why
a place has no name until you type one — and the list is still enumerable in a
sentence, **which is the property worth defending rather than the number**.

The third is the largest by far and the rule survives it for one reason: it is
still a press. `docs/BACKLOG.md` § 12 is the whole design.

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
queue, a launch or a retry; and **the request carries the audio, the model, the
language and `enable_logging=false`, and nothing else** — not the note's words,
its title, its day or the position on it. The list is asserted as an
_equality_, because what that test defends against is a fifth field appearing.

**`enable_logging=false` asks them not to keep it, and asking is all it is.**
It is how Zero Retention Mode is requested on the speech-to-text endpoints;
their default retains both the audio and the text, with backups for up to thirty
days after a deletion. Their documentation describes ZRM as an enterprise
arrangement, so an ordinary account may ignore the field entirely — which is why
it is sent unconditionally and why **nothing in the app claims it worked**. The
Settings text says what the app _sends_ and never what the other end does with
it: a claim about somebody else's servers is not ours to print, and this file
has an unhappy history with strings that promised more protection than existed.
There is no account-level retention switch to set instead; that was checked.

**The third is the backup: the days that are over, to an S3 bucket you own.**
Sealed on the phone first — `services/backup/seal.ts`, ChaCha20-Poly1305 under a
key scrypt makes from a passphrase that is never stored — so the bucket holds
ciphertext and its operator holds nothing. **One way**: the app has no unseal
path at all and the bucket policy denies it every read of an object, so a stolen
phone with these credentials can add to the backup and cannot open it. What gets
data back is `scripts/unseal_backup.py`, on a laptop.

**Nothing is automatic, and previous days only.** A day that is over cannot
change, which is what makes it safe to send once; today is still being recorded.
A note written after a backup is not up there until the button is pressed again,
and the Data screen says exactly that rather than implying otherwise.

**The Settings paragraph is composed from a list now, not written per
combination.** Two switches were four sentences and three would be eight — eight
chances to leave one stale, in a file that has already shipped two claims
promising more protection than the app provided. A list cannot drift: a fourth
destination adds a line rather than doubling the prose.

App Transport Security stays fully enforced for all three.

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

`audioFocus.ts` is in the same directory and imports nothing at all. It is here
because it is the same **kind** of thing — the app's one handle on a device
resource, in a single file so there is one place to look for what can make a
sound — not because it wraps a module. The rule above still enumerates every
file that touches a native one.

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

**A recording can be locked, and the lock closes both doors at once.**
`NoteVoice.locked`. Recording over one already on a note has asked first since
the feature shipped — but a dialog is only ever as good as the attention paid to
it, and the audio is the one thing on a note that nothing can reconstruct: the
words survive a bad transcription, a voice survives nothing. So the padlock beside
the player is the stronger answer for the recording somebody is not willing to
lose. Locked, the microphone will not start **and** the delete button is not
offered — a lock that left a one-tap delete behind it would be decorative.

**Unlocking asks nothing**, and that asymmetry is the design: the lock is what
makes the destruction deliberate, so a confirmation on _undoing_ a guard would
be a dialog in front of the thing the control is for. Two acts to destroy, one
to allow — the shape swipe-to-delete on a note row already uses.

**The cost is stated and accepted: a locked note cannot gain a new recording.**
Nothing stands between anybody and saying something, because the microphone on
the Notes tab files a note of its own.

Two smaller rules travel with it. The record button is **disabled with a
reason** rather than absent — a string, so it reaches a screen reader — which
departs from the copy button's "absent rather than disabled" only because the
control that disabled it is lit directly beside it; a mic that vanished would
not explain itself. And `disabledReason` is ignored while recording, so nothing
can ever trap a running recording with no way to stop it. Everything arrives
**unlocked**, adopted captures included: a library that silently became
read-only on upgrade is the worse failure.

**Stopping is synchronous to the eye.** `stop` flips `recording` before its
first `await`, and the file is written behind the change. A control that waits
for a file system before admitting it was pressed is a control people press
twice — which is the very thing the hold existed to prevent, arriving through
the other door. Save is held shut for that fraction of a second instead, because
the note has no `voice` until the file lands.

**The recorder sits on the right of the row and playback on the left.** The
right is where the thumb is, and the recorder is the button reached for with
something to say; the player is only ever reached afterwards.

**The Notes tab is a pencil on a page, after a book and a journal both read
wrong.** `book-outline` says "something you read", which this is not — its
contents are the one thing nobody else wrote. `journal-outline` replaced it and
was worse: at 30 points it is a rounded rectangle with a stripe down one edge,
which is a credit card, and was reported as exactly that. The test an icon in
that bar has to pass is being recognisable beside a camera and a gallery, and
both book shapes fail it the same way — a closed rectangle, or a closed
rectangle with a line on it. A pencil is a **different silhouette** rather than
a differently decorated one, which is the reasoning the record button already
uses for a square over a second microphone in another colour.

It matches the pen in the tab's own header on purpose: both mean writing, and a
bar saying "this is where you write" above a button saying "write" is
consistent rather than duplicated.

**There are two microphones and they are the same act.** The one in the sheet
is for a note you are already writing; the one on the **Notes tab, bottom
centre and larger**, is for the moment you have something to say and no time to
sit down. It records and files the note itself — no sheet, no fields, no Save —
which is not a shortcut around the sheet but the sheet's own rule taken at its
word: any one of a title, a paragraph and a recording is a note, so a recording
alone needs nothing else collected before it can be filed. The pen stays in the
header for the other half. The list is the confirmation: the entry appears at
the top of today, where the eye already is.

The note is dated to **when the talking started**, not when the file landed —
those differ by however long the recording ran, and "when I said this" is the
honest answer. `useVoiceNote` hands the start instant to its callback for that;
the sheet ignores it, because there the instant belongs to the pickers.

**One recorder at a time, claimed inside `useVoiceNote` by an object identity.**
Both hooks are mounted at once — the shell hides inactive tabs rather than
unmounting them — so two recordings at once is the _default_ behaviour rather
than an edge case, exactly as two players were before `services/audioFocus.ts`.
The claim is taken **before the permission prompt**, since everything after it
is asynchronous, and given back on a refusal, a throw, a stop and an unmount.
The identity check on release is the same one the audio focus needs and for the
same reason. It is not a second module because this file is already the only
thing in the app that touches a recorder.

**A voice note stops itself after twenty minutes, and the cap is on recording
rather than on playback.** `MAX_VOICE_MS`, one number for both microphones. The distinction is the whole point of
the number: a limit applied where audio is read back is a silent truncation —
you talk for two hours, the app looks like it is listening for two hours, and
the loss is found afterwards, when there is nothing left to recover from. A
recording is unreconstructable in exactly the way a note is. So the recorder
stops at the limit, everything up to that point is kept and handed back through
the same `stop` a press goes through, and a dialog says it happened while its
owner is still in the room. The sheet also prints the ceiling while recording,
because being told before is better than being told after.

Twenty rather than none: a recorder with no ceiling, left running by accident, is
a phone filling its own disk with a pocket. Twenty rather than the video cap's
one: sixty seconds is the answer to forty megabytes a minute of 1080p, voice at
this preset is a fraction of that, and tying the two numbers together would be
one constraint answering somebody else's question.

The limit iOS imposes is separate and is **not** twenty minutes:
`UIBackgroundModes` holds `location` alone, deliberately, so backgrounding the
app ends a recording. The screen is held awake while recording, which covers the
auto-lock; it cannot cover the home gesture.

**A counter is not a summary, and one formatter was doing both.**
`formatDuration` rounds to the largest two units — "1h 24m", never "1h 24m 09s"
— because seconds are noise on a timeline row and make it jitter as it updates.
It was also printing the recording counter, so a voice note ticked 57s, 58s, 59s
and then sat on **"1m" for a full minute**. Reported from a phone as the recorder
having stopped counting, which is exactly what it looks like: the one part of the
screen whose job is to prove the microphone is still listening had stopped
moving, on the one control where there is nothing else to check it against.

The same string then went onto the finished note, so a recording of 1m47s was
labelled "1m" — the counter that appeared to freeze at a minute produced a
recording that claims to be a minute, and the two agree on a number that is
wrong. **That is worse than an idle counter: it is the app telling somebody the
rest of what they said was not kept.** Nothing was: `elapsedMs` and the stored
`durationMs` were right the whole time and only the display lied, which is why
every existing recording reads its true length now with no migration.

So `formatTimecode` — `0:07`, `1:47`, `1:02:33` — wherever a duration is
**advancing** or is **a recording's own length**: both microphones' counters, the
video badge, the player pill, the clip transport and its scrubber label.
`formatDuration` keeps every summary of a stretch of a day, where rounding is the
feature. Neither is a general-purpose duration formatter, and reaching for the
wrong one is not a cosmetic mistake — it reads as data loss.

The regression test that matters asserts **ninety seconds**, the middle of the
minute the old string could not see into, and the fixture behind the player's
was already 90 s asserting `1m`: the bug was written down as the expectation.

**Every sheet with a field in it is bounded, scrolls, and gets out of the
keyboard's way — and all three shipped without.** `NoteSheet`, `PlacePicker`,
`JourneyLabelSheet`. The last two had no `KeyboardAvoidingView` at all, so they
sat at the bottom of the screen with nothing between them and the keyboard:
naming a place meant typing a name you could not read, which is the worst
possible place for it, since a text field is the only reason that sheet opens.

**The shapes differ and the difference is deliberate.** `NoteSheet` and
`JourneyLabelSheet` are forms read top to bottom, so everything scrolls
together. `PlacePicker` is a list with the field pinned _beneath_ it — the thing
you are typing into must not be able to scroll away under your thumb — so only
the candidates scroll, which means the list needs `flexShrink: 1` and the field
block `flexShrink: 0`. Without that second half the sheet rides up correctly and
the candidate list, refusing to give up its height, pushes the name box out
through the bottom instead. That is the same bug wearing a different hat, and
fixing only the first looks like fixing both until somebody has a dozen named
places nearby.

**A plain scrolling page needs neither.** `SettingsScreen` has eight fields down
a long list and takes `automaticallyAdjustKeyboardInsets` — iOS's own inset,
which scrolls the focused field into view. The wrapper is for sheets, which are
anchored to the bottom rather than scrolling.

`src/__tests__/sheetLayout.ts` carries the rule and the tree walk for all of
them; each test asserts **containment**, and `PlacePicker`'s asserts the inverse
— that the field is _outside_ the scroller.

**The note sheet is bounded and it scrolls, and it shipped without either.** The
backdrop and the `KeyboardAvoidingView` were siblings and nothing capped their
sum, so once the fields, the recorder and the Transcribe row were all showing,
content plus a keyboard came to more than the screen: the backdrop was squeezed
to nothing, the sheet was laid out from y = 0 with its title over the status bar,
and its lower half spilled past a background that had stopped at the wrong
height, with the Notes list showing through the gaps.

It was reported as a glitch on returning from the lock screen, and that is
where the arithmetic is briefly at its worst rather than where the bug was —
iOS re-shows the keyboard and reports its frame before the window has settled,
so the padding is momentarily too large and then corrected. **The correction is
what made it look transient, and a layout that cannot overflow does not need
one.** The avoider fills the screen, the backdrop shrinks inside it, and the
sheet carries `maxHeight` with a `ScrollView` under it — which is the shape
`PlacePicker` has had all along.

The regression test asserts **containment**: the rows are inside the scroller
and something above it is capped. Same reasoning as the sticky day bar — a
correct style attached to the wrong node is what this class of test is for.

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

**One thing makes a noise at a time, and `services/audioFocus.ts` is the whole
of it.** A recording on a note row, the same recording in the sheet above it, a
clip in the gallery — they are deliberately unaware of each other and they are
mounted in different tabs that all stay alive at once, because the shell hides
inactive tabs rather than unmounting them. So two of them playing together is
the **default** behaviour rather than an edge case, and there is no common
ancestor to fix it in that is not the whole app. The module is one variable and
three functions: take it, release it, silence whoever holds it.

**The holder is identified by the function itself**, which is what makes
releasing exact. Silencing the previous holder runs its own cleanup, and that
cleanup arrives _after_ the new holder is in place — so a release that does not
check identity would have the interrupted player clear the claim of the one that
just interrupted it, leaving nothing to stop next time.

**Only what is audible takes the focus, and the caller judges that** rather than
this module inspecting a player. A muted clip is a moving picture: it starts on
its own when you swipe to it, and if that counted, swiping through the gallery
would silently stop a recording playing on the Notes tab and put nothing in its
place. The gallery derives `playing && !muted` from the player's own events
rather than wiring the buttons, so the transport, the speaker, the end of a clip
and the autoplay are all covered by one rule.

**Recording silences playback outright**, after the permission prompt rather
than before it — the microphone would otherwise record the other recording, and
a refused prompt should not stop playback for a recording that never starts.

**Leaving a tab silences it too, and that is the shell's rule rather than any
player's.** Every tab stays mounted with the inactive ones hidden — deliberate,
so a switch cannot throw away a running recording or a timeline just derived —
and the price is a player that carries on behind a screen nobody is looking at,
with its pause button a tab away. `TabShell` silences in the **cleanup** of an
effect keyed on the tab, so it belongs to the tab being _left_ and nothing
happens on first mount. Only a tab change counts: a note opened in the sheet, or
a segment over the day, is a page above the same tab — still the screen you were
on, still the thing you were listening to.

**A clip that plays out rewinds and stays stopped, and that is the opposite of
what the voice-note player does.** `loop` is false, so a finished clip otherwise
sits on its last frame with the scrubber hard against the right-hand end, and
the next press of play resumes from there and finishes instantly — a control
that appears to do nothing twice before the third press starts the clip, which
is the exact bug the audio player's `atEnd` rewind exists to prevent.

The difference is the **scrubber**. A position nobody can see is a decision that
can wait until somebody asks for it again, which is why the pill rewinds on the
press; a bar pinned against the end is the screen saying the clip is over and
stuck, so that reset happens the moment it finishes and play means play from the
start. `seekBy` rather than assigning `currentTime`, per the immutability rule —
muting remains the one property assignment, because it has no method.

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
