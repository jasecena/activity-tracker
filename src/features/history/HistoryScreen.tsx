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
}

/**
 * Finished days, newest first.
 *
 * A summary per day and the places in it, with the full timeline one tap away on
 * its own page. The previous version expanded rows inline, which meant a long
 * day pushed everything below it off the screen and there was no way back to
 * where you had been.
 */
export function HistoryScreen({ days, places, tzOffsetMinutes, onOpenDay }: HistoryScreenProps) {
  return (
    <View style={styles.screen}>
      <ScreenHeader title="History" subtitle={days.length === 1 ? '1 day' : `${days.length} days`} />

      <ScrollView contentContainerStyle={styles.content}>
        {days.length === 0 ? (
          <Text style={styles.empty}>Finished days appear here after midnight.</Text>
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
