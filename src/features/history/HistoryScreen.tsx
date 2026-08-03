import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { summarizeDay, type DayGroup } from '@/core/day';
import { activeCalories } from '@/core/energy';
import { formatDistance, formatDuration } from '@/core/format';
import { visitsByPlace, type Place } from '@/core/places';
import { SegmentRow } from '@/components/SegmentRow';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface HistoryScreenProps {
  readonly days: readonly DayGroup[];
  readonly places: readonly Place[];
  readonly weightKg: number;
  readonly tzOffsetMinutes: number;
}

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'] as const;
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const;

/**
 * A day's heading, from its local midnight.
 *
 * `startedAt` is already the instant local midnight began, so reading UTC
 * components off it after shifting gives the local date without the runtime's
 * own zone getting involved — the same trick, and the same reason, as
 * `core/day/dayKeyOf`.
 */
function headingFor(startedAt: number, tzOffsetMinutes: number): string {
  const local = new Date(startedAt + tzOffsetMinutes * 60_000);
  const weekday = WEEKDAYS[local.getUTCDay()] ?? '';
  const month = MONTHS[local.getUTCMonth()] ?? '';
  return `${weekday} ${local.getUTCDate()} ${month}`;
}

export function HistoryScreen({ days, places, weightKg, tzOffsetMinutes }: HistoryScreenProps) {
  const [expanded, setExpanded] = useState<string | null>(null);

  return (
    <ScrollView contentContainerStyle={styles.content}>
      <Text style={styles.heading} accessibilityRole="header">
        History
      </Text>

      {days.length === 0 ? (
        <Text style={styles.empty}>Finished days appear here after midnight.</Text>
      ) : (
        days.map((day) => {
          const summary = summarizeDay(day.segments);
          const open = expanded === day.key;
          const visits = visitsByPlace(day.segments, places);

          return (
            <View key={day.key} style={styles.card}>
              <Pressable
                onPress={() => setExpanded(open ? null : day.key)}
                accessibilityRole="button"
                accessibilityState={{ expanded: open }}
                accessibilityLabel={`${headingFor(day.startedAt, tzOffsetMinutes)}, ${formatDistance(summary.distanceM)}, ${formatDuration(summary.movingMs)} moving`}
                style={({ pressed }) => [styles.cardHeader, pressed && styles.pressed]}
              >
                <View style={styles.cardTitleBlock}>
                  <Text style={styles.cardTitle}>{headingFor(day.startedAt, tzOffsetMinutes)}</Text>
                  <Text style={styles.cardDetail}>
                    {formatDistance(summary.distanceM)} · {formatDuration(summary.movingMs)} moving ·{' '}
                    {Math.round(activeCalories(day.segments, weightKg))} kcal
                  </Text>
                </View>
              </Pressable>

              {/* Named places, before the timeline: "where was I" is the
                  question people actually bring to an old day. */}
              {visits.length > 0 ? (
                <View style={styles.places}>
                  {visits.slice(0, 3).map((visit) => (
                    <Text key={visit.place.id} style={styles.place} numberOfLines={1}>
                      {visit.place.name} · {formatDuration(visit.totalMs)}
                    </Text>
                  ))}
                </View>
              ) : null}

              {open ? (
                <View style={styles.timeline}>
                  {day.segments.map((segment) => (
                    <SegmentRow key={segment.id} segment={segment} places={places} tzOffsetMinutes={tzOffsetMinutes} />
                  ))}
                </View>
              ) : null}
            </View>
          );
        })
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  content: { padding: spacing.md, gap: spacing.md, paddingBottom: spacing.xxl },
  heading: { ...typography.title, color: colors.textPrimary },
  empty: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center' },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, overflow: 'hidden' },
  cardHeader: { padding: spacing.md },
  cardTitleBlock: { gap: spacing.xs },
  cardTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  cardDetail: { ...typography.caption, color: colors.textSecondary },
  places: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm, gap: 2 },
  place: { ...typography.caption, color: colors.stay },
  timeline: {
    paddingHorizontal: spacing.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  pressed: { opacity: 0.6 },
});
