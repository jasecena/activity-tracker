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
  /** Opens the segment's own page. Omitted where the timeline is read-only. */
  readonly onOpen?: (segment: Segment) => void;
  /** Starts a selection. Omitted where rows cannot be merged. */
  readonly onLongPress?: (segment: Segment) => void;
  /**
   * Null when nothing is being selected. A boolean puts the row in selection
   * mode, where a tap toggles it rather than opening it — the whole point of a
   * mode being that the same gesture means something else while it lasts.
   */
  readonly selected?: boolean | null;
}

/**
 * One row of the timeline.
 *
 * The three numbers a row carries are the ones that answer a question you would
 * actually ask about it: how far, how long, how fast. Speed is the *average*
 * over the segment rather than the peak, because a peak is a single sample that
 * a bad fix can invent, and the average is consistent with the distance printed
 * beside it. Everything else the app holds — per-point speeds, the fix count,
 * the identifier — is one tap away rather than crammed in here.
 */
export const SegmentRow = memo(function SegmentRow({
  segment,
  places,
  tzOffsetMinutes,
  onOpen,
  onLongPress,
  selected = null,
}: SegmentRowProps) {
  const selecting = selected !== null;
  const startedAt = formatClockTime(segment.startedAt, tzOffsetMinutes);
  const elapsed = formatDuration(durationMs(segment));

  const isStay = segment.kind === 'stay';
  const place = isStay ? matchPlace(segment, places) : null;
  const title = isStay ? (place?.name ?? 'Unnamed place') : (segment.label ?? modeLabel(segment.mode));

  // The tag is decorative, so what it means has to reach a screen reader
  // through the row's own label instead.
  const named = !isStay && segment.modeIsManual ? ', named by you' : '';

  const label = isStay
    ? `${title}, ${elapsed}, from ${startedAt}`
    : `${title}, ${formatDistance(segment.distanceM)}, ${elapsed}, averaging ${formatSpeed(averageSpeedMps(segment))}, from ${startedAt}${named}`;

  const body = isStay ? (
    <>
      <Text style={styles.clock}>{startedAt}</Text>
      <View style={[styles.dot, { backgroundColor: colors.stay }]} />
      <View style={styles.content}>
        <Text style={[styles.title, !place && styles.untitled]} numberOfLines={1}>
          {title}
        </Text>
        <Text style={styles.detail}>{elapsed}</Text>
      </View>
      {!place && onOpen ? <Ionicons name="pricetag-outline" size={16} color={colors.textMuted} /> : null}
    </>
  ) : (
    <>
      <Text style={styles.clock}>{startedAt}</Text>
      <View style={[styles.bar, { backgroundColor: modeColors[segment.mode] }]} />
      <View style={styles.content}>
        <View style={styles.titleRow}>
          <Ionicons name={MODE_ICONS[segment.mode]} size={15} color={modeColors[segment.mode]} />
          <Text style={styles.title} numberOfLines={1}>
            {title}
          </Text>
          {/* `modeIsManual` is set in exactly one place — `coalesce` — so it
              means precisely "this row came from a name you gave it". The tag
              is the same glyph as the action that creates one, rather than the
              "REC" pill left over from a Record button that no longer exists
              and never recorded anything. */}
          {segment.modeIsManual ? (
            <Ionicons name="pricetag" size={13} color={colors.manual} accessibilityElementsHidden />
          ) : null}
        </View>
        <Text style={styles.detail}>
          {formatDistance(segment.distanceM)} · {elapsed} · {formatSpeed(averageSpeedMps(segment))}
        </Text>
      </View>
      <RouteSparkline path={segment.path} color={modeColors[segment.mode]} />
    </>
  );

  if (!onOpen && !onLongPress) {
    return (
      <View style={styles.row} accessibilityLabel={label}>
        {body}
      </View>
    );
  }

  return (
    <Pressable
      onPress={() => (selecting ? onLongPress?.(segment) : onOpen?.(segment))}
      onLongPress={onLongPress ? () => onLongPress(segment) : undefined}
      accessibilityRole={selecting ? 'checkbox' : 'button'}
      accessibilityState={selecting ? { checked: selected === true } : undefined}
      accessibilityLabel={label}
      style={({ pressed }) => [styles.row, selected === true && styles.selectedRow, pressed && styles.pressed]}
    >
      {selecting ? (
        <View style={[styles.tick, selected === true && styles.tickOn]}>
          {selected === true ? <Ionicons name="checkmark" size={12} color={colors.onAccent} /> : null}
        </View>
      ) : null}
      {body}
    </Pressable>
  );
});

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  selectedRow: { backgroundColor: colors.surfaceRaised, borderRadius: radius.sm },
  tick: {
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    borderWidth: 1.5,
    borderColor: colors.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  tickOn: { backgroundColor: colors.move, borderColor: colors.move },
  pressed: { opacity: 0.6 },
  clock: { ...typography.clock, color: colors.textMuted, width: 44 },
  // A stay is a point in time; a move is a length of it. The shapes say so
  // before the words do.
  dot: { width: 10, height: 10, borderRadius: radius.pill, marginHorizontal: 4 },
  bar: { width: 4, height: 30, borderRadius: radius.sm, marginHorizontal: 7 },
  content: { flex: 1, gap: 2 },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs },
  title: { ...typography.body, color: colors.textPrimary, flexShrink: 1 },
  untitled: { color: colors.textSecondary, fontStyle: 'italic' },
  detail: { ...typography.caption, color: colors.textSecondary },
});
