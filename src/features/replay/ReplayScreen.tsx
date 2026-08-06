import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DayGroup } from '@/core/day';
import { formatClockTime, formatDayTitle, formatDistance, formatSpeed, modeLabel } from '@/core/format';
import { mediaForDay, placeMedia, type MediaItem } from '@/core/media';
import type { Place } from '@/core/places';
import type { Segment } from '@/core/segments';
import { MapCanvas, type MapMark } from '@/components/MapCanvas';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Scrubber } from '@/components/Scrubber';
import { dayOverlay } from '@/features/history/DayScreen';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

import { SPEEDS, useReplay } from './hooks/useReplay';

interface ReplayScreenProps {
  /** Every day with something in it, newest first, today included. */
  readonly days: readonly DayGroup[];
  readonly places: readonly Place[];
  readonly media: readonly MediaItem[];
  readonly tzOffsetMinutes: number;
  readonly mapsEnabled: boolean;
  /**
   * Which day is showing, owned by the shell.
   *
   * Up there rather than in here because History's "Replay this day" chooses it
   * too. Two owners of one selection means one of them has to be copied into
   * the other, and a copy that only updates in an effect renders the wrong day
   * first and corrects it afterwards.
   */
  readonly selectedDayKey: string | null;
  readonly onSelectDay: (key: string) => void;
  readonly onOpenMedia: (item: MediaItem) => void;
}

/**
 * A day, played back.
 *
 * The icon moves along the route the fixes actually recorded, and **stops
 * existing** wherever they stopped. That is the whole reason `positionAt`
 * returns null across a hole rather than gliding through it: a player is where
 * the temptation to interpolate is strongest, and a smooth line through two
 * hours indoors is a journey the app would be inventing.
 */
export function ReplayScreen({
  days,
  places,
  media,
  tzOffsetMinutes,
  mapsEnabled,
  selectedDayKey,
  onSelectDay,
  onOpenMedia,
}: ReplayScreenProps) {
  // Nothing chosen yet falls back to the newest day that has anything in it.
  const day = useMemo(
    () => days.find((candidate) => candidate.key === selectedDayKey) ?? days[0] ?? null,
    [days, selectedDayKey],
  );

  const segments = useMemo<readonly Segment[]>(() => day?.segments ?? [], [day]);
  const replay = useReplay(segments);

  const overlay = useMemo(() => dayOverlay(segments, places), [segments, places]);

  const captures = useMemo(
    () => (day ? placeMedia(replay.track, mediaForDay(media, day.key, tzOffsetMinutes)) : []),
    [day, media, replay.track, tzOffsetMinutes],
  );

  const mediaMarks = useMemo<MapMark[]>(
    () =>
      captures.flatMap((placed) =>
        placed.at ? [{ id: placed.item.id, at: placed.at, label: '', kind: 'media' as const }] : [],
      ),
    [captures],
  );

  const currentSegment = segments.find((candidate) => candidate.id === replay.position?.segmentId) ?? null;

  if (!day) {
    return (
      <View style={styles.screen}>
        <ScreenHeader title="Replay" subtitle="Nothing to play yet" />
        <Text style={styles.empty}>Once a day has been recorded, it can be played back here.</Text>
      </View>
    );
  }

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Replay" subtitle={formatDayTitle(day.startedAt, tzOffsetMinutes)} />

      <ScrollView contentContainerStyle={styles.content}>
        <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.days}>
          {days.map((candidate) => {
            const selected = candidate.key === day.key;
            return (
              <Pressable
                key={candidate.key}
                onPress={() => onSelectDay(candidate.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={formatDayTitle(candidate.startedAt, tzOffsetMinutes)}
                style={({ pressed }) => [styles.dayChip, selected && styles.dayChipOn, pressed && styles.pressed]}
              >
                <Text style={[styles.dayChipText, selected && styles.dayChipTextOn]}>
                  {formatDayTitle(candidate.startedAt, tzOffsetMinutes)}
                </Text>
              </Pressable>
            );
          })}
        </ScrollView>

        <MapCanvas
          mapsEnabled={mapsEnabled}
          tracks={overlay.tracks}
          marks={[...overlay.marks, ...mediaMarks]}
          cursor={replay.position}
          height={300}
          label={`Map of ${formatDayTitle(day.startedAt, tzOffsetMinutes)}`}
        />

        <View style={styles.readout}>
          <Text style={styles.clock}>{formatClockTime(replay.playhead, tzOffsetMinutes)}</Text>
          {replay.position === null ? (
            // Not a failure state. The app has no fixes here and says so, which
            // is the honest alternative to a straight line across the gap.
            <Text style={styles.noSignal}>No signal — nothing was recorded at this moment</Text>
          ) : (
            <Text style={styles.detail}>
              {currentSegment?.kind === 'move'
                ? `${currentSegment.label ?? modeLabel(currentSegment.mode)} · ${formatSpeed(replay.position.speedMps ?? 0)}`
                : 'Stopped'}
            </Text>
          )}
        </View>

        <Scrubber
          from={replay.track.from}
          to={replay.track.to}
          value={replay.playhead}
          holes={replay.holes}
          onChange={replay.setPlayhead}
          label={`Time of day, ${formatClockTime(replay.playhead, tzOffsetMinutes)}`}
        />

        <View style={styles.transport}>
          <Pressable
            onPress={replay.toggle}
            accessibilityRole="button"
            accessibilityLabel={replay.playing ? 'Pause' : 'Play'}
            style={({ pressed }) => [styles.play, pressed && styles.pressed]}
          >
            <Ionicons name={replay.playing ? 'pause' : 'play'} size={20} color={colors.onAccent} />
          </Pressable>

          <View style={styles.speeds}>
            {SPEEDS.map((option) => {
              const selected = option === replay.speed;
              return (
                <Pressable
                  key={option}
                  onPress={() => replay.setSpeed(option)}
                  accessibilityRole="radio"
                  accessibilityState={{ selected }}
                  accessibilityLabel={`${option} times speed`}
                  style={({ pressed }) => [styles.speed, selected && styles.speedOn, pressed && styles.pressed]}
                >
                  <Text style={[styles.speedText, selected && styles.speedTextOn]}>{option}×</Text>
                </Pressable>
              );
            })}
          </View>
        </View>

        {replay.holes.length > 0 ? (
          <Text style={styles.footnote}>
            {replay.holes.length === 1 ? 'One stretch of' : `${replay.holes.length} stretches of`} this day has no fixes
            behind it, drawn as breaks in the bar. The player stops rather than sliding across them — a straight line
            through a building is a walk that never happened.
          </Text>
        ) : null}

        {captures.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>CAPTURED THIS DAY</Text>
            <View style={styles.card}>
              {captures.map((placed) => (
                <Pressable
                  key={placed.item.id}
                  onPress={() => onOpenMedia(placed.item)}
                  accessibilityRole="button"
                  accessibilityLabel={`${placed.item.kind} at ${formatClockTime(placed.item.capturedAt, tzOffsetMinutes)}`}
                  style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                >
                  <View style={[styles.swatch, { backgroundColor: colors.manual }]} />
                  <Text style={styles.rowTitle}>{formatClockTime(placed.item.capturedAt, tzOffsetMinutes)}</Text>
                  <Text style={styles.rowDetail}>
                    {placed.at ? placed.item.kind : `${placed.item.kind} · no position`}
                  </Text>
                </Pressable>
              ))}
            </View>
          </>
        ) : null}

        <Text style={styles.sectionLabel}>THIS DAY</Text>
        <View style={styles.card}>
          {overlay.tracks.map((track) => {
            const segment = segments.find((candidate) => candidate.id === track.id);
            if (segment?.kind !== 'move') return null;
            return (
              <View key={track.id} style={styles.row}>
                <View style={[styles.swatch, { backgroundColor: modeColors[segment.mode] }]} />
                <Text style={styles.rowTitle} numberOfLines={1}>
                  {segment.label ?? modeLabel(segment.mode)}
                </Text>
                <Text style={styles.rowDetail}>{formatDistance(segment.distanceM)}</Text>
              </View>
            );
          })}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  days: { gap: spacing.xs, paddingVertical: spacing.xs },
  dayChip: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  dayChipOn: { backgroundColor: colors.move, borderColor: colors.move },
  dayChipText: { ...typography.caption, color: colors.textSecondary },
  dayChipTextOn: { color: colors.onAccent, fontWeight: '600' },
  readout: { alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm },
  clock: { ...typography.hero, fontSize: 32, color: colors.textPrimary },
  detail: { ...typography.caption, color: colors.textSecondary },
  noSignal: { ...typography.caption, color: colors.danger },
  transport: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  play: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    backgroundColor: colors.move,
    alignItems: 'center',
    justifyContent: 'center',
  },
  speeds: { flexDirection: 'row', gap: spacing.xs, flex: 1, justifyContent: 'flex-end' },
  speed: {
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  speedOn: { backgroundColor: colors.surfaceRaised, borderColor: colors.move },
  speedText: { ...typography.caption, color: colors.textSecondary },
  speedTextOn: { color: colors.move, fontWeight: '600' },
  sectionLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, marginTop: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  swatch: { width: 8, height: 8, borderRadius: radius.pill },
  rowTitle: { ...typography.body, color: colors.textPrimary, flex: 1 },
  rowDetail: { ...typography.caption, color: colors.textSecondary },
  empty: { ...typography.body, color: colors.textMuted, padding: spacing.lg, textAlign: 'center' },
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs },
  pressed: { opacity: 0.6 },
});
