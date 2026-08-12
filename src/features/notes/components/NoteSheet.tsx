import DateTimePicker from '@react-native-community/datetimepicker';
import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import type { DayNote } from '@/core/day';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface NoteSheetProps {
  /**
   * What the sheet is for, or null to close it.
   *
   * `{ kind: 'new' }` writes one about the day on screen; `{ kind: 'edit' }`
   * changes one already written. The two are one sheet because they are one
   * thing with one field, and a second component would only be the first with
   * the title swapped.
   */
  readonly target: { readonly kind: 'new' } | { readonly kind: 'edit'; readonly note: DayNote } | null;
  /**
   * When the note goes, unless it is changed here.
   *
   * Now for today, the end of the day for one already over, and the note's own
   * instant when editing. Worked out by the caller because it is the layer that
   * may read a clock — `core` takes `now` as a parameter, always.
   */
  readonly defaultAt: number;
  readonly onSave: (at: number, title: string, text: string) => void;
  readonly onForget?: () => void;
  readonly onClose: () => void;
}

/**
 * Writing something down about a day.
 *
 * A sheet rather than a page, following `JourneyLabelSheet`: this is one field
 * over the thing it is about, and pushing a screen for it would put the day out
 * of sight at the moment you are trying to describe it.
 *
 * The field is multiline and grows, and there is no character limit. A diary
 * that stops you mid-sentence is not one.
 */
export function NoteSheet({ target, defaultAt, onSave, onForget, onClose }: NoteSheetProps) {
  const [draftTitle, setDraftTitle] = useState<string | null>(null);
  const [draft, setDraft] = useState<string | null>(null);
  /**
   * The instant chosen here, or null for "whatever the caller suggested".
   *
   * Null rather than a copy of `defaultAt`, so that a sheet left open across a
   * change of day — or opened on a different note — starts from the new default
   * instead of the last one. The same reason the text field holds a nullable
   * draft rather than being seeded in an effect.
   */
  const [chosen, setChosen] = useState<number | null>(null);

  // Opened fresh from the note itself each time, so the fields start at what is
  // stored rather than at whatever was typed into them last.
  const existing = target?.kind === 'edit' ? target.note : null;
  const title = draftTitle ?? existing?.title ?? '';
  const text = draft ?? existing?.text ?? '';
  const at = chosen ?? defaultAt;

  // Either field is enough. A title alone says the day — "Moved house" — and so
  // does a paragraph nobody wanted to name.
  const empty = title.trim().length === 0 && text.trim().length === 0;

  const close = () => {
    setDraftTitle(null);
    setDraft(null);
    setChosen(null);
    onClose();
  };

  const save = () => {
    onSave(at, title, text);
    close();
  };

  /**
   * Take the date from one picker and the time from the other.
   *
   * Both pickers hand back a whole `Date`, so using either wholesale would
   * silently reset the half it was not asked about — pick a date and lose the
   * time you set a moment ago. Composed in local time, which is what both
   * pickers speak and what a diary means by "half past two".
   */
  const setDatePart = (picked: Date) => {
    const next = new Date(at);
    next.setFullYear(picked.getFullYear(), picked.getMonth(), picked.getDate());
    setChosen(next.getTime());
  };

  const setTimePart = (picked: Date) => {
    const next = new Date(at);
    next.setHours(picked.getHours(), picked.getMinutes(), 0, 0);
    setChosen(next.getTime());
  };

  return (
    <Modal visible={target !== null} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
      <KeyboardAvoidingView behavior="padding">
        <View style={styles.sheet}>
          {target ? (
            <>
              <Text style={styles.title} accessibilityRole="header">
                {target.kind === 'edit' ? 'Edit this note' : 'Write about this day'}
              </Text>

              {/* The compact iOS style: two small fields that open a popover
                  when tapped, rather than a wheel that owns a third of the
                  sheet. They start at the sensible answer, so getting one is
                  free and changing it costs one tap. */}
              <View style={styles.when}>
                <DateTimePicker
                  value={new Date(at)}
                  mode="date"
                  display="compact"
                  accessibilityLabel="Date this note is about"
                  themeVariant="dark"
                  onChange={(_event, picked) => picked && setDatePart(picked)}
                />
                <DateTimePicker
                  value={new Date(at)}
                  mode="time"
                  display="compact"
                  accessibilityLabel="Time this note is about"
                  themeVariant="dark"
                  onChange={(_event, picked) => picked && setTimePart(picked)}
                />
              </View>

              <TextInput
                value={title}
                onChangeText={setDraftTitle}
                placeholder="Title"
                placeholderTextColor={colors.textMuted}
                style={styles.titleInput}
                accessibilityLabel="Note title"
                autoFocus
                returnKeyType="next"
              />

              <TextInput
                value={text}
                onChangeText={setDraft}
                placeholder="What happened, who you were with, what it was like…"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                accessibilityLabel="Note"
                multiline
                textAlignVertical="top"
                /* No `returnKeyType: done` and no submit handler: return has to
                   put in a paragraph break. A diary entry is not a search box. */
              />

              <Pressable
                onPress={save}
                disabled={empty}
                accessibilityRole="button"
                accessibilityLabel="Save this note"
                style={({ pressed }) => [styles.save, empty && styles.saveDisabled, pressed && styles.pressed]}
              >
                <Text style={styles.saveText}>Save</Text>
              </Pressable>

              {onForget ? (
                <Pressable
                  onPress={() => {
                    onForget();
                    close();
                  }}
                  accessibilityRole="button"
                  accessibilityLabel="Delete this note"
                  style={({ pressed }) => [styles.forget, pressed && styles.pressed]}
                >
                  <Text style={styles.forgetText}>Delete this note</Text>
                </Pressable>
              ) : null}
            </>
          ) : null}
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.6)' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xxl,
    gap: spacing.sm,
  },
  title: { ...typography.title, color: colors.textPrimary },
  when: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, marginTop: spacing.xs },
  titleInput: {
    ...typography.title,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
    minHeight: 120,
  },
  save: {
    backgroundColor: colors.move,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.sm,
  },
  saveDisabled: { opacity: 0.4 },
  saveText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
  forget: { alignItems: 'center', paddingVertical: spacing.sm },
  forgetText: { ...typography.caption, color: colors.danger },
  pressed: { opacity: 0.6 },
});
