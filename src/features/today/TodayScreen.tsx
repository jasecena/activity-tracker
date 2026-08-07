import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { summarizeDay } from '@/core/day';
import { activeCalories } from '@/core/energy';
import { formatDistance, formatDuration } from '@/core/format';
import type { Place } from '@/core/places';
import type { Segment } from '@/core/segments';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SegmentRow } from '@/components/SegmentRow';
import { StatTile } from '@/components/StatTile';
import type { UseSettings } from '@/features/settings/hooks/useSettings';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface TodayScreenProps {
  readonly segments: readonly Segment[];
  readonly places: readonly Place[];
  readonly onOpenSegment: (segment: Segment) => void;
  readonly settings: UseSettings;
  readonly tzOffsetMinutes: number;
  readonly ready: boolean;
}

export function TodayScreen({ segments, places, onOpenSegment, settings, tzOffsetMinutes, ready }: TodayScreenProps) {
  const summary = summarizeDay(segments);
  const calories = activeCalories(segments, settings.settings.weightKg);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Today"
        subtitle={
          ready
            ? `${summary.moveCount === 1 ? '1 journey' : `${summary.moveCount} journeys`} · ${summary.stayCount === 1 ? '1 stop' : `${summary.stayCount} stops`}`
            : 'Reading your day…'
        }
      />

      {/* `handled`, not the default `never`. With the default, the first tap
          anywhere outside a focused TextInput is swallowed to dismiss the
          keyboard — so typing a name and then tapping Record does nothing the
          first time, and the second tap is what actually starts the recording.
          Found by the smoke test, which tapped once and got no recording. */}
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
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

        {/* "Always" is the only state where the app does what it says on the
            tin. Saying so is more useful than a green tick that quietly means
            half. */}
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

        {/* The one place you would notice a coarser route without being told
            why: today's own timeline, while it is being recorded. */}
        {settings.savingBattery && settings.tracking ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Saving battery</Text>
            <Text style={styles.noticeBody}>
              Under 20% left, so today is being recorded at a point every 100 m. Routes will look coarser until the
              phone is charged.
            </Text>
          </View>
        ) : null}

        <View style={styles.stats}>
          <StatTile label="Distance" value={formatDistance(summary.distanceM)} accent={colors.move} />
          <StatTile label="Moving" value={formatDuration(summary.movingMs)} />
          <StatTile label="Calories" value={`${Math.round(calories)}`} accent={colors.success} />
        </View>

        <View style={styles.timeline}>
          {segments.length === 0 ? (
            <Text style={styles.empty}>{ready ? 'Nothing recorded yet today.' : 'Reading your day…'}</Text>
          ) : (
            segments.map((segment) => (
              <SegmentRow
                key={segment.id}
                segment={segment}
                places={places}
                tzOffsetMinutes={tzOffsetMinutes}
                onOpen={onOpenSegment}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
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
  link: { alignItems: 'flex-end', paddingHorizontal: spacing.xs },
  linkText: { ...typography.caption, color: colors.move },
  pressed: { opacity: 0.6 },
});
