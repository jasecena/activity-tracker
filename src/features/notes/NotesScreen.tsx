import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import Swipeable from 'react-native-gesture-handler/Swipeable';

import { formatDayTitle } from '@/core/format';
import { groupNotesByDay, type DayNote } from '@/core/day';
import { confirmDestructive } from '@/components/confirmDestructive';
import { NoteRow } from '@/components/NoteRow';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface NotesScreenProps {
  readonly notes: readonly DayNote[];
  readonly tzOffsetMinutes: number;
  readonly onWrite: () => void;
  readonly onOpen: (note: DayNote) => void;
  readonly onForget: (id: string) => void;
}

/**
 * The diary, all of it, newest first.
 *
 * **Its own tab, where it used to be a section of the Day screen.** A note was
 * filed under the day it was about, and reaching one meant walking to its day —
 * which `docs/BACKLOG.md` already recorded as "fine for a week and not for a
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
export function NotesScreen({ notes, tzOffsetMinutes, onWrite, onOpen, onForget }: NotesScreenProps) {
  const days = useMemo(() => groupNotesByDay(notes, tzOffsetMinutes), [notes, tzOffsetMinutes]);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Notes"
        subtitle={notes.length === 1 ? '1 entry' : `${notes.length} entries`}
        actions={[{ label: 'Write a note', icon: 'create-outline', onPress: onWrite }]}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {days.length === 0 ? (
          <Text style={styles.empty}>
            Nothing written yet. Tap the pen to write about today, or hold the microphone and say it.
          </Text>
        ) : (
          days.map((day) => (
            <View key={day.key} style={styles.day}>
              <Text style={styles.dayLabel}>{formatDayTitle(day.startedAt, tzOffsetMinutes)}</Text>

              <View style={styles.card}>
                {day.notes.map((note) => (
                  <SwipeToDelete
                    key={note.id}
                    note={note}
                    tzOffsetMinutes={tzOffsetMinutes}
                    onOpen={onOpen}
                    onForget={onForget}
                  />
                ))}
              </View>
            </View>
          ))
        )}
      </ScrollView>
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
}: {
  readonly note: DayNote;
  readonly tzOffsetMinutes: number;
  readonly onOpen: (note: DayNote) => void;
  readonly onForget: (id: string) => void;
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
        <NoteRow note={note} tzOffsetMinutes={tzOffsetMinutes} onOpen={onOpen} />
      </View>
    </Swipeable>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.md },
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
