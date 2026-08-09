# Backlog

Features agreed for later, written down before they are built so the thinking
survives the wait. Nothing here is being developed yet; v0.2.13's features get
tested and fixed first. Ordered roughly by how they unlock each other, not by
priority — priorities get decided when work starts.

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
and `AVAssetExportSession`, which Expo does not expose. That is a second local
native module in the `modules/camera-optics` mould: one Swift file, one job
(compose segment files into one movie), everything decidable in TypeScript and
testable there, with the native side doing only what only it can do.

Worth knowing before starting: an in-progress QuickTime file is unreadable —
the moov atom is written at stop — so "go back three seconds _while still
recording_" is not buildable on any API. The segment model is the honest
version: pausing is what makes the just-recorded tail reviewable, and the
review happens between segments. That matches how it was asked for ("I pause,
go back, and then resume, and it cuts to that stage").

---

## 1. Pause and resume a recording

`expo-camera` already has `toggleRecordingAsync()` — "pauses or resumes the
video recording" — so a minimal version needs no native work at all: one clip,
paused and resumed, with the shutter row growing a pause control while
recording. The segment model supersedes this eventually, but the cheap version
is real and could ship alone.

Decisions when built: what the elapsed clock does while paused (stop, clearly);
whether max duration counts wall time or recorded time (recorded).

## 2. The live rewind ("time frame viewer")

While paused: scrub through what was just recorded, pick a moment, and resume —
the clip continues from that moment, the discarded tail gone. On the segment
model this is: preview the closed segment (it is a complete file the instant it
closes), scrub with the existing `Scrubber`, trim via the composition module,
open the next segment on resume.

Smoothness lives and dies on the preview being a real player over a real file,
which the segment model gives for free — `expo-video` can seek a closed
segment like any clip.

## 3. Transitions, marked live

A button press during recording (or while paused) marks the current boundary:
"put a transition here". The mark is data — `{ boundaryIndex, kind }` — and
the composition module applies it on save. Hard cuts are free; crossfade and
dissolve are `AVMutableVideoComposition` work in the same native file. Start
with cut and one crossfade; a transition picker is creep until proven wanted.

## 4. Live editing, generally

The principle the above three add up to, kept as a principle: **every editing
decision is expressible while shooting, and saving composes automatically.**
No timeline editor after the fact, ever — that is a different app. Anything
proposed later for "editing" gets tested against this: if it cannot be decided
live with one button, it does not belong here.

## 5. Teleprompter

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

Investigation, not a feature: find where the app actually stutters on the
phone, with the JS thread as prime suspect. Known candidates, from the
architecture rather than from measurement (measurement is the task):

- The launch path: index normalisation, orphan sweep, thumbnail backfill.
- Opening a day: the fold runs on the JS thread while the page animates —
  exactly the case `SwipeBackPage` runs its animation natively for.
- The thumbnail decrypt queue behind a fast scroll.
- The offline map canvas re-projecting on every scrub tick.

Method: `InteractionManager` timings and the RN performance monitor on a real
phone, worst day of data available. Fixes follow measurements, not hunches.

## 7. Comprehensive performance audit

The lag hunt, widened: startup time, memory with a year of days, battery with
tracking on all day, disk growth (the media directory and the fix archive),
and the JS bundle. Produces numbers first, then a fix list ranked by measured
cost — the audit's deliverable is the ranking, so the work that follows is
spent where the phone says, not where the code looks guilty.

## 8. Save a capture to the iPhone photo library

The other direction from the parked import: a photo or video, exported from
this app's store into Photos. `expo-media-library`'s `saveToLibraryAsync` does
exactly this and needs only the add-only permission
(`NSPhotoLibraryAddUsageDescription`), which is the mild one — no read access,
no library browsing, just "may this app add".

Two things to hold onto when building it. It is **per capture and on demand**
— a button on the capture's info panel, never a sync — because the whole store
is encrypted precisely so that captures do not sit in places the vault does
not cover, and putting one into Photos is the deliberate, visible exception.
And what lands in Photos is a copy: forgetting the capture here afterwards
does not reach into the library, same shape as the import rule in reverse.

## 9. Compact the stationary fixes

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

## 10. The assumed stay: bridging a gap whose two ends agree

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

---

Parked separately, designs already written: photo library import (reviewed,
never automatic — see the session notes), and a real Live Photo via
`AVCapturePhotoOutput.livePhotoCaptureEnabled`, which the local-native-module
pattern now makes reachable.
