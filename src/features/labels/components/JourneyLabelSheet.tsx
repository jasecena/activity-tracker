import { useState } from 'react';
import { Modal, Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { confirmDestructive } from '@/components/confirmDestructive';
import { formatClockTime, formatDistance, formatDuration, modeLabel } from '@/core/format';
import { ACTIVITY_MODES, durationMs, type ActivityMode, type MoveSegment } from '@/core/segments';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

interface JourneyLabelSheetProps {
  /** The journey being named. Null closes the sheet. */
  readonly journey: MoveSegment | null;
  readonly tzOffsetMinutes: number;
  readonly onSave: (label: string, mode: ActivityMode) => void;
  /**
   * Absent for a journey the engine produced on its own.
   *
   * Present for anything a label made — which now means anything named, since
   * to remove but very much needs undoing.
   */
  readonly onForget?: () => void;
  readonly onClose: () => void;
}

/** Everything except `unknown`, which is what the classifier says, not something you choose. */
const CHOOSABLE = ACTIVITY_MODES.filter((mode) => mode !== 'unknown');

/**
 * Naming a journey, after it happened.
 *
 * The counterpart to `PlacePicker`, and deliberately the same shape: the app
 * already recorded the journey, and this adds the two things it cannot work out
 * for itself — what the journey was for, and which mode it was when speed alone
 * cannot separate a slow cycle from a fast walk.
 *
 * Naming *afterwards* rather than in advance is the point. The old Record
 * button asked you to declare a journey before it had happened, which meant
 * predicting the future, remembering to press Stop, and — when you did not — a
 * label that outlived its day. Here there is nothing to leave running.
 */
export function JourneyLabelSheet({ journey, tzOffsetMinutes, onSave, onForget, onClose }: JourneyLabelSheetProps) {
  const [draft, setDraft] = useState('');
  const [mode, setMode] = useState<ActivityMode | null>(null);

  // Opened fresh each time from the journey itself, so the fields start at what
  // the app currently believes rather than at whatever was typed last.
  const label = draft || (journey?.label ?? '');
  const chosen = mode ?? (journey?.mode === 'unknown' ? 'walk' : (journey?.mode ?? 'walk'));

  const close = () => {
    setDraft('');
    setMode(null);
    onClose();
  };

  return (
    <Modal visible={journey !== null} transparent animationType="slide" onRequestClose={close}>
      <Pressable style={styles.backdrop} onPress={close} accessibilityLabel="Close" />
      <View style={styles.sheet}>
        {journey ? (
          <>
            <Text style={styles.title} accessibilityRole="header">
              Name this journey
            </Text>
            <Text style={styles.subtitle}>
              {formatClockTime(journey.startedAt, tzOffsetMinutes)}–{formatClockTime(journey.endedAt, tzOffsetMinutes)}{' '}
              · {formatDistance(journey.distanceM)} · {formatDuration(durationMs(journey))}
            </Text>

            <TextInput
              value={label}
              onChangeText={setDraft}
              placeholder="Commute, school run, Sunday ride…"
              placeholderTextColor={colors.textMuted}
              style={styles.input}
              accessibilityLabel="Journey name"
              autoFocus
              returnKeyType="done"
              onSubmitEditing={() => {
                onSave(label, chosen);
                close();
              }}
            />

            {/* The classifier reads speed alone, so a slow cycle and a fast walk
                are genuinely ambiguous to it. Your answer wins. */}
            <Text style={styles.sectionLabel}>WHAT WAS IT</Text>
            <View style={styles.modes}>
              {CHOOSABLE.map((option) => {
                const selected = option === chosen;
                return (
                  <Pressable
                    key={option}
                    onPress={() => setMode(option)}
                    accessibilityRole="radio"
                    accessibilityState={{ selected }}
                    accessibilityLabel={modeLabel(option)}
                    style={({ pressed }) => [
                      styles.chip,
                      selected && { backgroundColor: modeColors[option], borderColor: modeColors[option] },
                      pressed && styles.pressed,
                    ]}
                  >
                    <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{modeLabel(option)}</Text>
                  </Pressable>
                );
              })}
            </View>

            <Pressable
              onPress={() => {
                onSave(label, chosen);
                close();
              }}
              disabled={label.trim().length === 0}
              accessibilityRole="button"
              accessibilityLabel="Save this name"
              style={({ pressed }) => [
                styles.save,
                label.trim().length === 0 && styles.saveDisabled,
                pressed && styles.pressed,
              ]}
            >
              <Text style={styles.saveText}>Save</Text>
            </Pressable>

            {onForget ? (
              <Pressable
                onPress={() =>
                  confirmDestructive({
                    title: 'Remove this name?',
                    message: 'The journey stays; the name you gave it goes and cannot be recovered.',
                    confirmLabel: 'Remove',
                    onConfirm: () => {
                      onForget();
                      close();
                    },
                  })
                }
                accessibilityRole="button"
                accessibilityLabel="Remove this name"
                style={({ pressed }) => [styles.forget, pressed && styles.pressed]}
              >
                <Text style={styles.forgetText}>Remove this name</Text>
              </Pressable>
            ) : null}

            <Text style={styles.footnote}>
              The journey itself was recorded either way. A name only says what it was, and the mode you pick overrules
              the one worked out from speed.
            </Text>
          </>
        ) : null}
      </View>
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
  subtitle: { ...typography.caption, color: colors.textSecondary },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.sm,
  },
  sectionLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, marginTop: spacing.sm },
  modes: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextSelected: { color: colors.onAccent, fontWeight: '600' },
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
  footnote: { ...typography.caption, color: colors.textMuted },
  pressed: { opacity: 0.6 },
});
