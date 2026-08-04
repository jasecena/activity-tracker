import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { summarizeDay, type DayGroup } from '@/core/day';
import { activeCalories } from '@/core/energy';
import { formatDistance, formatDuration, modeLabel } from '@/core/format';
import { visitsByPlace, type Place } from '@/core/places';
import { ACTIVITY_MODES, type Segment } from '@/core/segments';
import { ScreenHeader } from '@/components/ScreenHeader';
import { SegmentRow } from '@/components/SegmentRow';
import { StatTile } from '@/components/StatTile';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

interface DayScreenProps {
  readonly day: DayGroup;
  readonly places: readonly Place[];
  readonly weightKg: number;
  readonly tzOffsetMinutes: number;
  readonly title: string;
  readonly onBack: () => void;
  readonly onOpenSegment: (segment: Segment) => void;
}

/** One finished day, in full. */
export function DayScreen({ day, places, weightKg, tzOffsetMinutes, title, onBack, onOpenSegment }: DayScreenProps) {
  const summary = summarizeDay(day.segments);
  const visits = visitsByPlace(day.segments, places);
  const calories = activeCalories(day.segments, weightKg);

  // Only the modes that actually happened. A row of four zeroes tells you
  // nothing except that the app knows four words.
  const modes = ACTIVITY_MODES.filter((mode) => summary.byMode[mode].count > 0);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={title}
        subtitle={`${formatDistance(summary.distanceM)} · ${formatDuration(summary.movingMs)} moving`}
        onBack={onBack}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stats}>
          <StatTile label="Distance" value={formatDistance(summary.distanceM)} accent={colors.move} />
          <StatTile label="Moving" value={formatDuration(summary.movingMs)} />
          <StatTile label="Calories" value={`${Math.round(calories)}`} accent={colors.success} />
        </View>

        {modes.length > 0 ? (
          <View style={styles.card}>
            {modes.map((mode) => {
              const totals = summary.byMode[mode];
              return (
                <View key={mode} style={styles.modeRow}>
                  <View style={[styles.swatch, { backgroundColor: modeColors[mode] }]} />
                  <Text style={styles.modeName}>{modeLabel(mode)}</Text>
                  <Text style={styles.modeDetail}>
                    {formatDistance(totals.distanceM)} · {formatDuration(totals.durationMs)}
                  </Text>
                </View>
              );
            })}
          </View>
        ) : null}

        {visits.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>PLACES</Text>
            <View style={styles.card}>
              {visits.map((visit) => (
                <View key={visit.place.id} style={styles.modeRow}>
                  <View style={[styles.swatch, { backgroundColor: colors.stay }]} />
                  <Text style={styles.modeName} numberOfLines={1}>
                    {visit.place.name}
                  </Text>
                  <Text style={styles.modeDetail}>{formatDuration(visit.totalMs)}</Text>
                </View>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionLabel}>TIMELINE</Text>
        <View style={styles.timeline}>
          {day.segments.map((segment) => (
            <SegmentRow
              key={segment.id}
              segment={segment}
              places={places}
              tzOffsetMinutes={tzOffsetMinutes}
              onOpen={onOpenSegment}
            />
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  stats: { flexDirection: 'row', gap: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  modeRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  swatch: { width: 8, height: 8, borderRadius: radius.pill },
  modeName: { ...typography.body, color: colors.textPrimary, flex: 1 },
  modeDetail: { ...typography.caption, color: colors.textSecondary },
  sectionLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, marginTop: spacing.sm },
  timeline: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
});
