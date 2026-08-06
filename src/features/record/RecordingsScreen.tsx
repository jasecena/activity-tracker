import { useMemo } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatClockTime, formatDistance, formatDuration, modeLabel } from '@/core/format';
import { manualSegmentId, type ManualWindow, type Segment } from '@/core/segments';
import { MapCanvas, type MapTrack } from '@/components/MapCanvas';
import { RouteSparkline } from '@/components/RouteSparkline';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

interface RecordingsScreenProps {
  readonly windows: readonly ManualWindow[];
  /** Every segment the app knows about, today and frozen days alike. */
  readonly segments: readonly Segment[];
  readonly tzOffsetMinutes: number;
  readonly mapsEnabled: boolean;
  readonly onBack: () => void;
  readonly onOpenSegment: (segment: Segment) => void;
  readonly onDiscard: (id: string) => void;
}

/**
 * Everything you pressed Record on, on one map.
 *
 * A recording is not a separate recording — it is a window over the one fix
 * stream, and `applyManualWindows` turns each into exactly one segment with a
 * predictable id. So this screen holds no data of its own: it pairs each window
 * with the row it produced and draws them together.
 *
 * A window whose segment is missing is shown with its times and no route. That
 * happens for real: a recording from a frozen day whose label was baked in, or
 * one made while location was denied. Hiding it would look like the app had
 * lost a recording it still has.
 */
export function RecordingsScreen({
  windows,
  segments,
  tzOffsetMinutes,
  mapsEnabled,
  onBack,
  onOpenSegment,
  onDiscard,
}: RecordingsScreenProps) {
  const rows = useMemo(() => {
    const byId = new Map(segments.map((segment) => [segment.id, segment]));
    return [...windows]
      .sort((a, b) => b.startedAt - a.startedAt)
      .map((window) => {
        const segment = byId.get(manualSegmentId(window));
        return { window, segment: segment?.kind === 'move' ? segment : null };
      });
  }, [windows, segments]);

  const tracks = useMemo<MapTrack[]>(
    () =>
      rows.flatMap(({ window, segment }) =>
        segment && segment.path.length > 1
          ? [{ id: window.id, points: segment.path, color: modeColors[window.mode] }]
          : [],
      ),
    [rows],
  );

  const confirmDiscard = (window: ManualWindow) =>
    Alert.alert(
      `Forget “${window.label}”?`,
      'The recording label goes. The fixes it covered stay — they were collected anyway, and the timeline keeps them as an ordinary journey.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Forget', style: 'destructive', onPress: () => onDiscard(window.id) },
      ],
    );

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Recordings"
        subtitle={windows.length === 1 ? '1 recording' : `${windows.length} recordings`}
        onBack={onBack}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {windows.length === 0 ? (
          <Text style={styles.empty}>Nothing recorded by hand yet. Press Record on Today to name an activity.</Text>
        ) : (
          <>
            <MapCanvas mapsEnabled={mapsEnabled} tracks={tracks} height={240} label="Map of every recording" />

            {rows.map(({ window, segment }) => (
              <Pressable
                key={window.id}
                onPress={segment ? () => onOpenSegment(segment) : undefined}
                onLongPress={() => confirmDiscard(window)}
                accessibilityRole="button"
                accessibilityLabel={`${window.label}, ${modeLabel(window.mode)}, ${
                  segment ? formatDistance(segment.distanceM) : 'no route recorded'
                }`}
                style={({ pressed }) => [styles.card, pressed && styles.pressed]}
              >
                <View style={styles.rowText}>
                  <Text style={styles.title} numberOfLines={1}>
                    {window.label}
                  </Text>
                  <Text style={styles.detail}>
                    {formatClockTime(window.startedAt, tzOffsetMinutes)}
                    {window.endedAt === null
                      ? ' · still recording'
                      : ` · ${formatDuration(window.endedAt - window.startedAt)}`}
                    {segment ? ` · ${formatDistance(segment.distanceM)}` : ' · no route'}
                  </Text>
                </View>
                {segment && segment.path.length > 1 ? (
                  <RouteSparkline path={segment.path} color={modeColors[window.mode]} />
                ) : null}
              </Pressable>
            ))}

            <Text style={styles.footnote}>
              Press and hold a recording to forget its label. The fixes underneath are never affected — pressing Record
              never started a second stream, so there is nothing separate to delete.
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
