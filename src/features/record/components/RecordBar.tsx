import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatDuration, modeLabel } from '@/core/format';
import { ACTIVITY_MODES, type ActivityMode, type ManualWindow } from '@/core/segments';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

interface RecordBarProps {
  readonly active: ManualWindow | null;
  readonly now: number;
  readonly onStart: (label: string, mode: ActivityMode) => void;
  readonly onStop: () => void;
}

/** Everything except `unknown`, which is what the classifier says, not something you choose. */
const CHOOSABLE = ACTIVITY_MODES.filter((mode) => mode !== 'unknown');

/**
 * Start and stop a named recording.
 *
 * Worth knowing what this button does *not* do: it does not turn the GPS on.
 * Tracking is either running or it is not, independently, and a recording is a
 * label over the stream that is already there. So this stays enabled and
 * useful even mid-activity, and stopping it cannot lose anything.
 */
export function RecordBar({ active, now, onStart, onStop }: RecordBarProps) {
  const [label, setLabel] = useState('');
  const [mode, setMode] = useState<ActivityMode>('walk');

  if (active) {
    return (
      <View style={[styles.card, styles.recording]}>
        <View style={styles.recordingHeader}>
          <View style={styles.pulse} />
          <Text style={styles.recordingLabel} numberOfLines={1}>
            {active.label}
          </Text>
          <Text style={styles.recordingTime}>{formatDuration(Math.max(0, now - active.startedAt))}</Text>
        </View>
        <Pressable
          onPress={onStop}
          accessibilityRole="button"
          accessibilityLabel={`Stop recording ${active.label}`}
          style={({ pressed }) => [styles.stopButton, pressed && styles.pressed]}
        >
          <Ionicons name="stop" size={16} color={colors.onAccent} />
          <Text style={styles.stopText}>Stop</Text>
        </Pressable>
      </View>
    );
  }

  return (
    <View style={styles.card}>
      <TextInput
        value={label}
        onChangeText={setLabel}
        placeholder="Name this activity"
        placeholderTextColor={colors.textMuted}
        style={styles.input}
        accessibilityLabel="Activity name"
        returnKeyType="done"
      />
      <View style={styles.modes}>
        {CHOOSABLE.map((option) => {
          const selected = option === mode;
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
          onStart(label, mode);
          setLabel('');
        }}
        accessibilityRole="button"
        accessibilityLabel="Start recording"
        style={({ pressed }) => [styles.startButton, pressed && styles.pressed]}
      >
        <Ionicons name="radio-button-on" size={16} color={colors.onAccent} />
        <Text style={styles.startText}>Record</Text>
      </Pressable>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.sm,
  },
  recording: { borderWidth: 1, borderColor: colors.manual },
  recordingHeader: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pulse: { width: 10, height: 10, borderRadius: radius.pill, backgroundColor: colors.danger },
  recordingLabel: { ...typography.body, color: colors.textPrimary, flex: 1 },
  recordingTime: { ...typography.clock, color: colors.manual },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
  },
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
  startButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.move,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
  startText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
  stopButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.xs,
    backgroundColor: colors.manual,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
  },
  stopText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
  pressed: { opacity: 0.6 },
});
