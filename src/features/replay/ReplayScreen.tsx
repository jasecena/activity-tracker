import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import type { DayGroup } from '@/core/day';
import { formatClockTime, formatDayTitle, formatSpeed, modeLabel } from '@/core/format';
import { mediaForDay, placeMedia, type MediaItem } from '@/core/media';
import { matchPlace, type Place } from '@/core/places';
import type { MoveSegment, Segment } from '@/core/segments';
import { MapCanvas, type MapMark, type MapTrack } from '@/components/MapCanvas';
import { Section } from '@/components/Section';
import { Scrubber } from '@/components/Scrubber';
import { SegmentRow } from '@/components/SegmentRow';
import type { UseSettings } from '@/features/settings/hooks/useSettings';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

import { useSealedImages } from '@/features/media/hooks/useSealedImages';

import { SPEEDS, useReplay } from './hooks/useReplay';

/**
 * How far past its own edges an arrow will answer a press.
 *
 * The buttons are already 44 points, which is the smallest target iOS considers
 * reliable; the slop is for the press aimed at the arrow that lands beside it.
 * It must stay under `DEAD_STRIP`, or the enlarged target reaches into the
 * date's and a nudged press opens the day list instead of walking a day.
 */
const ARROW_SLOP = spacing.sm;

/**
 * The gap either side of the date, belonging to neither button.
 *
 * Twice the slop, so there is still dead ground between the arrow's enlarged
 * target and the date's real one.
 */
const DEAD_STRIP = spacing.md;

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
  /**
   * Correct what a journey really was. Omitted where the timeline is read-only.
   *
   * Speed alone cannot separate a slow cycle from a fast walk — Core Motion's
   * classifier has no Expo binding — so the app gets it wrong sometimes and
   * this is how you say so.
   */
  readonly onCorrectMode?: (segment: MoveSegment) => void;
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
  onCorrectMode,
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

  const overlay = useMemo(() => dayOverlay(segments, places), [segments, places]);

  const captures = useMemo(
    () => (day ? placeMedia(replay.track, mediaForDay(media, day.key, tzOffsetMinutes)) : []),
    [day, media, replay.track, tzOffsetMinutes],
  );

  // The same windowed thumbnail store the gallery uses; a day rarely has more
  // than a handful of captures, so loading them all is a few kilobytes.
  const captureThumbs = useSealedImages();
  useEffect(() => {
    captureThumbs.load(captures.map((placed) => placed.item));
  }, [captureThumbs, captures]);

  const mediaMarks = useMemo<MapMark[]>(
    () =>
      captures.flatMap((placed) =>
        placed.at ? [{ id: placed.item.id, at: placed.at, label: '', kind: 'media' as const }] : [],
      ),
    [captures],
  );

  const currentSegment = segments.find((candidate) => candidate.id === replay.position?.segmentId) ?? null;

  const title = day ? formatDayTitle(day.startedAt, tzOffsetMinutes) : 'Today';
  // Older is further along the list, since the list runs newest first.
  const older = days[index + 1] ?? null;
  const newer = index > 0 ? (days[index - 1] ?? null) : null;

  return (
    <View style={styles.screen}>
      {/* **One bar, not two.** This screen used to carry a `ScreenHeader` — a
          title, a subtitle counting journeys and stops, a Today button and a
          calendar button — sitting directly above a second bar with the day
          arrows and the same date in it. Two rows of chrome saying overlapping
          things, above a map that is the reason for the page.

          Everything the header did now lives somewhere it was already implied:
          the date is the title, tapping it is the calendar, and pressing the Day
          tab you are already on is the Today button. The subtitle went entirely
          — the stats row underneath says more about the day than a count of
          rows does, and the timeline's own heading carries the count now.

          **The bar is sticky.** It holds the only way to change day, and this
          page is long — arrows that scroll off the top mean scrolling back up to
          use them, on a screen whose whole job is moving between days. */}
      <ScrollView contentContainerStyle={styles.content} stickyHeaderIndices={[0]}>
        {/* **Two Views, and the outer one is not decoration.** React Native's
            sticky header moves its child's style onto its own wrapper and hands
            the child `{flex: 1}` in place of it — `ScrollViewStickyHeader.js`,
            "We transfer the child style to the wrapper". So a `flexDirection`
            written on the sticky child lands one level above the children it was
            meant to arrange, and the element actually holding them falls back to
            the default: column. That is what put the arrows above and below the
            date on a phone while every style looked right in the source.
            The outer View exists to be eaten by the wrapper. The row lives
            inside it, where nothing rewrites it. */}
        <View style={styles.dayNavSticky}>
          <View style={styles.dayNav}>
            <Pressable
              onPress={() => older && onSelectDay(older.key)}
              disabled={!older}
              accessibilityRole="button"
              accessibilityLabel="Previous day"
              hitSlop={ARROW_SLOP}
              style={({ pressed }) => [styles.navButton, !older && styles.navDisabled, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-back" size={20} color={older ? colors.textPrimary : colors.textMuted} />
            </Pressable>

            {/* The date is the button. A calendar icon beside a date is the same
              thing twice, and the date is a bigger target than an icon.

              **It keeps a margin, and the margin belongs to neither button.**
              The three controls do different things and one of them opens a
              page, so an arrow pressed slightly off its centre must not become
              "choose another day" — a mis-tap that walks a day is invisible and
              a mis-tap that opens the day list is a page in your face. The dead
              strip is wide enough to hold the arrows' `hitSlop` inside it, so
              the enlarged targets stop before the date's begins. */}
            <Pressable
              onPress={onOpenAllDays}
              accessibilityRole="button"
              accessibilityLabel={`${isToday ? 'Today' : title}. Choose another day`}
              style={({ pressed }) => [styles.dayNavLabelButton, pressed && styles.pressed]}
            >
              <Text style={styles.dayNavLabel} numberOfLines={1}>
                {isToday ? 'Today' : title}
              </Text>
            </Pressable>

            <Pressable
              onPress={() => onSelectDay(newer ? newer.key : null)}
              disabled={!newer}
              accessibilityRole="button"
              accessibilityLabel="Next day"
              hitSlop={ARROW_SLOP}
              style={({ pressed }) => [styles.navButton, !newer && styles.navDisabled, pressed && styles.pressed]}
            >
              <Ionicons name="chevron-forward" size={20} color={newer ? colors.textPrimary : colors.textMuted} />
            </Pressable>
          </View>
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
            {/* Small and tappable, and pictures rather than rows about
                pictures: what was captured is best said by showing it. Tapping
                one goes to the Media tab, landed on that capture — the same
                screen a capture is always on, not a page of its own. */}
            <View style={styles.captureStrip}>
              {captures.map((placed) => {
                const uri = captureThumbs.uriFor(placed.item);
                return (
                  <Pressable
                    key={placed.item.id}
                    onPress={() => onOpenMedia(placed.item)}
                    accessibilityRole="button"
                    accessibilityLabel={`${placed.item.kind} at ${formatClockTime(placed.item.capturedAt, tzOffsetMinutes)}`}
                    style={({ pressed }) => [styles.captureThumb, pressed && styles.pressed]}
                  >
                    {uri ? (
                      <Image source={{ uri }} style={styles.captureImage} resizeMode="cover" />
                    ) : (
                      <Ionicons name="image-outline" size={16} color={colors.textMuted} />
                    )}
                    {placed.item.kind === 'video' ? (
                      <View style={styles.captureBadge}>
                        <Ionicons name="play" size={9} color={colors.textPrimary} />
                      </View>
                    ) : null}
                  </Pressable>
                );
              })}
            </View>
          </>
        ) : null}

        {/* Collapsed by default: a day of errands is dozens of rows, and a page
            that opens on all of them is a page you scroll rather than read. The
            count in the heading is what makes that safe — it hides the rows
            without hiding that there are any.

            The diary used to sit above this in a section of its own. It is a tab
            now: a note was filed under the day it was about and reached by
            walking to that day, which is fine for a week and not for a year. The
            same rows in two places would be two things to keep in step. */}
        <Section label="TIMELINE" count={segments.length}>
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
                  /* Long press rather than a swipe. A row on a list that scrolls
                     vertically has to hand a horizontal drag back to the
                     scroller often enough that the gesture is unreliable by
                     nature, and a correction that only sometimes happens is
                     worse than a menu that always does.

                     Only a journey. A stay has no activity type, so a stay that
                     opened this would be an action leading nowhere. */
                  onLongPress={onCorrectMode && segment.kind === 'move' ? () => onCorrectMode(segment) : undefined}
                />
              ))
            )}
          </View>
        </Section>
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
function dayOverlay(
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
  captureStrip: { flexDirection: 'row', flexWrap: 'wrap', gap: spacing.xs },
  captureThumb: {
    width: 56,
    height: 74,
    borderRadius: radius.sm,
    overflow: 'hidden',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  captureImage: { width: '100%', height: '100%' },
  captureBadge: {
    position: 'absolute',
    right: 3,
    bottom: 3,
    width: 14,
    height: 14,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,15,20,0.75)',
  },
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  // Everything here ends up on React Native's sticky wrapper rather than on
  // this View — which is fine for a ground and some padding, and is exactly why
  // the row itself cannot live here. See the comment at the call site.
  dayNavSticky: {
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    // The bar is sticky, so it needs a ground of its own — without one the
    // content scrolls visibly underneath it.
    backgroundColor: colors.background,
  },
  dayNav: {
    flexDirection: 'row',
    // **Spelled out rather than left to the default.** The bar is one line —
    // an arrow, the date, an arrow. `nowrap` and a shrinkable middle mean a
    // long date truncates rather than pushing a control onto a second line.
    flexWrap: 'nowrap',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  dayNavLabelButton: {
    // Takes what is left over and gives it all back under pressure, so the
    // arrows keep their size and the date is what gets shorter.
    flexGrow: 1,
    flexShrink: 1,
    flexBasis: 0,
    minWidth: 0,
    marginHorizontal: DEAD_STRIP,
    paddingVertical: spacing.sm,
  },
  navButton: {
    // 44 points, which is the smallest target iOS considers reliable — these
    // are pressed repeatedly to walk back through a week.
    width: 44,
    height: 44,
    // Never shrink: an arrow squeezed to nothing by a long date is a control
    // that disappears on exactly the days with the longest names.
    flexGrow: 0,
    flexShrink: 0,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  navDisabled: { opacity: 0.35 },
  dayNavLabel: { ...typography.body, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
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
  dayActions: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-end',
    gap: spacing.sm,
    marginTop: spacing.sm,
  },
  // 44 points, which is the smallest thing iOS asks you to make tappable.
  dayAction: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  timeline: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  empty: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center' },
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs },
  pressed: { opacity: 0.6 },
});
