import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { summarizeDay, type DayGroup } from '@/core/day';
import { formatDayTitle, formatDistance, formatDuration } from '@/core/format';
import { visitsByPlace, type Place } from '@/core/places';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface HistoryScreenProps {
  readonly days: readonly DayGroup[];
  readonly places: readonly Place[];
  readonly tzOffsetMinutes: number;
  readonly onOpenDay: (day: DayGroup) => void;
  /** History is a page under the day view now, so it has somewhere to go back to. */
  readonly onBack: () => void;
}

/**
 * Every day, newest first — for going further back than the day view's arrows
 * are worth using.
 *
 * A summary per day and the places in it. Choosing one does not open a page of
 * its own: it sets the day being shown and closes this list, because the day
 * view is where you were going and a second renderer of a day is what this
 * whole restructure removed.
 */
export function HistoryScreen({ days, places, tzOffsetMinutes, onOpenDay, onBack }: HistoryScreenProps) {
  return (
    <View style={styles.screen}>
      <ScreenHeader title="All days" subtitle={days.length === 1 ? '1 day' : `${days.length} days`} onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content}>
        {days.length === 0 ? (
          <Text style={styles.empty}>Days appear here as they are recorded.</Text>
        ) : (
          days.map((day) => {
            const summary = summarizeDay(day.segments);
            const visits = visitsByPlace(day.segments, places);
            const title = formatDayTitle(day.startedAt, tzOffsetMinutes);

            return (
              <Pressable
                key={day.key}
                onPress={() => onOpenDay(day)}
                accessibilityRole="button"
                accessibilityLabel={`${title}, ${formatDistance(summary.distanceM)}, ${formatDuration(summary.movingMs)} moving`}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <Text style={styles.cardTitle}>{title}</Text>
                <Text style={styles.cardDetail}>
                  {formatDistance(summary.distanceM)} · {formatDuration(summary.movingMs)} moving ·{' '}
                  {summary.moveCount === 1 ? '1 journey' : `${summary.moveCount} journeys`}
                </Text>
                {/* Named places first: "where was I" is the question people
                    actually bring to an old day. */}
                {visits.length > 0 ? (
                  <Text style={styles.places} numberOfLines={1}>
                    {visits
                      .slice(0, 3)
                      .map((visit) => visit.place.name)
                      .join(' · ')}
                  </Text>
                ) : null}
              </Pressable>
            );
          })
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  cardTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  cardDetail: { ...typography.caption, color: colors.textSecondary },
  places: { ...typography.caption, color: colors.stay },
  empty: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center' },
  pressed: { opacity: 0.6 },
});
