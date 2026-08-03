import { useState } from 'react';
import { Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { summarizeDay } from '@/core/day';
import { activeCalories } from '@/core/energy';
import { formatDistance, formatDuration } from '@/core/format';
import type { Segment, StaySegment } from '@/core/segments';
import { SegmentRow } from '@/components/SegmentRow';
import { StatTile } from '@/components/StatTile';
import type { UsePlaces } from '@/features/places/hooks/usePlaces';
import { RecordBar } from '@/features/record/components/RecordBar';
import type { UseRecording } from '@/features/record/hooks/useRecording';
import type { UseSettings } from '@/features/settings/hooks/useSettings';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface TodayScreenProps {
  readonly segments: readonly Segment[];
  readonly places: UsePlaces;
  readonly recording: UseRecording;
  readonly settings: UseSettings;
  readonly now: number;
  readonly tzOffsetMinutes: number;
  readonly ready: boolean;
}

export function TodayScreen({ segments, places, recording, settings, now, tzOffsetMinutes, ready }: TodayScreenProps) {
  const [naming, setNaming] = useState<StaySegment | null>(null);
  const [draftName, setDraftName] = useState('');

  const summary = summarizeDay(segments);
  const calories = activeCalories(segments, settings.settings.weightKg);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading} accessibilityRole="header">
        Today
      </Text>

      {!settings.tracking ? (
        <Pressable
          onPress={() => settings.setTracking(true)}
          accessibilityRole="button"
          accessibilityLabel="Start tracking"
          style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
        >
          <Text style={styles.noticeTitle}>Tracking is off</Text>
          <Text style={styles.noticeBody}>
            {settings.permission === 'denied'
              ? 'Location access was declined. Turn it on in iOS Settings to record your day.'
              : 'Tap to start recording where you go. Nothing leaves this phone.'}
          </Text>
        </Pressable>
      ) : null}

      {/* "Always" is the only state where the app does what it says on the tin.
          Saying so is more useful than a green tick that quietly means half. */}
      {settings.tracking && settings.permission === 'when-in-use' ? (
        <Pressable
          onPress={settings.askForPermission}
          accessibilityRole="button"
          accessibilityLabel="Allow background location"
          style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
        >
          <Text style={styles.noticeTitle}>Only recording while open</Text>
          <Text style={styles.noticeBody}>
            Location is set to “While Using”. Your day will have gaps whenever the app is closed.
          </Text>
        </Pressable>
      ) : null}

      <View style={styles.stats}>
        <StatTile label="Distance" value={formatDistance(summary.distanceM)} accent={colors.move} />
        <StatTile label="Moving" value={formatDuration(summary.movingMs)} accent={colors.textPrimary} />
        <StatTile label="Calories" value={`${Math.round(calories)}`} accent={colors.success} />
      </View>

      <RecordBar active={recording.active} now={now} onStart={recording.start} onStop={recording.stop} />

      <View style={styles.timeline}>
        {segments.length === 0 ? (
          <Text style={styles.empty}>{ready ? 'Nothing recorded yet today.' : 'Reading your day…'}</Text>
        ) : (
          segments.map((segment) => (
            <SegmentRow
              key={segment.id}
              segment={segment}
              places={places.places}
              tzOffsetMinutes={tzOffsetMinutes}
              onNamePlace={(candidate) => {
                if (candidate.kind !== 'stay') return;
                setNaming(candidate);
                setDraftName('');
              }}
            />
          ))
        )}
      </View>

      <Modal visible={naming !== null} transparent animationType="fade" onRequestClose={() => setNaming(null)}>
        <View style={styles.modalBackdrop}>
          <View style={styles.modalCard}>
            <Text style={styles.modalTitle}>Name this place</Text>
            <Text style={styles.modalBody}>
              Every future stay within about 120 m is recognised as here. The name never leaves this phone.
            </Text>
            <TextInput
              value={draftName}
              onChangeText={setDraftName}
              placeholder="e.g. abc restaurant"
              placeholderTextColor={colors.textMuted}
              style={styles.modalInput}
              accessibilityLabel="Place name"
              autoFocus
              returnKeyType="done"
            />
            <View style={styles.modalActions}>
              <Pressable
                onPress={() => setNaming(null)}
                accessibilityRole="button"
                accessibilityLabel="Cancel"
                style={({ pressed }) => [styles.modalButton, pressed && styles.pressed]}
              >
                <Text style={styles.modalButtonText}>Cancel</Text>
              </Pressable>
              <Pressable
                onPress={() => {
                  if (naming) places.name(naming, draftName);
                  setNaming(null);
                }}
                accessibilityRole="button"
                accessibilityLabel="Save place"
                style={({ pressed }) => [styles.modalButton, styles.modalPrimary, pressed && styles.pressed]}
              >
                <Text style={[styles.modalButtonText, styles.modalPrimaryText]}>Save</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  heading: { ...typography.title, color: colors.textPrimary },
  stats: { flexDirection: 'row', gap: spacing.sm },
  timeline: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  empty: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center' },
  notice: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: colors.manual,
  },
  noticeTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  noticeBody: { ...typography.caption, color: colors.textSecondary },
  modalBackdrop: { flex: 1, backgroundColor: '#000000CC', justifyContent: 'center', padding: spacing.lg },
  modalCard: { backgroundColor: colors.surface, borderRadius: radius.lg, padding: spacing.lg, gap: spacing.sm },
  modalTitle: { ...typography.title, fontSize: 20, color: colors.textPrimary },
  modalBody: { ...typography.caption, color: colors.textSecondary },
  modalInput: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  modalActions: { flexDirection: 'row', gap: spacing.sm, justifyContent: 'flex-end' },
  modalButton: { paddingHorizontal: spacing.md, paddingVertical: spacing.sm, borderRadius: radius.sm },
  modalButtonText: { ...typography.body, color: colors.textSecondary },
  modalPrimary: { backgroundColor: colors.move },
  modalPrimaryText: { color: colors.onAccent, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
