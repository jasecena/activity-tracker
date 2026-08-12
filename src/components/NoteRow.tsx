import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { DayNote } from '@/core/day';
import { formatClockTime } from '@/core/format';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface NoteRowProps {
  readonly note: DayNote;
  readonly tzOffsetMinutes: number;
  /** Opens the note for editing. Omitted where the timeline is read-only. */
  readonly onOpen?: (note: DayNote) => void;
}

/**
 * Something you wrote, sitting in the timeline where it happened.
 *
 * Deliberately not shaped like a `SegmentRow`. Every other row on this list is
 * a measurement — a time, a distance, a duration in three neat columns — and a
 * sentence dressed in that furniture would read as another reading the app had
 * taken. So it is a quote: an accent down the left, the words at full width, no
 * statistics and no chevron.
 *
 * The whole text, never a preview. A diary you have to tap to read is a list of
 * the first six words of your own memories, and the entries are a paragraph
 * each — not the sort of thing a timeline needs protecting from.
 */
export const NoteRow = memo(function NoteRow({ note, tzOffsetMinutes, onOpen }: NoteRowProps) {
  const body = (
    <>
      <View style={styles.accent} />
      <View style={styles.inner}>
        <View style={styles.head}>
          <Ionicons name="create-outline" size={13} color={colors.textMuted} />
          <Text style={styles.time}>{formatClockTime(note.at, tzOffsetMinutes)}</Text>
        </View>
        {note.title.length > 0 ? <Text style={styles.noteTitle}>{note.title}</Text> : null}
        {note.text.length > 0 ? <Text style={styles.text}>{note.text}</Text> : null}
      </View>
    </>
  );

  if (!onOpen) return <View style={styles.row}>{body}</View>;

  return (
    <Pressable
      onPress={() => onOpen(note)}
      accessibilityRole="button"
      accessibilityLabel={`Note at ${formatClockTime(note.at, tzOffsetMinutes)}: ${note.title || note.text}`}
      style={({ pressed }) => [styles.row, pressed && styles.pressed]}
    >
      {body}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  // No background of its own: this sits inside the timeline card, which already
  // has one, and a second surface over it would draw a box around the writing.
  // The accent bar is the whole visual difference, and it is enough.
  row: { flexDirection: 'row', paddingVertical: spacing.sm, gap: spacing.sm },
  accent: { width: 3, borderRadius: radius.sm, backgroundColor: colors.stay },
  inner: { flex: 1, gap: spacing.xs },
  head: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  time: { ...typography.caption, color: colors.textMuted },
  noteTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  text: { ...typography.body, color: colors.textPrimary },
  pressed: { opacity: 0.6 },
});
