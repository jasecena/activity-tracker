import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatClockTime, formatDistance, formatDuration, modeLabel } from '@/core/format';
import { labelledSegmentId, type JourneyLabel, type Segment } from '@/core/segments';
import { MapCanvas, type MapTrack } from '@/components/MapCanvas';
import { RouteSparkline } from '@/components/RouteSparkline';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

interface NamedJourneysScreenProps {
  readonly labels: readonly JourneyLabel[];
  /** Every segment the app knows about, today and frozen days alike. */
  readonly segments: readonly Segment[];
  readonly tzOffsetMinutes: number;
  readonly mapsEnabled: boolean;
  readonly onBack: () => void;
  readonly onOpenSegment: (segment: Segment) => void;
  readonly onForget: (id: string) => void;
}

/**
 * Every journey you have named, on one map.
 *
 * A name is a time range over the one fix stream, and `applyJourneyLabels`
 * turns each into exactly one segment with a predictable id. So this screen
 * holds no data of its own: it pairs each name with the row it produced.
 *
 * A name whose journey is not in the current timeline is still listed, with its
 * times and no route. That is honest rather than tidy: the journey belongs to a
 * day whose fixes have been pruned, or to a fold under a different preset.
 * Hiding it would look like the app had lost a name it still has.
 */
export function NamedJourneysScreen({
  labels,
  segments,
  tzOffsetMinutes,
  mapsEnabled,
  onBack,
  onOpenSegment,
  onForget,
}: NamedJourneysScreenProps) {
  const rows = useMemo(() => {
    const byId = new Map(segments.map((segment) => [segment.id, segment]));
    return [...labels]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((label) => {
        const segment = byId.get(labelledSegmentId(label));
        return { label, segment: segment?.kind === 'move' ? segment : null };
      });
  }, [labels, segments]);

  const tracks = useMemo<MapTrack[]>(
    () =>
      rows.flatMap(({ label, segment }) =>
        segment && segment.path.length > 1
          ? [{ id: label.id, points: segment.path, color: modeColors[label.mode ?? segment.mode] }]
          : [],
      ),
    [rows],
  );

  const confirmForget = (label: JourneyLabel) =>
    Alert.alert(
      `Forget “${label.label}”?`,
      'The name goes. The journey stays — it was recorded either way, and the timeline keeps it with the mode worked out from speed.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Forget', style: 'destructive', onPress: () => onForget(label.id) },
      ],
    );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Named journeys"
        subtitle={labels.length === 1 ? '1 named' : `${labels.length} named`}
        onBack={onBack}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {labels.length === 0 ? (
          <Text style={styles.empty}>Nothing named yet. Open a journey from the timeline and give it a name.</Text>
        ) : (
          <>
            <MapCanvas mapsEnabled={mapsEnabled} tracks={tracks} height={240} label="Map of every named journey" />

            {rows.map(({ label, segment }) => (
              <Pressable
                key={label.id}
                onPress={segment ? () => onOpenSegment(segment) : undefined}
                onLongPress={() => confirmForget(label)}
                accessibilityRole="button"
                accessibilityLabel={`${label.label}, ${modeLabel(label.mode ?? segment?.mode ?? 'unknown')}, ${
                  segment ? formatDistance(segment.distanceM) : 'no route recorded'
                }`}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.title} numberOfLines={1}>
                    {label.label}
                  </Text>
                  <Text style={styles.detail}>
                    {formatClockTime(label.startedAt, tzOffsetMinutes)} ·{' '}
                    {formatDuration(label.endedAt - label.startedAt)}
                    {segment ? ` · ${formatDistance(segment.distanceM)}` : ' · not in the current timeline'}
                  </Text>
                </View>
                {segment && segment.path.length > 1 ? (
                  <RouteSparkline path={segment.path} color={modeColors[label.mode ?? segment.mode]} />
                ) : null}
              </Pressable>
            ))}

            <Text style={styles.footnote}>
              Press and hold to forget a name. The journey underneath is never affected — a name is only a label over
              what was already recorded, so there is nothing separate to delete.
            </Text>
          </>
        )}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  card: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
  },
  rowText: { flex: 1, gap: spacing.xs },
  title: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  detail: { ...typography.caption, color: colors.textSecondary },
  empty: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center' },
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs },
  pressed: { opacity: 0.6 },
});
