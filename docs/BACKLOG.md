# Backlog

Features agreed for later, written down before they are built so the thinking
survives the wait. Ordered roughly by how they unlock each other, not by priority
— priorities get decided when work starts.

Every item carries a **Status**. `Not started` means exactly that: the thinking
is here and no code is. Anything else says what happened or what is in the way.

---

## Where the app is, as of v0.4.2 (10 August 2026)

Everything through the capture work has shipped to TestFlight: the four-tab
shell, the day screen with history and replay, places and journey labels, the
encrypted store, CSV export, the low-battery lens, the Media tab with the Photos
gestures, capture orientation, and the three-stop zoom on real lens optics.

**The diary shipped in v0.5.1, and it was never an item in this file** — it was
asked for directly and built the same day. Notes on a day, several per day, each
with a title, and a date and time you can change; v0.5.2 moved them out of the
timeline into a section of their own and put the voice recorder beside the pen.
v0.5.3 finished that thought: **a voice note is a note**, not a capture. The
recording is a field of `DayNote`, the recorder lives inside the note sheet
behind a one-second hold, the bytes sit in the diary's own directory, and
recordings made while a voice note was a capture are adopted into notes on
launch. Reasoning in `docs/ARCHITECTURE.md` § 10a; the thing to know before
touching it is that it is the only store here that nothing can reconstruct, which
is why retention never reaches it and why its trust boundary repairs rather than
drops.

**Item 9 is built and is the first feature in this file to be.** Everything
before it in the recent releases was correctness, privacy and pipeline work.
Stationary runs are compacted on the freeze — endpoints into the archive, a
skeleton in the live buffer — which closes the half of the storage audit that
was left open. Nothing else here has been started.

### The releases behind that

**v0.3.0** — no feature. The release where the documents were brought back in
line with the app and the code left by withdrawn features was deleted: the spent
coordinate migration, a third of the Swift, and the smaller residue three sweeps
turned up.

**v0.4.0 — the audit release**, and a minor rather than a patch for one reason:
captures no longer enter an iCloud or iTunes backup. That is a change to what
leaves the phone, it runs one way, and a device restored from a backup taken
after it comes back without them. It is also what makes item 12 the item that
matters most, because until the sync exists a lost phone is the end of a
photograph.

**v0.4.1** — the Data screen says whether the backup exclusion is actually
holding. The flag has no user-visible effect until someone restores a backup, and
`excludeFromBackup` returns `false` rather than throwing when the native module
is missing — so without the row, the failure mode is a healthy app whose Settings
paragraph claims something untrue.

**v0.4.2** — the launch path is measured, so the lag hunt has data to rank.

1.0.0 stays deliberately unspent. It belongs to the sync or the segment model,
not to a tidy-up.

### What the audits found

Four of the seven ran — privacy, security, CI/CD, storage — all of the kind that
needs no device. What they mostly found was **drift between the documents and the
code** rather than broken behaviour: the app was doing the right thing and saying
something slightly better than the truth about it, which in an app whose whole
argument is its privacy posture is the failure that matters. The Settings
paragraph still claimed captures were sealed under the keychain key a release
after they stopped being; the permission strings promised they were never
uploaded while sitting in a backed-up directory.

Three real defects came with them: the vault could not survive a corrupt keychain
entry (it bricked writing, silently and permanently), `destroyKey` could be
undone by an in-flight key generation, and `normalizeMedia` accepted a path where
it required a name. Reasoning in `SECURITY.md` and `docs/ARCHITECTURE.md` § 12b.

### Open actions, not features

| Action                                       | State                                                                      |
| -------------------------------------------- | -------------------------------------------------------------------------- |
| Confirm `Kept out of backups: Yes` on device | **Open.** Needs v0.4.2 installed. Settings → Data.                         |
| Performance audit + lag hunt (item 6, 7)     | **Ready to run.** Needs a few days of real use, then read the Data screen. |
| Memory audit (item 7)                        | **Blocked.** Instruments, therefore a Mac.                                 |
| CPU audit (item 7)                           | **Blocked.** Instruments, therefore a Mac.                                 |
| CodeQL over the Swift (item 13)              | **Deferred.** Revisit when item 1–4's composition module exists.           |
| Recheck the `audit-ci` allowlist (item 14)   | **Standing.** When `image-size` publishes past 2.0.2.                      |

### Built and withdrawn

Written up in `docs/ARCHITECTURE.md` rather than here, because withdrawing is a
decision and not an absence: the pan-to-zoom wheel (§ 16) and the five-second
"live" capture (§ 16). Neither should be rebuilt without reading why it went.

---

## The shared foundation: a recording is a list of segments

Four of these features — pause/resume, the live rewind, transitions, live
editing in general — are the same architectural decision wearing different
buttons: **a video stops being one file produced by one long `recordAsync` and
becomes a list of segment files composed into one clip on save.**

- _Pause_ closes a segment. _Resume_ starts the next.
- _Rewind and cut_ is reviewing the just-closed segment and trimming its tail
  before the next one starts — nothing is ever edited "inside" a recording,
  because a segment boundary is always there to edit at.
- _A transition_ is a property of the boundary between two segments, marked by
  a button press at recording time.
- _Save_ composes segments and boundaries into one file, automatically. The
  editing all happened live; there is no editing session afterwards, which is
  the point.

The composition itself — trim, concatenate, crossfade — is `AVMutableComposition`
and `AVAssetExportSession`, which Expo does not expose. That is a third local
native module in the `modules/camera-optics` and `modules/file-backup` mould: one
Swift file, one job (compose segment files into one movie), everything decidable
in TypeScript and testable there, with the native side doing only what only it
can do.

Worth knowing before starting: an in-progress QuickTime file is unreadable —
the moov atom is written at stop — so "go back three seconds _while still
recording_" is not buildable on any API. The segment model is the honest
version: pausing is what makes the just-recorded tail reviewable, and the
review happens between segments. That matches how it was asked for ("I pause,
go back, and then resume, and it cuts to that stage").

---

## 1. Pause and resume a recording

**Status:** not started. Needs a device to verify.

`expo-camera` already has `toggleRecordingAsync()` — "pauses or resumes the
video recording" — so a minimal version needs no native work at all: one clip,
paused and resumed, with the shutter row growing a pause control while
recording. The segment model supersedes this eventually, but the cheap version
is real and could ship alone.

Decisions when built: what the elapsed clock does while paused (stop, clearly);
whether max duration counts wall time or recorded time (recorded).

## 2. The live rewind ("time frame viewer")

**Status:** not started. Depends on the segment model.

While paused: scrub through what was just recorded, pick a moment, and resume —
the clip continues from that moment, the discarded tail gone. On the segment
model this is: preview the closed segment (it is a complete file the instant it
closes), scrub with the existing `Scrubber`, trim via the composition module,
open the next segment on resume.

Smoothness lives and dies on the preview being a real player over a real file,
which the segment model gives for free — `expo-video` can seek a closed
segment like any clip.

## 3. Transitions, marked live

**Status:** not started. Depends on the composition module.

A button press during recording (or while paused) marks the current boundary:
"put a transition here". The mark is data — `{ boundaryIndex, kind }` — and
the composition module applies it on save. Hard cuts are free; crossfade and
dissolve are `AVMutableVideoComposition` work in the same native file. Start
with cut and one crossfade; a transition picker is creep until proven wanted.

## 4. Live editing, generally

**Status:** a principle, not a task. Nothing to build; everything to test against.

The principle the above three add up to, kept as a principle: **every editing
decision is expressible while shooting, and saving composes automatically.**
No timeline editor after the fact, ever — that is a different app. Anything
proposed later for "editing" gets tested against this: if it cannot be decided
live with one button, it does not belong here.

## 5. Teleprompter

**Status:** not started. Pure TypeScript, but UI-heavy — buildable without
hardware, only partly provable without it.

A text box near the camera — top of the screen, where the front lens is, so
reading and looking into the lens are the same direction — that scrolls a fed
script at a controlled pace, with a start delay. It rotates with the device
using the existing `CaptureOrientation` infrastructure (the controls already
turn; the prompter turns with them).

Pure TypeScript: no native work, no new permission. Pieces: a place to paste
and keep scripts (the encrypted store, like everything else), a scroll rate
that can be nudged mid-read, and the box's position clamping so it never
covers the viewfinder's centre. The only genuinely fiddly part is rotation —
a text box that must stay near the _lens_ has to move when the phone turns,
not just turn in place; `topEdgeFor` already answers which edge that is.

## 6. Lag hunt

**Status:** instrumented and ready to run. The measuring is done; the measuring
_with real data_ is not, and that needs a few days of ordinary use.

Investigation, not a feature: find where the app actually stutters on the
phone, with the JS thread as prime suspect. Known candidates, from the
architecture rather than from measurement (measurement is the task):

- **Compaction, on every timeline refresh.** **Done —** `compact buffer` and
  `compact archived day` record the number of readings dropped, and only when
  some were, so the Data screen answers "is this doing anything on a real phone"
  without waiting for a freeze. A row that never appears is the finding.
- **The launch path: index normalisation, orphan sweep, thumbnail backfill.**
  **Done —** all three record a span with the count they ran over, so the Data
  screen answers this one without a cable. `sweepOrphans` is the one to watch: it
  walks the whole media directory and stats every file, and it runs before the
  gallery can draw anything.
- **Opening a day: the fold** runs on the JS thread while the page animates —
  exactly the case `SwipeBackPage` runs its animation natively for. **Done —**
  recorded as `fold`, with the number of fixes.
- ~~The thumbnail decrypt queue behind a fast scroll.~~ **Gone, not deferred.**
  This described the sealed container, and the container was withdrawn:
  `openThumbnail` is now an existence check and a URI. There is no decryption
  anywhere on the read path, so there is no queue to be behind. Left visible
  rather than deleted, because "we should look at the decrypt queue" is exactly
  the kind of thing that gets repeated from a stale list.
- **The offline map canvas re-projecting on every scrub tick.** **Open**, and
  deliberately **not** instrumented in-app: a span per frame would add work to
  the frame path being measured and fill a 120-entry cap in about two seconds.
  This one belongs to the RN performance monitor, which counts dropped frames
  from outside.

Method: the Data screen's spans for anything with a count attached, and the RN
performance monitor or Instruments for anything per-frame. Fixes follow
measurements, not hunches — and the split above is the rule from
`services/timing.ts` applied: an instrument must cost less than what it
measures, so per-frame work is measured from outside the frame.

## 7. The audits

A family of them, each producing numbers or findings first and a ranked fix
list second — the deliverable is the ranking, so the work that follows is
spent where the evidence says, not where the code looks guilty.

- **Performance** — _open, ready._ The lag hunt widened: startup time, frame
  drops, the JS thread under load, worst day of data available. Needs use, not
  hardware.
- **Memory** — _blocked on a Mac._ Footprint with a year of days, the gallery
  under a long scroll, leaks across tab switches and long sessions.
- **CPU** — _blocked on a Mac._ What burns cycles while tracking runs all day;
  the background task's budget; anything hot while the screen is off.
- **Storage** — **done (v0.4.0).** Found the one unbounded store: retention
  reaches the day log and the fix archive and stops, so captures grow forever.
  Kept that on purpose — a fix is collected by the app, a capture is chosen by
  you — but the retention picker now says so, and `formatBytes` keeps the total
  legible past a gigabyte. The remaining half — bounding the archive — is item 9,
  and is now built.
- **Privacy** — **done (v0.4.0).** Behaviour was clean: no network calls in
  `src/` at all, no telemetry, `expo-maps` imported in exactly one file and off
  by default, ATS enforced. The claims were not: fixed, plus media excluded from
  backups via `modules/file-backup`.
- **Security** — **done (v0.4.0).** Cipher, nonce and keychain flags all as
  documented; `unsealInPlace` is the best-defended code in the app. Three defects
  at the edges, all fixed. The file protection class is now written down as a
  deliberate default rather than an accident.
- **CI/CD and pipeline** — **done (v0.4.0).** Better than most: every action
  SHA-pinned with a job enforcing it, `contents: read` throughout, no
  `pull_request_target`, secrets via `env` and never interpolated into a shell,
  Maestro checksum-verified, an ephemeral signing keychain torn down under
  `always()`. Two changes: the Pods cache lost its `restore-keys` fallback so a
  release binary is a function of its tag, and the smoke test gained one retry on
  a flow failure after a dropped tap blocked v0.4.0.

## 8. Save a capture to the iPhone photo library

**Status:** not started. Needs a device to verify.

The other direction from the parked import: a photo or video, exported from
this app's store into Photos. `expo-media-library`'s `saveToLibraryAsync` does
exactly this and needs only the add-only permission
(`NSPhotoLibraryAddUsageDescription`), which is the mild one — no read access,
no library browsing, just "may this app add".

Two things to hold onto when building it. It is **per capture and on demand**
— a button on the capture's info panel, never a sync — because the store is
kept off backups and out of the camera roll precisely so captures do not sit
in places this app does not control, and putting one into Photos is the
deliberate, visible exception. And what lands in Photos is a copy: forgetting
the capture here afterwards does not reach into the library, same shape as the
import rule in reverse.

## 9. Compact the stationary fixes

**Status: built.** `core/compact`, applied from `pruneBuffer`. The storage audit's
remaining half is closed: the archive is bounded now by something other than
retention. Reasoning in `docs/ARCHITECTURE.md` § 10.

What shipped is what is described below, with two things worth recording because
they were decided while building rather than before it.

**A run is measured from its first reading, not the previous one.** Both were
plausible; only one survives a slow amble. Drifting a few metres at a time leaves
the circle after a handful of readings and ends the run, where a
previous-reading test follows the drift across a car park and compacts a walk
down to its two endpoints.

**The radius has to clear the distance filter, and getting that wrong made the
whole thing inert.** It shipped first at `pathResolutionM` — 25 m, which is
exactly the balanced preset's `distanceInterval`. iOS only delivers an update
once the phone has moved further than the filter from the last one, so
consecutive readings are already that far apart and every one of them started a
run of its own. Nothing was ever dropped, and every test passed, because the
fixtures sample a stationary phone every ten seconds and this app never does —
its distance filter is the whole battery argument. The archive is
`minMoveDistanceM` (60 m) now; the buffer keeps 25 m deliberately, because it is
the half that is folded again. The lesson generalises past this item: a threshold
in `core` that happens to equal a sampling interval in `services` is a coincidence
worth checking, and `core` cannot see it.

**"The fold's stay comes out identical" was too strong, and the honest version is
better.** What holds is that every reading outside a run survives, both ends of
every run survive, and no spacing is created that was not already there — a
reading is kept as soon as the _next_ one would put the gap past the hold. What
does not hold is byte-identical segments: jitter inside the radius can accumulate
enough path length to have been emitted as a phantom move, and compaction takes
that with it. 60 m of wandering inside a 25 m circle is a desk, so the timeline is
better off — but it is a change, not a no-op, and the tests say what they actually
check.

**What it does not do: reach a day already archived.** `pruneBuffer` only writes
the key of a day that has readings leaving the buffer, and once a day is frozen
nothing prunes into it again — so everything archived by an earlier build stays
exactly the size it was, and only days frozen from here on are thinned. Deliberate
for now, and the shape it wants when it is wanted: a `compactArchive()` walking
archived day keys oldest-first, **a handful of days per launch**, with a stored
marker of how far it has got. One day at a time is not optional — reading and
rewriting a year of sealed days in one pass on the thread that draws the screen
is the 120 MB failure the per-day key design exists to avoid, self-inflicted at
launch. Compaction is idempotent, so a lost or stale marker costs a repeat and
never damage.

The original write-up follows, since the reasoning is what made it buildable.

---

**Status when written:** not started, and the best-placed item to build next — it
is entirely `src/core` and `services`, so it is testable on Linux with no device
and no Mac. It is also the unfinished half of the storage audit: the archive is
the growth term nothing bounds.

An afternoon at a desk is hundreds of readings at the same spot at zero speed,
and they say one thing between them: _here, from then until then_. Keeping the
first and last — the arrival and the departure — says it just as well, and the
rest is exactly the "non-necessary data" this app should not be hoarding.

**The trap, recorded here so nobody builds the obvious version:** the timeline
is re-derived from the fix buffer, and _a gap is a hole, never a straight
line_ — no fix for `gapMs` closes whatever is open and the day simply stops.
Delete the middle of a three-hour stay from the live buffer and the fold sees
two lonely fixes an hour apart: the stay becomes a hole, and the cleanup has
eaten an afternoon. Naive deletion is not a smaller buffer, it is a different
day.

So compaction has two safe shapes, by where the fixes live:

- **The archive: compact fully.** A frozen day's segments are its record and
  nothing re-folds archived fixes — the architecture guarantees it ("nothing
  reads the archive to build a timeline"). Collapsing a zero-speed run to its
  endpoints there is pure disk saving with no one downstream to disturb. This
  is also where the work naturally lives: `pruneBuffer` already visits every
  fix at freeze time, so compaction is a filter in a pass that already runs.
- **The live buffer: keep a skeleton.** Today still gets re-folded, so a
  stationary run must keep one fix per interval comfortably inside `gapMs` —
  still a huge reduction (a reading every few minutes instead of hundreds),
  and the fold's stay comes out identical. Endpoint-only is never safe here.

The trigger should be the freeze, automatically — the moment the user himself
suggested. A cleanup button is a chore the app assigns its owner, and this
app's house style is that it coarsens and maintains itself (the battery lens,
the merges dropped on launch, the archive trimmed on the log's own cutoff).
Regularity comes free: freezing already happens daily.

Zero-speed should be judged from consecutive positions, not the platform's
speed estimate, for the reason already settled: Doppler speed lies for seconds
after stopping. The cluster test is the same arithmetic `judgeFix` and the
stay machine already trust.

**One thing to prove before shipping it:** exporting raw fixes must still
produce what the exporter promises. A compacted archive is a smaller CSV by
design, and the difference between "smaller because the readings were
redundant" and "smaller because a bug ate them" has to be visible in a test.

## 10. The assumed stay: bridging a gap whose two ends agree

**Status:** not started. Also pure `src/core`, so also buildable without
hardware — but it revises a settled decision, so `docs/ARCHITECTURE.md` changes
with it rather than around it.

When the signal stops and later returns _at the same place_ — the last fix
before the hole and the first fix after it within about twenty-five metres —
the honest reading is that the whole silence was spent there. Two hours of
nothing between two readings in the same kitchen is not a mystery; it is an
afternoon indoors, which is exactly when phones go quiet.

This bends a settled decision and must be built as a revision to it, not an
exception smuggled past it. _A gap is a hole, never a straight line_ exists
because the path through a gap is unknowable — interpolating drew
four-kilometre walks through buildings. But this is not interpolation of a
path: it is an inference of _absence of travel_, made only when both ends
agree on the place, and its strength is real (going somewhere and coming back
to within 25 m, timed exactly inside the silence, is possible but contrived).
The reasoning in `docs/ARCHITECTURE.md` changes with it, per the house rule.

Two requirements are the feature:

- **It is derived, never stored.** An assumed stay is the fold's reading of
  the gap, produced at derivation time like every other segment — nothing
  writes an inferred fix into the buffer, because a fabricated reading in the
  raw data is indistinguishable from a real one forever after. The buffer
  stays honest; the lens does the assuming.
- **It is visibly an assumption.** Its own flag on the segment
  (`inferred: true` or a kind of its own), its own colour on the timeline and
  the map, its own wording ("probably here"). The user's phrasing is the spec:
  _it could be a different colour, so we know we assumed this — it's not
  fact._ An assumed stay that looks like a measured one is a lie about the
  data; the entire legitimacy of the feature is in the marking.

Details for when it is built: the 25 m test should respect the two fixes'
accuracy circles rather than centre-to-centre alone; the replay player should
sit the cursor at the place through the gap rather than saying "No signal"
(marked, again, as assumed); and the day's totals must not count inferred time
as measured stillness anywhere the distinction could matter — calories already
count movement only, so they are safe by construction.

**Interaction with item 9, which is now built and therefore first.** Compaction
makes stationary runs sparser, and an assumed stay reads a gap. Compact too
aggressively in the live buffer and an ordinary afternoon at a desk starts
looking like a gap whose ends agree — inferred rather than measured, for time
that was measured perfectly well. The skeleton rule prevents it: no spacing is
created that was not already there, and the hold is `gapMs / 3`. This item is the
one that has to prove it, so it needs a test that compacts a long stationary run
and asserts no assumed stay comes out of it.

## 11. Rotating a video

**Status:** not started. Depends on the composition module from items 1–4.

A photograph rotates by re-encoding one JPEG — cheap, and lossless enough at
full quality. A video cannot: decoding and re-encoding every frame costs
minutes, real quality and a great deal of battery, for a picture that was
already correct in every respect but one.

The right mechanism is the **preferred transform** — a rotation recorded in the
file's metadata that every player honours, touching no pixels at all. That is
`AVMutableComposition` work, which is the same native module items 1 to 4
already need, so it belongs with that rather than bolted on beside the photo
button. Until then the Rotate control is offered for photographs only, which is
why it checks the kind rather than hiding a failure.

## 12. Backup and sync, to an S3 bucket

**Status:** not started, and the item that matters most. Media is excluded from
backups as of v0.4.0, so a lost phone is now the end of a photograph — the
guarantee this replaces has no substitute until this exists.

The store, backed up off the phone — the item the architecture has been
waiting for: media encryption moved to files precisely because "encryption
belongs at the boundary where data actually leaves the phone — the sync that
is coming — and the bytes get sealed on the way out". This is that sync.

Direction so far, superseding the earlier parked note: the destination is an
S3 bucket rather than a hosted service. Everything is sealed client-side
before upload under keys that never leave the device's keychain family, so
the bucket holds ciphertext and its operator holds nothing. Decisions when
work starts: bucket credentials on device (scoped, write-mostly), what the
restore story is on a new phone (the key is THIS_DEVICE_ONLY today — restore
is the hard half of this feature, not upload), scheduling (manual first),
and what the one-network-request rule becomes — this widens it far more than
Apple Maps tiles did, and the reasoning must be rewritten with it.

Two things the audits left specifically for this item:

- **Key handling gets revisited here, not before.** `deviceKey` currently
  replaces an unreadable key rather than keeping it, which is right while there
  is nothing behind it to lose and nowhere to re-encrypt to. Restore changes
  both halves of that sentence.
- **The restore path is what makes `normalizeMedia`'s strictness load-bearing.**
  A media index arriving from off the phone is untrusted input in a way a local
  one never was — that is why file names are now required to be names rather
  than paths, and the check exists before the path that needs it.

## 13. CodeQL over the Swift

**Status:** deferred, deliberately. Trigger: the composition module.

`security.yml` runs CodeQL with `languages: javascript-typescript`, so neither
local native module is analysed by anything. Today that is ~120 lines across
`camera-optics` and `file-backup`, mostly reading AVFoundation properties and
one filesystem attribute — and CodeQL's Swift support needs a real build on a
macOS runner, which is meaningful CI minutes for a small surface.

The composition module in items 1–4 is what changes the trade: it does real file
manipulation, and that is worth scanning. Turn it on with that, not before.

## 14. Recheck the dependency-audit allowlist

**Status:** standing. Trigger: `image-size` publishing past 2.0.2.

`audit-ci.jsonc` allowlists two advisories against `image-size` ≤ 2.0.2 —
infinite loops in the ICNS, JXL and HEIF parsers. Reachable only through metro,
at bundle time, over files in this repository; nothing from a phone or a network
reaches it and none of it is in the shipped binary. 2.0.2 is the latest published
version and the advisory covers every release up to it, so there is nothing to
upgrade to.

The allowlist fails the build on a **stale** entry, so this is self-reminding
rather than a chore: when `image-size` publishes a fix, `audit-ci` starts
complaining about an entry that no longer applies. That is the signal to remove
it, not a date in a calendar.

## 15. Transcribing a voice note

**Status:** not started, and designed rather than sketched — the service is
chosen, the numbers behind the choice are below, and the decisions that would
otherwise be made twice have been made once. It is the second item in this file
that widens the one-network-request rule, and unlike item 12 it does so for
something the app could live without, so the reasoning has to be better rather
than merely present.

A voice note is currently a recording you can play and nothing else. Transcribed,
it becomes something you can skim, search, and eventually hand to an LLM to write
a day up from — which is the point. **The audio stays the record**; the text is a
reading of it, in the same sense that a `JourneyLabel` is a reading of a journey
rather than a replacement for the fixes underneath.

**Most of the shape of this is already settled**, because v0.5.3 made a voice note
a field of `DayNote` rather than a capture of its own. A transcript is another
field beside it — the raw text, the cleaned-up text and the corrected text on the
note that holds the recording — so there is no join, no second store, and no
question about which day it belongs to. What is left is genuinely the queue and
the request.

### The service: ElevenLabs Scribe v2

Chosen on Persian accuracy alone, which is the requirement that matters:

| Benchmark                     | Scribe v2 | For comparison                      |
| ----------------------------- | --------- | ----------------------------------- |
| FLEURS Persian                | **3.1%**  | beats Gemini and Whisper on Persian |
| Common Voice Persian          | 5.5%      |                                     |
| Persian–English code-switched | 13.2%     | lowest of any system tested         |
| Overall (all languages)       | 2.3%      | Gemini 3 Pro 2.9%, Whisper behind   |

The alternative worth naming is Whisper, hosted on Groq at roughly a tenth the
price. It was the first choice and it is the wrong one here: a Persian
**fine-tuned** Whisper reaches about 13–14% WER on clean Persian, so Scribe is
some four times better out of the box than the best Whisper option is after
work. At this volume the price difference is cents a month, so it buys nothing.

**Persian only, and the language is pinned rather than detected.** Declaring the
language stops the model hedging and is most of the distance between the 13.2%
and 3.1% figures. The cost is that an English word spoken mid-sentence comes back
transliterated into Persian script rather than as English — accepted, because the
recordings this is for are entirely Persian. The multilingual mode is the same
service and one parameter away if that changes.

**Store the language code with each transcript**, and make it a setting rather
than a constant. That is the whole cost of being able to switch services or
languages later without a migration, and it is close to free now.

### Shape

**Not live.** Record, hand off, carry on; the text arrives later and you can edit
it when it does. Batch is both cheaper and more accurate than streaming, so
nothing is given up.

**Segment timestamps are enough.** Word-level is available and unneeded — the
transcript gets reviewed by hand.

**Three layers of text, and the raw one is kept.** What the service heard, what
an LLM cleaned up, and what you corrected are three different things. Keeping the
first means a bad LLM pass is recoverable and a re-transcribe can never silently
eat a correction. The grammar pass is a later step and a cheap one —
`claude-haiku-4-5` is ample for it, at fractions of a cent per note.

**The queue is the engineering, not the API call.** "Upload in the background and
come back" has to survive suspension mid-upload, being offline when the recording
ends, and the request failing outright. That is the same shape the fix buffer
already solves by writing first and deriving later, and it is where this feature
will break if it breaks.

**Diarization is decoupled and deferred.** Who spoke when can come from a second
pass whose speaker segments are mapped onto the transcript by time — but Scribe
carries diarization in the same model, so the second system may never be needed.
Worth knowing before it is built: diarization degrades on **overlapping** speech
specifically, so turn-taking is close to its best case. And separating voices is
not identifying them — naming a speaker per recording needs nothing stored, while
recognising the same voice across recordings means holding a voiceprint of
somebody who has agreed to nothing. Those are different features and only the
first is wanted.

### What it costs the app's argument

**This is a second network request, and it is heavier than the first.** Apple
Maps sends the region you are looking at. This sends **your voice** to a third
party. `docs/ARCHITECTURE.md` § 12 is rewritten with it rather than around it: a
setting, off by default, exactly as `mapsEnabled` is, and Settings says plainly
what is uploaded and to whom.

The key lives in the vault under the keychain key, never in the repository —
`.gitignore` and gitleaks already cover the pattern. One file, `services/`, is
the only thing that talks to the service; `core` stays pure. A transcript is
something you said, so retention never deletes one, on the same rule as a note.

**No right-to-left handling and no styling**, deliberately. The interface is
English and the note content is Persian; the text renders readably as plain text
and is stored as plain UTF-8, which is also what makes it portable to the S3
sync (item 12) and to anything downstream. Revisit only if it is ever read by
somebody other than its author.

**When search is built** (the note under this list), Persian needs normalising on
both the stored text and the query: Arabic characters routinely stand in for
Persian ones — ک/ك and ی/ي — and zero-width non-joiners are invisible and break
string matching. It belongs in `core`, pure and tested. Skipped, search fails in
a way that is genuinely hard to diagnose.

### Before committing to it

Ten minutes of real audio through the free tier — the actual voice, the actual
room, the actual phone. FLEURS and Common Voice are clean read speech and will
flatter it. Judge whether the meaning survived rather than counting token
mismatches: WER penalises Persian unfairly, because transliteration variance
marks semantically correct transcriptions wrong, which is why the benchmark
authors lean on BERTScore for Persian.

---

Turned up while building the diary, not done:

- **Searching it.** Reading a note back means walking to its day. That is fine
  for a week and not for a year, and it is the reason the browsable list was
  offered and declined at the time — worth revisiting once there is enough
  written to want it.
- **Notes in the GPX and the day summary.** The CSV has them; nothing else does.
- **Searching Persian** needs character normalisation before it will work at all
  — see item 15.

Parked separately, designs already written: photo library import (reviewed,
never automatic — see the session notes), and a real Live Photo via
`AVCapturePhotoOutput.livePhotoCaptureEnabled`, which the local-native-module
pattern now makes reachable.
