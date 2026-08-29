import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo, useState } from 'react';
import { Alert, Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import {
  dayKeyOf,
  daysWorthOpening,
  groupByDay,
  notesForMedia,
  whereToWrite,
  type DayNote,
  type NoteKind,
  type NoteVoice,
} from '@/core/day';
import { capturesOnly, type MediaItem } from '@/core/media';
import { visitsByPlace, type Place } from '@/core/places';
import { buildTrack, positionAt } from '@/core/replay';
import { formatDistance, modeLabel } from '@/core/format';
import {
  ACTIVITY_MODES,
  journeyLabelId,
  judgeStationaryClaim,
  purposeTextFor,
  stationaryCentre,
} from '@/core/segments';
import type { MergeRefusal, MoveSegment, Segment, StationaryClaim, StaySegment } from '@/core/segments';
import { SegmentScreen } from '@/features/activities/SegmentScreen';
import { useHeartbeat } from '@/features/activities/hooks/useHeartbeat';
import { useTimeline } from '@/features/activities/hooks/useTimeline';
import { CaptureScreen } from '@/features/capture/CaptureScreen';
import { useMedia } from '@/features/capture/hooks/useMedia';
import { DataScreen } from '@/features/data/DataScreen';
import { HistoryScreen } from '@/features/history/HistoryScreen';
import { MediaGalleryScreen } from '@/features/media/MediaGalleryScreen';
import { PlaceScreen } from '@/features/places/PlaceScreen';
import { PlacesScreen } from '@/features/places/PlacesScreen';
import { PlacePicker } from '@/features/places/components/PlacePicker';
import { usePlaces } from '@/features/places/hooks/usePlaces';
import { NamedJourneysScreen } from '@/features/labels/NamedJourneysScreen';
import { MenuSheet } from '@/components/MenuSheet';
import { JourneyLabelSheet } from '@/features/labels/components/JourneyLabelSheet';
import { useJourneyLabels } from '@/features/labels/hooks/useJourneyLabels';
import { useStationaryClaims } from '@/features/activities/hooks/useStationaryClaims';
import { useVisitPurposes } from '@/features/labels/hooks/useVisitPurposes';
import { configFrom, useBackup } from '@/features/data/hooks/useBackup';
import { readingErrorFor } from '@/services/location';
import { NoteSheet } from '@/features/notes/components/NoteSheet';
import { useAdoptVoiceCaptures } from '@/features/notes/hooks/useAdoptVoiceCaptures';
import { useDayNotes } from '@/features/notes/hooks/useDayNotes';
import { useNoteThumbnails } from '@/features/notes/hooks/useNoteThumbnails';
import { NotesScreen } from '@/features/notes/NotesScreen';
import { PlannerScreen } from '@/features/notes/PlannerScreen';
import { usePlanSync } from '@/features/notes/hooks/usePlanSync';
import { planQueueLine } from '@/core/plans';
import { ReplayScreen } from '@/features/replay/ReplayScreen';
import { CredentialsScreen } from '@/features/settings/CredentialsScreen';
import { DiagnosticsScreen } from '@/features/settings/DiagnosticsScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { useSettings } from '@/features/settings/hooks/useSettings';
import { silenceAudio } from '@/services/audioFocus';
import { now as readNow } from '@/services/clock';
import { noteAudioUri } from '@/services/noteAudio';
import { transcribe } from '@/services/transcribe';
import { colors, spacing } from '@/theme/tokens';

import { SwipeBackPage } from './SwipeBackPage';
import { usePageStack } from './usePageStack';

type Tab = 'replay' | 'capture' | 'gallery' | 'notes' | 'settings';

/**
 * The tabs that can have a detail page over them.
 *
 * Capture is not one. It is a viewfinder and a shutter, and the list it used to
 * carry — the one route it had to a detail page — belongs to Media now.
 */
type PagedTab = Exclude<Tab, 'capture'>;

/** Pages that can sit above a tab's root. */
type Page =
  | { readonly kind: 'segment'; readonly segment: Segment }
  | { readonly kind: 'alldays' }
  | { readonly kind: 'places' }
  | { readonly kind: 'place'; readonly place: Place }
  | { readonly kind: 'journeys' }
  | { readonly kind: 'data' }
  | { readonly kind: 'diagnostics' }
  | { readonly kind: 'credentials' }
  // A page under Notes rather than a sixth tab: iOS collapses a sixth into a
  // "More" list, and five is the ceiling this shell has always been built to.
  | { readonly kind: 'planner' };

/**
 * What the note sheet is open for.
 *
 * A new note needs the day it is about and what that day recorded — where it
 * lands depends on both. An edit needs only the note, which already knows its
 * own instant.
 */
type NoteTarget =
  | {
      readonly kind: 'new';
      readonly dayKey: string;
      readonly segments: readonly Segment[];
      /**
       * A diary entry or a plan — `DayNote['kind']`, not this union's own.
       *
       * Named apart from `kind` above because the two answer different
       * questions: that one is what the sheet is open *for*, this is what the
       * entry *is*. Collapsing them would make "new plan" and "edit" the same
       * axis, which they are not.
       */
      readonly noteKind: NoteKind;
      /** The capture it is about, when it was begun from one. */
      readonly mediaId?: string | null;
    }
  | { readonly kind: 'edit'; readonly note: DayNote };

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'replay', label: 'Day', icon: 'today-outline' },
  // Capture in the middle, where a thumb reaches without moving the phone. It
  // is the only tab that is a thing you *do* rather than a thing you read, and
  // the only one you would ever open one-handed in a hurry.
  { key: 'capture', label: 'Capture', icon: 'camera-outline' },
  { key: 'gallery', label: 'Media', icon: 'images-outline' },
  // **The diary is a tab now, not a section of the Day screen.** A note used to
  // be filed under the day it was about and reached by walking to that day,
  // which the backlog already called "fine for a week and not for a year". Five
  // tabs is the ceiling: iOS collapses a sixth into a "More" list, which is why
  // Places stays a page under Settings.
  //
  // **A pencil on a page, after `book-outline` and `journal-outline` were both
  // tried and both read wrong.** A book is something you read, and this is the
  // one tab whose contents nobody else wrote — but the journal glyph is a
  // rounded rectangle with a stripe down one edge, which at tab size is a
  // credit card. Reported as exactly that.
  //
  // The test an icon here has to pass is being recognisable at 30 points beside
  // a camera and a gallery, and the two book shapes fail it for opposite
  // reasons: one is a closed rectangle, the other is a closed rectangle with a
  // line on it. A pencil is a *different silhouette* rather than a differently
  // decorated one, which is the same reason the record button's square beats a
  // second microphone in another colour.
  //
  // It is deliberately the same glyph as the pen in this tab's header. Both
  // mean writing, and a tab bar saying "this is where you write" above a button
  // saying "write" is consistent rather than duplicated.
  { key: 'notes', label: 'Notes', icon: 'create-outline' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline' },
];

/**
 * Four tabs, each with its own stack of detail pages.
 *
 * Still no navigation library. `usePageStack` is an array and three functions,
 * against a router that would bring a native screen container, a navigation
 * state tree and a serialisation format. One stack per tab rather than one
 * global stack, so going Today → a journey → Capture → back leaves the journey
 * where you left it.
 *
 * **Places used to be a tab and is now a page under Settings.** Day, Capture
 * and Media are things you do or look at daily; Places is a reference list you
 * consult, and iOS collapses a sixth tab into a "More" menu that is worse than
 * either. The reasoning in the architecture notes § 13 survives four tabs and
 * one level of depth; it would not survive a fifth level, deep links or modal
 * routes.
 *
 * Every tab stays **mounted**, with the inactive ones hidden, and a detail page
 * renders *over* its tab rather than replacing it. Both for the same reason:
 * Today holds a running recording and a timeline it just derived, and neither
 * should be lost because you opened a place you visited in March.
 *
 * The two exceptions are the ones that hold hardware or plaintext. Capture is
 * told which tab is showing so it mounts its preview only when it is on screen
 * — a capture session running behind three hidden screens costs battery and
 * leaves the recording indicator lit while you read Settings. Media is told for
 * the same reason twice over: a video should not keep playing out of sight, and
 * a decrypted capture should not sit in the cache for a tab nobody is looking
 * at.
 *
 * The hooks live here because they are shared. A stay can be named from Today
 * or from any day in History, media is written by Capture and read by Replay,
 * and hoisting means one copy rather than several that might drift.
 */
export function TabShell() {
  const [tab, setTab] = useState<Tab>('replay');
  const [naming, setNaming] = useState<StaySegment | null>(null);
  const [namingJourney, setNamingJourney] = useState<MoveSegment | null>(null);
  /**
   * The journey whose activity type is being corrected, or null.
   *
   * Separate from `namingJourney`: naming asks what a journey was *for* and
   * wants a keyboard, correcting asks what it *was* and wants one tap. Sharing
   * a sheet would put a text field in front of a one-tap correction.
   */
  const [correcting, setCorrecting] = useState<MoveSegment | null>(null);
  const [replayDayKey, setReplayDayKey] = useState<string | null>(null);
  /**
   * The note being written or edited, or null.
   *
   * A new one carries the day it is about and that day's segments, because
   * where a note lands depends on both — now if the day is today, the end of
   * the last thing that happened if it is over. Reading them back off the
   * timeline here would mean answering "which day is showing" twice.
   */
  const [writingNote, setWritingNote] = useState<NoteTarget | null>(null);
  /**
   * The note a capture was opened from, or null.
   *
   * The whole of the way back. Tapping the picture inside a note goes to the
   * Media tab focused on that capture, and this is what lets the gallery offer
   * a way home to the thing you were reading — the one piece of chrome on that
   * screen that is not always there.
   *
   * Cleared in the handlers rather than by an effect: `react-hooks/set-state-in-effect`
   * is an error here, and clearing on a tab change in an effect would draw the
   * new screen once with the old journey still attached to it.
   */
  const [cameFromNote, setCameFromNote] = useState<DayNote | null>(null);

  const settings = useSettings();
  const journeys = useJourneyLabels();
  const stationary = useStationaryClaims();
  /**
   * Why you were where you stopped.
   *
   * Beside the journey labels and the stationary claims because it is the same
   * kind of thing — something you told the app, kept as its own record and
   * applied over a re-derived timeline — and because a stop can be described
   * from the Day screen or from any day in History, so one copy rather than two
   * that might drift.
   */
  const purposes = useVisitPurposes();
  const backup = useBackup(settings.settings);
  const notes = useDayNotes();

  /**
   * Plans, out to the bucket, when Send is pressed.
   *
   * **It used to drain on its own and it no longer does.** Hoisting it here was
   * once about keeping the queue going while you looked at the map; it stays
   * here because the count belongs to the Plans list wherever you are, and the
   * press now comes from that list. What leaves does not stop at a bucket — a
   * machine at home reads it and writes what a model decided into a database —
   * so an unread transcript is a wrong row somebody has to go and find. The
   * hook's own header argues it in full.
   */
  const planSync = usePlanSync({
    notes: notes.notes,
    ready: notes.ready && settings.ready,
    settings: settings.settings,
  });
  /**
   * One line under the Plans switch: how many are still to go, or where to
   * configure somewhere to send them, or what the last failure said.
   *
   * The trouble takes precedence over the count, because a count that keeps not
   * going down is the thing that needs explaining.
   */
  const planNote = useMemo(() => {
    if (planSync.trouble) {
      const said = planSync.trouble.detail.trim();
      return `Could not send plans: ${planSync.trouble.reason}${said.length > 0 ? ` — ${said}` : ''}`;
    }
    return planQueueLine(planSync.waiting, settings.settings.exchangeBucket.length > 0);
  }, [planSync.trouble, planSync.waiting, settings.settings.exchangeBucket]);

  /**
   * Whether the Plans list offers a Send button, and what it does.
   *
   * Absent entirely when there is no bucket: a control that cannot work is
   * worse than none, and `planNote` above already says to add one in Settings.
   */
  const planSend = useMemo(
    () =>
      settings.settings.exchangeBucket.length > 0
        ? { waiting: planSync.waiting, busy: planSync.busy, onSend: planSync.send }
        : null,
    [settings.settings.exchangeBucket, planSync.waiting, planSync.busy, planSync.send],
  );

  const places = usePlaces();
  const media = useMedia();
  const timeline = useTimeline(
    settings.settings,
    journeys.labels,
    stationary.claims,
    purposes.purposes,
    settings.ready && journeys.ready && stationary.ready && purposes.ready,
  );

  // Voice notes made while a voice note was still a capture, moved into the
  // diary. Hoisted here because it is the one place that holds both stores, and
  // hiding those rows from the gallery without moving them would be losing them.
  useAdoptVoiceCaptures(media, notes);

  // A phone that does not move produces no fixes, so an afternoon at a desk
  // would otherwise leave the day empty. Only while tracking is on: the switch
  // being off means the app writes down nowhere you are.
  useHeartbeat(settings.tracking, timeline.refresh);

  const stacks: Record<PagedTab, ReturnType<typeof usePageStack<Page>>> = {
    replay: usePageStack<Page>(),
    gallery: usePageStack<Page>(),
    // The diary has no page above it: a note opens in the sheet, over whatever
    // is showing, rather than pushing a screen.
    notes: usePageStack<Page>(),
    settings: usePageStack<Page>(),
  };

  const mapsEnabled = settings.settings.mapsEnabled;

  // Today plus every finished day: what Places counts visits over, what the
  // naming picker uses to say "you have been here 12 times", and what an export
  // covers.
  const allSegments = useMemo(
    () => [...timeline.history.flatMap((day) => day.segments), ...timeline.today],
    [timeline.history, timeline.today],
  );
  const visits = useMemo(() => visitsByPlace(allSegments, places.places), [allSegments, places.places]);

  /**
   * What the gallery, the map and the Data screen mean by a capture.
   *
   * A voice note is a note, so it is drawn on its day rather than in the
   * library — and until `useAdoptVoiceCaptures` has moved the ones an earlier
   * build filed here, the index still holds them. Filtered in one place because
   * three screens ask the same question.
   */
  const captures = useMemo(() => capturesOnly(media.items), [media.items]);

  /**
   * Thumbnails for the captures the diary points at, held once and shared.
   *
   * The list and the sheet both draw them, and two caches would decrypt the
   * same files twice and disagree about which had arrived.
   */
  const noteThumbs = useNoteThumbnails(notes.notes, captures);

  /**
   * Turning a recording into text, or undefined when there is no key.
   *
   * Undefined is what hides the button entirely: with no key there is no
   * feature, and the absence of a key is the only gate there is — see
   * `settings.transcriptionKey`. Hoisted here because this is the layer that
   * holds the settings; the sheet never sees the key itself, only a function
   * that happens to close over it.
   */
  const transcriptionKey = settings.settings.transcriptionKey;
  const transcriptionLanguage = settings.settings.transcriptionLanguage;
  const onTranscribe = useMemo(
    () =>
      transcriptionKey.length === 0
        ? undefined
        : async (voice: NoteVoice) =>
            transcribe({
              uri: noteAudioUri(voice.fileName) ?? '',
              apiKey: transcriptionKey,
              languageCode: transcriptionLanguage,
            }),
    [transcriptionKey, transcriptionLanguage],
  );

  // Today is a day like any other to the player, so it is grouped the same way
  // rather than special-cased into the list.
  //
  // `daysWorthOpening` then adds the days that have no segments and still exist:
  // the ones you wrote about, and today. Without it a day the app recorded
  // nothing on has no arrow, no page and nowhere to write — which fails on a
  // fresh install and on a day spent somewhere with no signal, the two days
  // most worth a sentence rather than a measurement.
  const replayDays = useMemo(
    () =>
      daysWorthOpening(
        groupByDay(allSegments, timeline.tzOffsetMinutes),
        notes.notes,
        timeline.now,
        timeline.tzOffsetMinutes,
      ),
    [allSegments, notes.notes, timeline.now, timeline.tzOffsetMinutes],
  );

  /**
   * When the note sheet's pickers start.
   *
   * A note already written starts at its own instant, so opening one to fix a
   * typo cannot quietly move it. A new one gets `whereToWrite`'s answer — now
   * if the day on screen is today, the end of the day if it is over — which is
   * right often enough that the pickers are usually there to be ignored.
   *
   * `readNow()` rather than `timeline.now`, which is as old as the last refresh
   * and would stamp a note up to twenty seconds early.
   */
  const noteDefaultAt = useMemo(() => {
    if (!writingNote) return 0;
    if (writingNote.kind === 'edit') return writingNote.note.at;
    return whereToWrite(writingNote.dayKey, writingNote.segments, readNow(), timeline.tzOffsetMinutes);
  }, [writingNote, timeline.tzOffsetMinutes]);

  /** The capture the open note is about, if any — what the sheet draws above the fields. */
  const noteMediaId = writingNote
    ? writingNote.kind === 'edit'
      ? writingNote.note.mediaId
      : (writingNote.mediaId ?? null)
    : null;

  /**
   * Pressing the tab you are already on goes home.
   *
   * "Home" is the tab's root with every detail page closed — and on Day it is
   * also *today*, because the day is a parameter of one screen rather than a
   * page of its own. Being four days back and pressing Day should land where
   * opening the app lands.
   *
   * **This replaces a double-press within a timeout**, and the simplification
   * came from deleting the Day screen's Today button: with the button gone this
   * is the way back to today, so it has to be the obvious gesture rather than a
   * hidden one. It is also what every other iOS app does, and it removes a ref,
   * a timestamp and a window in which two presses meant something a third did
   * not.
   *
   * A press on a tab you are *not* on still only switches to it, which is the
   * distinction the timeout used to draw: moving about is not asking to go home.
   * The cost is that a stray press on the current tab loses the day you were
   * looking at — recoverable in one tap through the date, which is now the
   * picker.
   */
  /**
   * **Leaving a tab stops what it was playing.**
   *
   * Every tab stays mounted with the inactive ones hidden — that is deliberate,
   * so switching away cannot throw away a running recording or a timeline just
   * derived — and the cost is that a player keeps playing behind a screen
   * nobody is looking at. A recording talking on from the Notes tab while you
   * read Settings is the app doing something you cannot see the control for:
   * the pause button is one tab away, and the sound has outlived the reason it
   * was started.
   *
   * In the cleanup rather than the body, because it belongs to the tab being
   * *left*: React runs this as the old tab goes, before the new one arrives.
   * Nothing happens on the first mount, when there is nothing to silence.
   *
   * Only a tab change. Opening a note in the sheet, or a segment over the day,
   * is a page above the same tab — still the screen you were on, still the
   * thing you were listening to.
   */
  useEffect(() => () => silenceAudio(), [tab]);

  const pressTab = (key: Tab) => {
    const alreadyHere = tab === key;
    setTab(key);
    // Going somewhere by hand ends the journey that brought you here. The chip
    // is for the trip you are on, not a bookmark that outlives it.
    setCameFromNote(null);
    if (!alreadyHere) return;

    if (key !== 'capture') stacks[key].reset();
    if (key === 'replay') setReplayDayKey(null);
  };

  /**
   * "I was here the whole time", judged.
   *
   * Here rather than in the screen because this is the layer that holds what
   * the judgement needs and `core` refuses to read: the segmentation
   * thresholds, the *effective* preset — so a day recorded on battery saver is
   * appropriately more forgiving than one on balanced — and the day's captures,
   * which know where they were taken from a reading the fold never saw.
   *
   * **A refusal says what it found.** "You moved 400 m in the middle of this"
   * is an answer; a control that quietly does nothing is the failure the
   * transcription button already taught this app.
   */
  const mergeStretch = (from: Segment, to: Segment, shown: readonly Segment[]) => {
    const startedAt = from.startedAt;
    const endedAt = to.endedAt;

    const verdict = judgeStationaryClaim({
      segments: shown,
      startedAt,
      endedAt,
      thresholdM: settings.settings.segmentation.minMoveDistanceM,
      readingErrorM: readingErrorFor(settings.runningPreset),
      labels: journeys.labels,
      captures: captures
        .filter((item) => item.capturedAt >= startedAt && item.capturedAt <= endedAt)
        .flatMap((item) => (item.at ? [item.at] : [])),
    });

    if (!verdict.ok) {
      Alert.alert('These cannot be one stop', refusalText(verdict.refusal, verdict.excursionM));
      return;
    }

    const inside = shown.filter((segment) => segment.endedAt > startedAt && segment.startedAt < endedAt);
    const at = stationaryCentre(inside) ?? (from.kind === 'stay' ? from.center : null);
    // Only reachable if the range holds no stay at all and the anchor was a
    // journey, which the screen does not offer — but a claim with nowhere to be
    // is not a thing to write down.
    if (!at) return;

    stationary.claim(startedAt, endedAt, at);
  };

  const openSegment = (which: PagedTab) => (segment: Segment) => stacks[which].push({ kind: 'segment', segment });
  /**
   * Opening a capture goes to the Media tab, focused on it — there is no
   * detail page any more. The gallery absorbed everything the page held, so a
   * capture tapped on the Day timeline lands in the same place a capture
   * swiped to in Media does, and there is one screen that shows a capture
   * rather than two drifting apart.
   */
  const [galleryFocus, setGalleryFocus] = useState<string | null>(null);
  const openMedia = (item: MediaItem) => {
    // Arrived from the Day timeline, so there is no note to go back to. Cleared
    // rather than left, or the chip would offer a way home to whatever note was
    // last read.
    setCameFromNote(null);
    setGalleryFocus(item.id);
    setTab('gallery');
  };

  /**
   * From a note to the picture it is about, and back again.
   *
   * The sheet closes, because it is a modal over everything and the picture is
   * on another tab — leaving it open would put the gallery behind a sheet that
   * covers it. The note is remembered instead, and the gallery grows a Back
   * chip for as long as it is.
   *
   * There is deliberately no page pushed and no stack entry: the day is a
   * parameter of one screen, a capture is a parameter of another, and this is
   * two parameters being set rather than a place being navigated to. That is
   * the same reasoning that keeps `usePageStack` an array and three functions.
   */
  const openMediaFromNote = (note: DayNote, mediaId: string) => {
    setWritingNote(null);
    setCameFromNote(note);
    setGalleryFocus(mediaId);
    setTab('gallery');
  };

  const backToNote = () => {
    if (!cameFromNote) return;
    // Looked up fresh, so a note edited in between comes back as it is now
    // rather than as it was when the picture was opened — the same reasoning
    // the place page uses against holding a stale copy in the stack.
    const current = notes.notes.find((candidate) => candidate.id === cameFromNote.id) ?? cameFromNote;
    setCameFromNote(null);
    setTab('notes');
    setWritingNote({ kind: 'edit', note: current });
  };

  /**
   * Where a capture happened.
   *
   * The coordinate taken at the shutter wins, because it is an answer about
   * *this* capture rather than an inference from the day around it. Falling
   * back to the timeline is what makes every photo taken before the app stored
   * one still have a location — and null, when the day has no fix for that
   * instant, is a real answer the media screen says out loud.
   */
  const positionOf = (item: MediaItem) => {
    if (item.at) return { ...item.at, at: item.capturedAt, speedMps: null, segmentId: '', kind: 'stay' as const };

    const day = replayDays.find(
      (candidate) =>
        item.capturedAt >= candidate.startedAt && item.capturedAt <= candidate.startedAt + 24 * 60 * 60_000,
    );
    return day ? positionAt(buildTrack(day.segments), item.capturedAt) : null;
  };

  function renderPage(which: PagedTab) {
    const page = stacks[which].current;
    if (!page) return null;

    const back = stacks[which].pop;

    if (page.kind === 'segment') {
      return (
        <SegmentScreen
          segment={page.segment}
          places={places.places}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          mapsEnabled={mapsEnabled}
          onBack={back}
          onNamePlace={page.segment.kind === 'stay' ? () => setNaming(page.segment as StaySegment) : undefined}
          onNameJourney={page.segment.kind === 'move' ? () => setNamingJourney(page.segment as MoveSegment) : undefined}
          // The stay held in the stack rather than a fresh one: `set` needs the
          // segment's own range to know which records this stop covers, and the
          // range is what the page was opened with.
          onSetPurpose={
            page.segment.kind === 'stay'
              ? (purpose: string) => purposes.set(page.segment as StaySegment, purpose)
              : undefined
          }
          // **Read from the store, not off the segment held in the stack.**
          // That segment is a snapshot taken when the row was tapped, so it
          // still says whatever was written before the page opened — and the
          // field went blank the moment somebody saved into it.
          purpose={page.segment.kind === 'stay' ? purposeTextFor(purposes.purposes, page.segment as StaySegment) : null}
        />
      );
    }
    if (page.kind === 'planner') {
      return <PlannerScreen url={settings.settings.plannerUrl} onBack={back} />;
    }
    if (page.kind === 'alldays') {
      return (
        <HistoryScreen
          days={replayDays}
          places={places.places}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          onBack={back}
          onOpenDay={(chosen) => {
            // Chosen from the list, so it becomes the day being shown and the
            // list closes behind it — the day view is where you were going.
            setReplayDayKey(chosen.key);
            back();
          }}
        />
      );
    }
    if (page.kind === 'places') {
      return (
        <PlacesScreen
          places={places.places}
          allSegments={allSegments}
          onBack={back}
          onOpen={(place) => stacks[which].push({ kind: 'place', place })}
        />
      );
    }
    if (page.kind === 'place') {
      // Looked up fresh rather than held in the stack, so a rename shows
      // immediately instead of leaving a stale title behind.
      const current = places.places.find((candidate) => candidate.id === page.place.id);
      if (!current) return null;
      return (
        <PlaceScreen
          place={current}
          allSegments={allSegments}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          onBack={back}
          onRename={places.rename}
          onForget={places.forget}
        />
      );
    }
    if (page.kind === 'journeys') {
      return (
        <NamedJourneysScreen
          labels={journeys.labels}
          segments={allSegments}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          mapsEnabled={mapsEnabled}
          onBack={back}
          onOpenSegment={openSegment(which)}
          onForget={journeys.forget}
        />
      );
    }
    if (page.kind === 'credentials') {
      return <CredentialsScreen settings={settings} onBack={back} />;
    }

    if (page.kind === 'diagnostics') {
      return <DiagnosticsScreen settings={settings.settings} onBack={back} />;
    }

    return (
      <DataScreen
        fixes={timeline.fixes}
        segments={allSegments}
        places={places.places}
        media={captures}
        notes={notes.notes}
        rejected={timeline.rejected}
        preset={settings.settings.preset}
        now={timeline.now}
        tzOffsetMinutes={timeline.tzOffsetMinutes}
        onBack={back}
        days={timeline.history}
        backup={backup}
        retentionDays={settings.settings.retentionDays}
        backupConfigured={configFrom(settings.settings) !== null}
        onRebuildThumbnails={media.rebuildThumbnails}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.screens}>
        <View style={[styles.screen, tab !== 'capture' && styles.hidden]}>
          <CaptureScreen media={media} visible={tab === 'capture'} />
        </View>

        <View style={[styles.screen, tab !== 'replay' && styles.hidden]}>
          <ReplayScreen
            days={replayDays}
            places={places.places}
            media={captures}
            settings={settings}
            tzOffsetMinutes={timeline.tzOffsetMinutes}
            mapsEnabled={mapsEnabled}
            ready={timeline.ready}
            selectedDayKey={replayDayKey}
            onSelectDay={setReplayDayKey}
            onOpenSegment={openSegment('replay')}
            onOpenMedia={openMedia}
            onOpenAllDays={() => stacks.replay.push({ kind: 'alldays' })}
            onCorrectMode={setCorrecting}
            claims={stationary.claims}
            onMerge={mergeStretch}
            onUnmerge={(claim: StationaryClaim) => stationary.forget(claim.id)}
          />
          {stacks.replay.current ? (
            <SwipeBackPage onBack={stacks.replay.pop}>{renderPage('replay')}</SwipeBackPage>
          ) : null}
        </View>

        <View style={[styles.screen, tab !== 'gallery' && styles.hidden]}>
          <MediaGalleryScreen
            items={captures}
            tzOffsetMinutes={timeline.tzOffsetMinutes}
            visible={tab === 'gallery'}
            mapsEnabled={mapsEnabled}
            positionFor={positionOf}
            onForget={media.forget}
            onRotate={(id) => void media.rotate(id)}
            focusId={galleryFocus}
            onFocusHandled={() => setGalleryFocus(null)}
            notesFor={(item) => notesForMedia(notes.notes, item.id)}
            // Over the gallery rather than on the Notes tab: writing about the
            // photograph in front of you should not move you away from it.
            onWriteNote={(item) =>
              setWritingNote({
                kind: 'new',
                noteKind: 'note',
                dayKey: dayKeyOf(readNow(), timeline.tzOffsetMinutes),
                segments: timeline.today,
                mediaId: item.id,
              })
            }
            onOpenNote={(note) => setWritingNote({ kind: 'edit', note })}
            onBackToNote={cameFromNote ? backToNote : undefined}
          />
          {stacks.gallery.current ? (
            <SwipeBackPage onBack={stacks.gallery.pop}>{renderPage('gallery')}</SwipeBackPage>
          ) : null}
        </View>

        <View style={[styles.screen, tab !== 'notes' && styles.hidden]}>
          <NotesScreen
            notes={notes.notes}
            tzOffsetMinutes={timeline.tzOffsetMinutes}
            now={timeline.now}
            // A new note from here is about *today*, at now. The sheet's date
            // and time pickers are how it becomes about any other day — which
            // is the same affordance that already existed, now reached from the
            // diary rather than from the day.
            onWrite={(noteKind) =>
              setWritingNote({
                kind: 'new',
                noteKind,
                dayKey: dayKeyOf(readNow(), timeline.tzOffsetMinutes),
                segments: timeline.today,
              })
            }
            // **The quick microphone files its own note, with no sheet in
            // between.** The recording is the entry — a recording alone is
            // already a note, by the same rule that lets a title alone be one
            // — so there is nothing left for a form to collect and nothing for
            // a Save to approve.
            //
            // Dated to when the *talking started* rather than when the file
            // finished being written: those differ by however long the recording
            // ran, and "when I said this" is the honest answer. `write` puts it
            // through `freeInstant`, so two notes begun in the same millisecond
            // cannot take each other's id.
            onSpeak={(voice, startedAt, noteKind) => notes.write(startedAt, '', '', voice, null, noteKind)}
            onOpen={(note) => setWritingNote({ kind: 'edit', note })}
            onForget={notes.forget}
            thumbFor={noteThumbs.uriFor}
            planNote={planNote}
            planSend={planSend}
            plannerUrl={settings.settings.plannerUrl}
            onOpenPlanner={() => stacks.notes.push({ kind: 'planner' })}
          />
        </View>

        <View style={[styles.screen, tab !== 'settings' && styles.hidden]}>
          <SettingsScreen
            settings={settings}
            rejected={timeline.rejected}
            onOpenData={() => stacks.settings.push({ kind: 'data' })}
            onOpenPlaces={() => stacks.settings.push({ kind: 'places' })}
            onOpenJourneys={() => stacks.settings.push({ kind: 'journeys' })}
            onOpenCredentials={() => stacks.settings.push({ kind: 'credentials' })}
            onOpenDiagnostics={() => stacks.settings.push({ kind: 'diagnostics' })}
          />
          {stacks.settings.current ? (
            <SwipeBackPage onBack={stacks.settings.pop}>{renderPage('settings')}</SwipeBackPage>
          ) : null}
        </View>
      </View>

      <View style={styles.tabBar}>
        {TABS.map(({ key, label, icon }) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => pressTab(key)}
              accessibilityRole="tab"
              // "History tab", not "History": each screen has a heading of its
              // own, and an ambiguous label is a coin toss for both a screen
              // reader and the UI smoke test.
              accessibilityLabel={`${label} tab`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              {/* Icon only. The label is still the accessibility name, so a
                  screen reader and the smoke test keep saying "Day tab" — what
                  goes is the visible word, not the meaning. */}
              <Ionicons name={icon} size={30} color={active ? colors.move : colors.textMuted} />
            </Pressable>
          );
        })}
      </View>

      <PlacePicker
        stay={naming}
        places={places.places}
        visits={visits}
        tzOffsetMinutes={timeline.tzOffsetMinutes}
        onPickExisting={(place) => {
          if (naming) places.link(naming, place);
          setNaming(null);
        }}
        onCreate={(name) => {
          if (naming) places.name(naming, name);
          setNaming(null);
        }}
        onClose={() => setNaming(null)}
      />

      {/* Hoisted beside the place picker, and for the same reason: a journey can
          be named from Today, from a day in History, or from Replay. */}
      <JourneyLabelSheet
        journey={namingJourney}
        tzOffsetMinutes={timeline.tzOffsetMinutes}
        onSave={(label, mode) => {
          if (namingJourney) journeys.name(namingJourney, label, mode);
        }}
        // Offered only where a label actually produced this row, so the sheet
        // never shows Remove over a name that was never given.
        onForget={
          namingJourney && journeys.labels.some((one) => one.id === journeyLabelId(namingJourney.startedAt))
            ? () => journeys.forget(journeyLabelId(namingJourney.startedAt))
            : undefined
        }
        onClose={() => setNamingJourney(null)}
      />

      {/* Beside the other two, for the same reason: writing about a day is
          reachable from whichever day the Day screen is showing. */}
      <NoteSheet
        target={writingNote}
        defaultAt={noteDefaultAt}
        onSave={(at, title, text, voice, mediaId) => {
          if (writingNote?.kind === 'new') notes.write(at, title, text, voice, mediaId, writingNote.noteKind);
          else if (writingNote) notes.edit(writingNote.note, at, title, text, voice, mediaId);
        }}
        // Null for a note with no picture *and* for one whose picture has been
        // forgotten — the sheet tells the two apart from the note's own
        // `mediaId`, and says so, because a note outliving its photograph is
        // the arrangement rather than a fault.
        attached={noteThumbs.itemFor(noteMediaId)}
        attachedThumbUri={noteThumbs.uriFor(noteMediaId)}
        // Only from a note that exists. A new one has nowhere to come back to
        // yet, and going to the picture would throw away what had been typed.
        onOpenMedia={
          writingNote?.kind === 'edit'
            ? (mediaId) => openMediaFromNote((writingNote as { note: DayNote }).note, mediaId)
            : undefined
        }
        // Only over a note that exists. Deleting is also what emptying the
        // field does, so this is the explicit way rather than the only one.
        onTranscribe={onTranscribe}
        onClose={() => setWritingNote(null)}
      />

      {/* Correcting what a journey was, reached by pulling its row to the left.
          Mode is inferred from speed alone — Core Motion's classifier has no
          Expo binding — so a slow cycle and a fast walk are genuinely hard to
          tell apart, and this is how you say which it was.

          The revert is offered only where there is something to revert, and it
          is not destructive: the detected mode is re-derived from the fixes
          every fold, so taking the correction away is enough to get it back.
          There is no original being overwritten to lose. */}
      <MenuSheet
        visible={correcting !== null}
        title={correcting ? `This was actually…` : undefined}
        items={[
          ...CORRECTABLE.map((mode) => ({
            label: modeLabel(mode),
            onPress: () => {
              if (correcting) journeys.setMode(correcting, mode);
            },
          })),
          ...(correcting?.modeIsManual
            ? [
                {
                  label: 'Use what the app detected',
                  onPress: () => {
                    if (correcting) journeys.setMode(correcting, null);
                  },
                },
              ]
            : []),
        ]}
        onClose={() => setCorrecting(null)}
      />
    </SafeAreaView>
  );
}

/** Everything except `unknown`, which is what the classifier says when it cannot tell, not an answer you give. */
const CORRECTABLE = ACTIVITY_MODES.filter((mode) => mode !== 'unknown');

/**
 * Why a stretch cannot be called one stop, in words.
 *
 * Each one names the thing it found rather than the rule it broke: what somebody
 * wants to know is that there is a drive in there, not that a threshold was
 * exceeded.
 */
function refusalText(refusal: MergeRefusal | null, excursionM: number): string {
  switch (refusal) {
    case 'moved':
      return `You went about ${formatDistance(excursionM)} away in the middle of this, so it was not one stop. Nothing has been changed.`;
    case 'named':
      return 'One of these journeys has a name you gave it. Remove the name first if it really was one stop.';
    case 'capture-elsewhere':
      return 'Something you photographed in here was taken somewhere else, so the app has a position that disagrees.';
    default:
      return 'Pick two different rows, the first one earlier than the second.';
  }
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  screens: { flex: 1 },
  // Absolute fill rather than conditional rendering: every screen keeps its
  // state and its scroll position, and switching costs nothing.
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // A detail page sits over its tab's root, which stays mounted underneath.
  hidden: { display: 'none' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  // A bigger target than the icon needs. With no labels under them the row was
  // as short as an icon and a hair of padding, which is a smaller thing to hit
  // than anything else in the app and the one you reach for most.
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md, minHeight: 56 },
  pressed: { opacity: 0.6 },
});
