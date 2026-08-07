import { Ionicons } from '@expo/vector-icons';
import { useMemo } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { summarizeDay, type DayGroup } from '@/core/day';
import { activeCalories } from '@/core/energy';
import { formatClockTime, formatDayTitle, formatDistance, formatDuration, formatSpeed, modeLabel } from '@/core/format';
import { mediaForDay, placeMedia, type MediaItem } from '@/core/media';
import { matchPlace, type Place } from '@/core/places';
import type { Segment } from '@/core/segments';
import { MapCanvas, type MapMark, type MapTrack } from '@/components/MapCanvas';
import { ScreenHeader } from '@/components/ScreenHeader';
import { Scrubber } from '@/components/Scrubber';
import { SegmentRow } from '@/components/SegmentRow';
import { StatTile } from '@/components/StatTile';
import type { UseSettings } from '@/features/settings/hooks/useSettings';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

import { SPEEDS, useReplay } from './hooks/useReplay';

interface ReplayScreenProps {
  /** Every day with something in it, newest first. Today is the first entry. */
  readonly days: readonly DayGroup[];
  readonly places: readonly Place[];
  readonly media: readonly MediaItem[];
  readonly settings: UseSettings;
  readonly tzOffsetMinutes: number;
  readonly mapsEnabled: boolean;
  readonly ready: boolean;
  /** Null means today, which is the default and the common case. */
  readonly selectedDayKey: string | null;
  readonly onSelectDay: (key: string | null) => void;
  readonly onOpenSegment: (segment: Segment) => void;
  readonly onOpenMedia: (item: MediaItem) => void;
  /** The full list of days, for going further back than the arrows are worth. */
  readonly onOpenAllDays: () => void;
}

/**
 * A day — today unless you say otherwise — with everything the app knows about
 * it, and a player to watch it happen.
 *
 * This is one screen where there were three. "Today", "History" and "Replay"
 * were all *look at a day*: the same stats, the same timeline, the same map,
 * differing only in which day and whether it moved. Keeping them apart meant
 * three renderers of one thing, a Today that could not show yesterday, and a
 * History that could not show today.
 *
 * So the day is a parameter, it defaults to today, and the arrows walk
 * backwards. The full list of days is one tap away for going further.
 *
 * The icon moves along the route the fixes actually recorded, and **stops
 * existing** wherever they stopped. That is why `positionAt` returns null
 * across a hole rather than gliding through it: a player is where the
 * temptation to interpolate is strongest, and a smooth line through two hours
 * indoors is a journey the app would be inventing.
 */
export function ReplayScreen({
  days,
  places,
  media,
  settings,
  tzOffsetMinutes,
  mapsEnabled,
  ready,
  selectedDayKey,
  onSelectDay,
  onOpenSegment,
  onOpenMedia,
  onOpenAllDays,
}: ReplayScreenProps) {
  // Today is `days[0]` — `groupByDay` sorts newest first — so "nothing chosen"
  // and "today" are the same state, and there is no date arithmetic here.
  const index = Math.max(
    0,
    days.findIndex((candidate) => candidate.key === selectedDayKey),
  );
  const day = days[index] ?? null;
  const isToday = index === 0;

  const segments = useMemo<readonly Segment[]>(() => day?.segments ?? [], [day]);
  const replay = useReplay(segments);

  const summary = summarizeDay(segments);
  const calories = activeCalories(segments, settings.settings.weightKg);

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

  const title = day ? formatDayTitle(day.startedAt, tzOffsetMinutes) : 'Today';
  const subtitle = ready
    ? `${summary.moveCount === 1 ? '1 journey' : `${summary.moveCount} journeys`} · ${summary.stayCount === 1 ? '1 stop' : `${summary.stayCount} stops`}`
    : 'Reading your day…';

  // Older is further along the list, since the list runs newest first.
  const older = days[index + 1] ?? null;
  const newer = index > 0 ? (days[index - 1] ?? null) : null;

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={isToday ? 'Today' : title}
        subtitle={subtitle}
        action={{ label: 'All days', icon: 'calendar-outline', onPress: onOpenAllDays }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        {/* Going back in time, one day at a time. The arrows are the common
            case; the full list is in the header for anything further. */}
        <View style={styles.dayNav}>
          <Pressable
            onPress={() => older && onSelectDay(older.key)}
            disabled={!older}
            accessibilityRole="button"
            accessibilityLabel="Previous day"
            style={({ pressed }) => [styles.navButton, !older && styles.navDisabled, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-back" size={18} color={older ? colors.textPrimary : colors.textMuted} />
          </Pressable>

          <Text style={styles.dayNavLabel} numberOfLines={1}>
            {title}
          </Text>

          <Pressable
            onPress={() => onSelectDay(newer ? newer.key : null)}
            disabled={!newer}
            accessibilityRole="button"
            accessibilityLabel="Next day"
            style={({ pressed }) => [styles.navButton, !newer && styles.navDisabled, pressed && styles.pressed]}
          >
            <Ionicons name="chevron-forward" size={18} color={newer ? colors.textPrimary : colors.textMuted} />
          </Pressable>
        </View>

        {/* Only for today. A day already recorded cannot be affected by what
            tracking is doing now, and saying so on a day in March is noise. */}
        {isToday && !settings.tracking ? (
          <Pressable
            onPress={() => settings.setTracking(true)}
            accessibilityRole="button"
            accessibilityLabel="Start tracking"
            style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
          >
            <Text style={styles.noticeTitle}>Tracking is off</Text>
            <Text style={styles.noticeBody}>
              {settings.permission === 'denied'
                ? 'Location access was declined. Turn it on in iOS Settings to record your day.'
                : 'Tap to start recording where you go. Nothing leaves this phone.'}
            </Text>
          </Pressable>
        ) : null}

        {/* "Always" is the only state where the app does what it says on the
            tin. Saying so is more useful than a green tick that quietly means
            half. */}
        {isToday && settings.tracking && settings.permission === 'when-in-use' ? (
          <Pressable
            onPress={settings.askForPermission}
            accessibilityRole="button"
            accessibilityLabel="Allow background location"
            style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
          >
            <Text style={styles.noticeTitle}>Only recording while open</Text>
            <Text style={styles.noticeBody}>
              Location is set to “While Using”. Your day will have gaps whenever the app is closed.
            </Text>
          </Pressable>
        ) : null}

        {isToday && settings.savingBattery && settings.tracking ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Saving battery</Text>
            <Text style={styles.noticeBody}>
              Under 20% left, so today is being recorded at a point every 100 m. Routes will look coarser until the
              phone is charged.
            </Text>
          </View>
        ) : null}

        <View style={styles.stats}>
          <StatTile label="Distance" value={formatDistance(summary.distanceM)} accent={colors.move} />
          <StatTile label="Moving" value={formatDuration(summary.movingMs)} />
          <StatTile label="Calories" value={`${Math.round(calories)}`} accent={colors.success} />
        </View>

        <MapCanvas
          mapsEnabled={mapsEnabled}
          tracks={overlay.tracks}
          marks={[...overlay.marks, ...mediaMarks]}
          cursor={replay.position}
          height={280}
          label={`Map of ${title}`}
        />

        {/* The player only exists where there is something to play. A day with
            no fixes gets its stats and its empty timeline and nothing else. */}
        {segments.length > 0 ? (
          <>
            {/* Labelled, because the same clock times appear again on every
                timeline row below — "08:00" alone does not say which is the
                playhead, to a screen reader or to a test. */}
            <View
              style={styles.readout}
              accessible
              accessibilityLabel={`Showing ${formatClockTime(replay.playhead, tzOffsetMinutes)}`}
            >
              <Text style={styles.clock}>{formatClockTime(replay.playhead, tzOffsetMinutes)}</Text>
              {replay.position === null ? (
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
                {replay.holes.length === 1 ? 'One stretch of' : `${replay.holes.length} stretches of`} this day has no
                fixes behind it, drawn as breaks in the bar. The player stops rather than sliding across them — a
                straight line through a building is a walk that never happened.
              </Text>
            ) : null}
          </>
        ) : null}

        {captures.length > 0 ? (
          <>
            <Text style={styles.sectionLabel}>CAPTURED</Text>
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

        <Text style={styles.sectionLabel}>TIMELINE</Text>
        <View style={styles.timeline}>
          {segments.length === 0 ? (
            <Text style={styles.empty}>
              {!ready ? 'Reading…' : isToday ? 'Nothing recorded yet today.' : 'Nothing was recorded on this day.'}
            </Text>
          ) : (
            segments.map((segment) => (
              <SegmentRow
                key={segment.id}
                segment={segment}
                places={places}
                tzOffsetMinutes={tzOffsetMinutes}
                onOpen={onOpenSegment}
              />
            ))
          )}
        </View>
      </ScrollView>
    </View>
  );
}

/**
 * Everything on one map: a coloured line per journey, a dot per stop.
 *
 * Here rather than in `core` because it is a presentation choice — which
 * colour, which label — over data `core` already produced.
 */
export function dayOverlay(
  segments: readonly Segment[],
  places: readonly Place[],
): { readonly tracks: MapTrack[]; readonly marks: MapMark[] } {
  const tracks: MapTrack[] = [];
  const marks: MapMark[] = [];

  for (const segment of segments) {
    if (segment.kind === 'move') {
      if (segment.path.length > 1) {
        tracks.push({ id: segment.id, points: segment.path, color: modeColors[segment.mode] });
      }
      continue;
    }
    const place = matchPlace(segment, places);
    marks.push({ id: segment.id, at: segment.center, label: place?.name ?? '', kind: place ? 'place' : 'stay' });
  }

  return { tracks, marks };
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  dayNav: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.xs },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  navDisabled: { opacity: 0.35 },
  dayNavLabel: { ...typography.body, fontWeight: '600', color: colors.textPrimary, flex: 1, textAlign: 'center' },
  stats: { flexDirection: 'row', gap: spacing.sm },
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
  notice: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: colors.manual,
  },
  noticeTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  noticeBody: { ...typography.caption, color: colors.textSecondary },
  sectionLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, marginTop: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  swatch: { width: 8, height: 8, borderRadius: radius.pill },
  rowTitle: { ...typography.body, color: colors.textPrimary, flex: 1 },
  rowDetail: { ...typography.caption, color: colors.textSecondary },
  timeline: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  empty: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center' },
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs },
  pressed: { opacity: 0.6 },
});
