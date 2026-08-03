import { Ionicons } from '@expo/vector-icons';
import { memo } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatClockTime, formatDistance, formatDuration, formatSpeed, modeLabel } from '@/core/format';
import { matchPlace, type Place } from '@/core/places';
import { averageSpeedMps, durationMs, type ActivityMode, type Segment } from '@/core/segments';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

import { RouteSparkline } from './RouteSparkline';

const MODE_ICONS: Readonly<Record<ActivityMode, keyof typeof Ionicons.glyphMap>> = {
  walk: 'walk-outline',
  run: 'fitness-outline',
  cycle: 'bicycle-outline',
  drive: 'car-outline',
  unknown: 'navigate-outline',
};

interface SegmentRowProps {
  readonly segment: Segment;
  readonly places: readonly Place[];
  readonly tzOffsetMinutes: number;
  /** Only stays are nameable, and only from Today. */
  readonly onNamePlace?: (segment: Segment) => void;
}

/**
 * One row of the timeline.
 *
 * The three numbers a row carries are the ones that answer a question you would
 * actually ask about it: how far, how long, how fast. Speed is the *average*
 * over the segment rather than the peak, because a peak is a single sample that
 * a bad fix can invent, and the average is consistent with the distance
 * printed beside it.
 */
export const SegmentRow = memo(function SegmentRow({ segment, places, tzOffsetMinutes, onNamePlace }: SegmentRowProps) {
  const startedAt = formatClockTime(segment.startedAt, tzOffsetMinutes);
  const elapsed = formatDuration(durationMs(segment));

  if (segment.kind === 'stay') {
    const place = matchPlace(segment, places);
    const title = place?.name ?? 'Unnamed place';

    return (
      <Pressable
        onPress={() => onNamePlace?.(segment)}
        disabled={!onNamePlace}
        accessibilityRole={onNamePlace ? 'button' : undefined}
        accessibilityLabel={`${title}, ${elapsed}, from ${startedAt}${onNamePlace ? '. Tap to name.' : ''}`}
        style={({ pressed }) => [styles.row, pressed && onNamePlace ? styles.pressed : null]}
      >
        <Text style={styles.clock}>{startedAt}</Text>
        <View style={[styles.dot, { backgroundColor: colors.stay }]} />
        <View style={styles.body}>
          <Text style={[styles.title, !place && styles.untitled]} numberOfLines={1}>
            {title}
          </Text>
          <Text style={styles.detail}>{elapsed}</Text>
        </View>
        {!place && onNamePlace ? <Ionicons name="pricetag-outline" size={16} color={colors.textMuted} /> : null}
      </Pressable>
    );
  }

  const color = modeColors[segment.mode];
  const title = segment.label ?? modeLabel(segment.mode);
  const average = averageSpeedMps(segment);

  return (
    <View
      style={styles.row}
      accessibilityLabel={`${title}, ${formatDistance(segment.distanceM)}, ${elapsed}, averaging ${formatSpeed(average)}, from ${startedAt}`}
    >
      <Text style={styles.clock}>{startedAt}</Text>
      <View style={[styles.bar, { backgroundColor: color }]} />
      <View style={styles.body}>
        <View style={styles.titleRow}>
          <Ionicons name={MODE_ICONS[segment.mode]} size={15} color={color} />
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {segment.modeIsManual ? (
            <View style={styles.manualBadge}>
              <Text style={styles.manualBadgeText}>REC</Text>
            </View>
          ) : null}
        </View>
        <Text style={styles.detail}>
          {formatDistance(segment.distanceM)} · {elapsed} · {formatSpeed(average)}
        </Text>
      </View>
      <RouteSparkline path={segment.path} color={color} />
    </View>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  pressed: { opacity: 0.6 },
  clock: { ...typography.clock, color: colors.textMuted, width: 44 },
  // A stay is a point in time; a move is a length of it. The shapes say so
  // before the words do.
  dot: { width: 10, height: 10, borderRadius: radius.pill, marginHorizontal: 4 },
  bar: { width: 4, height: 30, borderRadius: radius.sm, marginHorizontal: 7 },
  body: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { ...typography.body, color: colors.textPrimary, flexShrink: 1 },
  untitled: { color: colors.textSecondary, fontStyle: 'italic' },
  detail: { ...typography.caption, color: colors.textSecondary },
  manualBadge: {
    backgroundColor: colors.manual,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.xs,
    paddingVertical: 1,
  },
  manualBadgeText: { fontSize: 9, fontWeight: '700', color: colors.onAccent, letterSpacing: 0.5 },
});
