import { useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatDistance, formatDuration } from '@/core/format';
import { visitsByPlace, type Place } from '@/core/places';
import type { Segment } from '@/core/segments';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface PlacesScreenProps {
  readonly places: readonly Place[];
  /** Everything known, today and history, so visit counts cover the whole diary. */
  readonly allSegments: readonly Segment[];
  readonly onOpen: (place: Place) => void;
}

type SortKey = 'time' | 'visits' | 'name';

const SORTS: readonly { readonly key: SortKey; readonly label: string }[] = [
  { key: 'time', label: 'Time spent' },
  { key: 'visits', label: 'Visits' },
  { key: 'name', label: 'Name' },
];

/**
 * Everywhere you have named.
 *
 * Sorted by time spent by default, which turns out to be the honest summary of a
 * life: home, work, and then everything else a long way behind. Places you named
 * but have not been back to since still appear, with a zero — the list is what
 * you have named, not what the diary happened to match this week.
 */
export function PlacesScreen({ places, allSegments, onOpen }: PlacesScreenProps) {
  const [sort, setSort] = useState<SortKey>('time');

  const visits = visitsByPlace(allSegments, places);
  const byId = new Map(visits.map((visit) => [visit.place.id, visit]));

  const rows = [...places]
    .map((place) => {
      const entry = byId.get(place.id);
      return { place, totalMs: entry?.totalMs ?? 0, count: entry?.visits.length ?? 0 };
    })
    .sort((a, b) => {
      if (sort === 'name') return a.place.name.localeCompare(b.place.name);
      if (sort === 'visits') return b.count - a.count || b.totalMs - a.totalMs;
      return b.totalMs - a.totalMs;
    });

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Places" subtitle={places.length === 1 ? '1 named' : `${places.length} named`} />

      <View style={styles.sorts}>
        {SORTS.map(({ key, label }) => {
          const selected = sort === key;
          return (
            <Pressable
              key={key}
              onPress={() => setSort(key)}
              accessibilityRole="radio"
              accessibilityState={{ selected }}
              accessibilityLabel={`Sort by ${label}`}
              style={({ pressed }) => [styles.chip, selected && styles.chipSelected, pressed && styles.pressed]}
            >
              <Text style={[styles.chipText, selected && styles.chipTextSelected]}>{label}</Text>
            </Pressable>
          );
        })}
      </View>

      <ScrollView contentContainerStyle={styles.content}>
        {rows.length === 0 ? (
          <Text style={styles.empty}>
            Nothing named yet. Tap a stay on Today to give it a name — every future visit is then recognised.
          </Text>
        ) : (
          rows.map(({ place, totalMs, count }) => (
            <Pressable
              key={place.id}
              onPress={() => onOpen(place)}
              accessibilityRole="button"
              accessibilityLabel={`${place.name}, ${count} visits, ${formatDuration(totalMs)} in total`}
              style={({ pressed }) => [styles.row, pressed && styles.pressed]}
            >
              <View style={styles.rowText}>
                <Text style={styles.name} numberOfLines={1}>
                  {place.name}
                </Text>
                <Text style={styles.detail}>
                  {count === 0
                    ? 'No visits recorded yet'
                    : `${count === 1 ? '1 visit' : `${count} visits`} · ${formatDuration(totalMs)}`}
                  {' · '}
                  {formatDistance(place.radiusM)} radius
                </Text>
              </View>
            </Pressable>
          ))
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  sorts: { flexDirection: 'row', gap: spacing.xs, paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  chip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  chipSelected: { backgroundColor: colors.stay, borderColor: colors.stay },
  chipText: { ...typography.caption, color: colors.textSecondary },
  chipTextSelected: { color: colors.onAccent, fontWeight: '600' },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.xs },
  row: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md },
  rowText: { gap: 2 },
  name: { ...typography.body, color: colors.textPrimary },
  detail: { ...typography.caption, color: colors.textSecondary },
  empty: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center' },
  pressed: { opacity: 0.6 },
});
