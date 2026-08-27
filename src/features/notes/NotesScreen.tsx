import { Ionicons } from '@expo/vector-icons';
import { useCallback, useMemo, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

import { formatDayTitle, formatDuration, formatTimecode } from '@/core/format';
import type { Agenda } from '@/core/agenda';
import {
  groupNotesByDay,
  notesOfKind,
  splitAtNow,
  type DayNote,
  type NoteDay,
  type NoteKind,
  type NoteVoice,
} from '@/core/day';
import { confirmDestructive } from '@/components/confirmDestructive';
import { NoteRow } from '@/components/NoteRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, radius, spacing, typography } from '@/theme/tokens';

import { AgendaSection } from './components/AgendaSection';
import { NoteKindSwitch } from './components/NoteKindSwitch';
import { RecordButton } from './components/RecordButton';
import { MAX_VOICE_MS, useVoiceNote } from './hooks/useVoiceNote';

/**
 * Bigger than the sheet's, on purpose.
 *
 * It is the only control on this screen that is an *action* rather than a way
 * of reading what is already there, and it is meant to be found without
 * looking — the pen is for when you have sat down, and this is for when you
 * have not.
 */
const QUICK_MIC_SIZE = 76;

/**
 * How far the microphone floats above the tab bar.
 *
 * It sat at `spacing.md` and read as crowded against the bar beneath it — a
 * control that large wants air under it, or it looks like part of the chrome
 * rather than a thing you press.
 *
 * Named rather than written twice, because the list's bottom padding is
 * measured from it: the last row has to clear the button, so the two numbers
 * have to move together or scrolling to the end hides an entry behind it.
 */
const DOCK_BOTTOM = spacing.xl;

interface NotesScreenProps {
  readonly notes: readonly DayNote[];
  readonly tzOffsetMinutes: number;
  /**
   * Where the line between written and planned falls.
   *
   * A parameter rather than a clock read here, like every other date decision —
   * and it only has to be roughly right: a note crossing from ahead to behind is
   * a heading moving, not data changing.
   */
  readonly now: number;
  /** Open the sheet on a new entry of the kind currently being shown. */
  readonly onWrite: (kind: NoteKind) => void;
  /**
   * File a recording as a note of its own, at the instant the talking started.
   *
   * The whole of the quick microphone: there is no sheet, no fields and no
   * Save, because a recording alone is already a note — the same rule that lets
   * a title alone be one, or a paragraph nobody wanted to name.
   */
  readonly onSpeak: (voice: NoteVoice, startedAt: number, kind: NoteKind) => void;
  readonly onOpen: (note: DayNote) => void;
  readonly onForget: (id: string) => void;
  /**
   * The thumbnail of the capture a note is about, or null.
   *
   * A function rather than a list of captures, so this screen never has to know
   * what a `MediaItem` is: the shell holds both stores and the one thumbnail
   * cache, and hands down the only question the diary asks of the media
   * library.
   */
  readonly thumbFor?: (mediaId: string | null) => string | null;
  /**
   * What the Plans queue has to say about itself, or null when it has nothing.
   *
   * Shown on the Plans list only, because that is where the plans are. A queue
   * nobody can see is a queue that fails silently, and this one is not a press —
   * a phone with no bucket would otherwise hold everything for ever and look
   * perfectly healthy.
   */
  readonly planNote?: string | null;
  /**
   * The Send button, or nothing when there is no bucket to send to.
   *
   * **A press, because this used to happen by itself.** Plans go somewhere a
   * machine reads them and writes what a model decided into a database, so a
   * transcript nobody read becomes a wrong row somebody has to go and find.
   * Sending is now the moment you say the words are right — which is why the
   * button sits under the count rather than anywhere else, and why it is absent
   * rather than disabled when no bucket is configured: `planNote` already says
   * to add one, and a dead control says it worse.
   */
  readonly planSend?: {
    readonly waiting: number;
    readonly busy: boolean;
    readonly onSend: () => void;
  } | null;
  /** What the machine at home decided, and the controls for it. Plans list only. */
  readonly agenda?: {
    readonly agenda: Agenda;
    readonly busy: boolean;
    readonly note: string | null;
    readonly onRefresh: () => void;
  };
}

/**
 * The diary, all of it, newest first.
 *
 * **Its own tab, where it used to be a section of the Day screen.** A note was
 * filed under the day it was about, and reaching one meant walking to its day —
 * which the backlog already recorded as "fine for a week and not for a
 * year". Moving it out is what makes the whole diary one list instead of a
 * drawer on each of three hundred pages, and it is why the Day screen no longer
 * carries notes at all: the same rows in two places is two things to keep in
 * step and one of them always slightly wrong, which is the reasoning that
 * retired `MediaScreen`.
 *
 * **Grouped by day, because a diary is indexed by the date.** Same rule as
 * everywhere else here — the time is a detail within the day — so the headings
 * are days and the rows underneath them are the entries, newest first in both
 * directions. `groupNotesByDay` does the arithmetic in `core`, where it is
 * testable without a phone.
 *
 * **A row is a heading and a play button.** Not the entry: the whole text lives
 * one tap away in the sheet, which is also where it can be edited. A list of
 * full entries is a wall of text to scroll past, and "which note is which" is
 * what a list is for.
 */
export function NotesScreen({
  notes,
  tzOffsetMinutes,
  now,
  onWrite,
  onSpeak,
  onOpen,
  onForget,
  thumbFor,
  planNote,
  planSend,
  agenda,
}: NotesScreenProps) {
  /**
   * What has happened and what has not, read in opposite directions.
   *
   * A note can be dated ahead — writing towards a meeting next week and adding
   * to it over the days before is the point of allowing it — and the two halves
   * want different orders. What has happened is a record, so it reads backwards
   * from now; what has not is a plan, so it reads forwards to the next thing.
   * Both put the entry nearest to now first.
   */
  /**
   * Which half is on screen, and therefore what the microphone writes.
   *
   * Plain state rather than something derived or lifted: it is a view mode this
   * screen owns, nothing above it needs to know, and it is not a reading of any
   * data — so there is nothing here for `react-hooks/set-state-in-effect` to be
   * right about.
   */
  const [kind, setKind] = useState<NoteKind>('note');

  const counts = useMemo(
    () => ({ note: notesOfKind(notes, 'note').length, plan: notesOfKind(notes, 'plan').length }),
    [notes],
  );

  // **Filtered before anything else touches them.** Everything below — the cut
  // at now, the grouping, the headings — is the same arithmetic either side, so
  // it runs over one list rather than learning there are two.
  const shown = useMemo(() => notesOfKind(notes, kind), [notes, kind]);

  const { ahead, behind } = useMemo(() => splitAtNow(shown, now), [shown, now]);
  const upcoming = useMemo(() => groupNotesByDay(ahead, tzOffsetMinutes, 'soonest'), [ahead, tzOffsetMinutes]);
  const days = useMemo(() => groupNotesByDay(behind, tzOffsetMinutes), [behind, tzOffsetMinutes]);

  const plans = kind === 'plan';

  /**
   * The quick microphone's recorder.
   *
   * A second instance of the same hook the sheet uses rather than a second way
   * of recording: the permission, the position read at the *start*, the screen
   * held awake across the save, the twenty-minute cap and the audio mode given
   * back afterwards are all things that were expensive to get right once. The
   * two are kept from recording at the same time inside the hook — see its
   * `holder` — because they are mounted together whichever tab is showing.
   *
   * `onSpeak` is passed straight through, so the recording lands as a note
   * without a render in between. The list is what says it worked: the new entry
   * appears at the top of today, which is where the eye already is.
   */
  /**
   * Which list the talking *started* in.
   *
   * A ref, and for exactly the reason the capture position is one: `stop`
   * resolves inside a closure created before it, so what the handler needs is
   * the value at the press rather than the value now. Switching to the other
   * list halfway through a sentence must not re-file what you are still saying
   * — you pressed the microphone under Plans, so it is a plan.
   *
   * Never read during render, which is all `react-hooks/refs` asks.
   */
  const startedIn = useRef<NoteKind>('note');

  const file = useCallback(
    (voice: NoteVoice, startedAt: number) => onSpeak(voice, startedAt, startedIn.current),
    [onSpeak],
  );

  const recorder = useVoiceNote(file);

  const start = useCallback(() => {
    startedIn.current = kind;
    recorder.start();
  }, [kind, recorder]);

  /**
   * Changing list ends a recording rather than carrying it across.
   *
   * **The alternative was letting it run**, filed under wherever it started, and
   * that was wrong for the reason the switch exists at all: this control's whole
   * claim is that the list you are looking at is the list you are writing into.
   * A running recording that belongs to the other list breaks exactly that, and
   * it does it invisibly — the counter keeps going while the screen underneath
   * says something else.
   *
   * Nothing is lost by stopping. `stop` saves what has been said so far and
   * files it, so this is not `confirmDestructive`'s bar: it is finishing a
   * recording early, not discarding one.
   *
   * **The ref above is still load-bearing, and for a different reason now.**
   * `stop` flips `recording` before its first `await` but saves behind that, so
   * the handler runs after `setKind` has already changed the state. Reading the
   * state there would file the recording under the list you just moved to.
   */
  const changeKind = useCallback(
    (next: NoteKind) => {
      if (next === kind) return;
      if (recorder.recording) recorder.stop();
      setKind(next);
    },
    [kind, recorder],
  );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Notes"
        // The switch below already carries both counts, so the subtitle says
        // what the list on screen is *for* instead of repeating the arithmetic.
        subtitle={plans ? 'Things you want to happen' : "Everything you've written"}
        actions={[
          {
            label: plans ? 'Write a plan' : 'Write a note',
            icon: 'create-outline',
            onPress: () => onWrite(kind),
          },
        ]}
      />

      {plans && planNote ? <Text style={styles.planNote}>{planNote}</Text> : null}

      {plans && planSend && planSend.waiting > 0 ? (
        <Pressable
          onPress={planSend.onSend}
          disabled={planSend.busy}
          accessibilityRole="button"
          accessibilityLabel="Send plans"
          style={({ pressed }) => [styles.send, pressed && styles.sendPressed, planSend.busy && styles.sendBusy]}
        >
          <Text style={styles.sendText}>
            {planSend.busy ? 'Sending…' : planSend.waiting === 1 ? 'Send 1 plan' : `Send ${planSend.waiting} plans`}
          </Text>
        </Pressable>
      ) : null}

      <ScrollView contentContainerStyle={styles.content}>
        {/* **Above the plans, and inside the scroller.** What is next is why you
            opened this list, so it is the first thing; but it scrolls away,
            because the plans underneath are what the microphone writes into and
            a permanently pinned panel would take the top of the page from them.
            The same trade the Day screen makes with its map. */}
        {plans && agenda ? (
          <AgendaSection
            agenda={agenda.agenda}
            tzOffsetMinutes={tzOffsetMinutes}
            now={now}
            busy={agenda.busy}
            note={agenda.note}
            onRefresh={agenda.onRefresh}
          />
        ) : null}

        {/* **Ahead of now, in a dashed box at the top.** Dashed rather than a
            colour or a badge: an outline that is not solid reads as "not settled
            yet" without needing a legend, and it survives the greyscale and
            colourblind cases a tint would not. At the top because the next thing
            coming is what you opened this for — a week of notes towards a
            meeting is only useful if the meeting is the first thing you see. */}
        {upcoming.length > 0 ? (
          <View style={styles.ahead}>
            <Text style={styles.aheadLabel}>COMING UP</Text>
            {upcoming.map((day) => (
              <Day
                key={day.key}
                day={day}
                tzOffsetMinutes={tzOffsetMinutes}
                onOpen={onOpen}
                onForget={onForget}
                thumbFor={thumbFor}
              />
            ))}
          </View>
        ) : null}

        {days.length === 0 && upcoming.length === 0 ? (
          <Text style={styles.empty}>
            {plans
              ? 'No plans yet. Tap the microphone to say what you want to happen.'
              : 'Nothing written yet. Tap the microphone to say something, or the pen to write it.'}
          </Text>
        ) : (
          days.map((day) => (
            <Day
              key={day.key}
              day={day}
              tzOffsetMinutes={tzOffsetMinutes}
              onOpen={onOpen}
              onForget={onForget}
              thumbFor={thumbFor}
            />
          ))
        )}
      </ScrollView>

      {/* **The microphone is the screen's lower edge, and the pen is in the
          header.** They are not two features to choose between: they are the
          two ways of putting words in the same diary, and the reason this one
          is bigger and lower is that it is the one reached for with something
          to say and no time to sit down. The pen leads to a sheet with fields
          and a Save; this leads to a note, already written.

          `box-none` on the dock, so the list scrolls behind it everywhere
          except on the button itself. A floating control that ate a strip of
          the screen's own scrolling would be worse than one that was simply
          in the way. */}
      <View style={styles.dock} pointerEvents="box-none">
        <View style={styles.dockLabel}>
          {recorder.recording ? (
            <>
              <Text style={styles.clock}>{formatTimecode(recorder.elapsedMs)}</Text>
              {/* The ceiling, said while there is still time to act on it. The
                  recorder stops itself there and says so, but being told
                  afterwards is a worse place to find out. */}
              <Text style={styles.hint}>Stops at {formatDuration(MAX_VOICE_MS)}</Text>
            </>
          ) : recorder.saving ? (
            <Text style={styles.hint}>Saving…</Text>
          ) : (
            <Text style={styles.hint}>{plans ? 'Tap to say a plan' : 'Tap to say something'}</Text>
          )}
        </View>

        {/* **The two lists and the microphone, on one row, at thumb height.**
            The switch used to sit above the scroller so it could not be
            scrolled away. That reasoning was about it staying visible; it is
            pinned here for the same reason and reachable as well, which the top
            of a phone is not. The microphone between them is not decoration:
            the tab you are standing in is the mode it records into, so the
            control and the thing it governs now touch. */}
        <NoteKindSwitch kind={kind} onChange={changeKind} counts={counts}>
          <RecordButton size={QUICK_MIC_SIZE} recording={recorder.recording} onStart={start} onStop={recorder.stop} />
        </NoteKindSwitch>
      </View>
    </View>
  );
}

/** One day's heading and its entries. The same shape either side of now. */
function Day({
  day,
  tzOffsetMinutes,
  onOpen,
  onForget,
  thumbFor,
}: {
  readonly day: NoteDay;
  readonly tzOffsetMinutes: number;
  readonly onOpen: (note: DayNote) => void;
  readonly onForget: (id: string) => void;
  readonly thumbFor?: (mediaId: string | null) => string | null;
}) {
  return (
    <View style={styles.day}>
      <Text style={styles.dayLabel}>{formatDayTitle(day.startedAt, tzOffsetMinutes)}</Text>

      <View style={styles.card}>
        {day.notes.map((note) => (
          <SwipeToDelete
            key={note.id}
            note={note}
            tzOffsetMinutes={tzOffsetMinutes}
            onOpen={onOpen}
            onForget={onForget}
            thumbUri={thumbFor?.(note.mediaId) ?? null}
          />
        ))}
      </View>
    </View>
  );
}

/**
 * One row, with Delete behind it.
 *
 * **A library rather than a `PanResponder`, and that is a reversal worth
 * naming.** A hand-rolled swipe on a row in a vertically scrolling list was
 * built here once and withdrawn — it had to hand the horizontal drag back to
 * the scroller often enough that it "simply did not work" on a phone, and the
 * rule that replaced it was to use a long press instead. That rule stands for
 * anything built out of `PanResponder`; what changed is that
 * `react-native-gesture-handler` does not use one. Its recognisers are native
 * and negotiate with the scroll view through the platform's own failure and
 * simultaneity relationships, which is the thing the responder system cannot
 * express and the reason UIKit's own swipe actions feel reliable.
 *
 * **Revealing Delete is not deleting.** The swipe uncovers a button, pressing
 * it asks, and only then does the note go — two deliberate acts and a
 * confirmation for something nothing can reconstruct. That is also why the
 * sheet's "Delete this note" text button could go: this is a better place for
 * it than a row of red text under a form.
 */
function SwipeToDelete({
  note,
  tzOffsetMinutes,
  onOpen,
  onForget,
  thumbUri,
}: {
  readonly note: DayNote;
  readonly tzOffsetMinutes: number;
  readonly onOpen: (note: DayNote) => void;
  readonly onForget: (id: string) => void;
  readonly thumbUri: string | null;
}) {
  return (
    <Swipeable
      renderRightActions={() => (
        <Pressable
          onPress={() =>
            confirmDestructive({
              title: 'Delete this note?',
              message: 'The words and any recording on it go, and cannot be recovered.',
              confirmLabel: 'Delete',
              onConfirm: () => onForget(note.id),
            })
          }
          accessibilityRole="button"
          accessibilityLabel={`Delete the note at ${formatDayTitle(note.at, tzOffsetMinutes)}`}
          style={({ pressed }) => [styles.delete, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={20} color={colors.onAccent} />
          <Text style={styles.deleteText}>Delete</Text>
        </Pressable>
      )}
      // Enough travel that a hesitant drag does not open it, and not so much
      // that a deliberate one has to be a whole swipe across the screen.
      rightThreshold={40}
    >
      <View style={styles.row}>
        <NoteRow note={note} tzOffsetMinutes={tzOffsetMinutes} onOpen={onOpen} thumbUri={thumbUri} />
      </View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  send: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
  },
  sendBusy: { opacity: 0.4 },
  sendPressed: { opacity: 0.6 },
  sendText: { fontSize: 16, fontWeight: '600', color: colors.textPrimary },
  planNote: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    fontSize: 13,
    color: colors.textMuted,
  },
  screen: { flex: 1 },
  // Deep enough that the last row clears the microphone rather than sitting
  // under it: a list whose final entry can never be read is a list missing an
  // entry, as far as anybody scrolling to the bottom can tell.
  content: {
    paddingHorizontal: spacing.md,
    // The button, the gap it floats in, and room for the label above it. Derived
    // from `DOCK_BOTTOM` rather than written as its own number, so lifting the
    // microphone cannot leave the last row hidden behind it.
    paddingBottom: QUICK_MIC_SIZE + DOCK_BOTTOM + spacing.xxl,
    gap: spacing.md,
  },
  dock: { position: 'absolute', left: 0, right: 0, bottom: DOCK_BOTTOM, alignItems: 'stretch', gap: spacing.xs },
  // Its own ground, because it floats over whatever the list happens to have
  // scrolled under it.
  dockLabel: {
    alignSelf: 'center',
    alignItems: 'center',
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
  },
  clock: { ...typography.clock, color: colors.danger },
  hint: { ...typography.caption, color: colors.textMuted },
  ahead: {
    gap: spacing.sm,
    padding: spacing.sm,
    borderWidth: 1,
    borderStyle: 'dashed',
    borderColor: colors.border,
    borderRadius: radius.md,
  },
  aheadLabel: { ...typography.label, fontSize: 11, color: colors.move },
  day: { gap: spacing.xs },
  dayLabel: { ...typography.label, fontSize: 11, color: colors.textMuted },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  // The row needs its own ground: it slides over the Delete button behind it,
  // and a transparent row would show the red through the words.
  row: { backgroundColor: colors.surface, paddingHorizontal: spacing.md },
  delete: {
    backgroundColor: colors.danger,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.xs,
    paddingHorizontal: spacing.lg,
  },
  deleteText: { ...typography.caption, fontWeight: '600', color: colors.onAccent },
  empty: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center' },
  pressed: { opacity: 0.7 },
});
