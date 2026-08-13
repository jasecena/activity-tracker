import { Ionicons } from '@expo/vector-icons';
import { useEffect, useMemo } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { notesForDay, summarizeDay, type DayGroup, type DayNote } from '@/core/day';
import { activeCalories } from '@/core/energy';
import { formatClockTime, formatDayTitle, formatDistance, formatDuration, formatSpeed, modeLabel } from '@/core/format';
import { mediaForDay, placeMedia, type MediaItem } from '@/core/media';
import { matchPlace, type Place } from '@/core/places';
import type { MoveSegment, Segment } from '@/core/segments';
import { MapCanvas, type MapMark, type MapTrack } from '@/components/MapCanvas';
import { NoteRow } from '@/components/NoteRow';
import { Section } from '@/components/Section';
import { Scrubber } from '@/components/Scrubber';
import { SegmentRow } from '@/components/SegmentRow';
import { StatTile } from '@/components/StatTile';
import type { UseSettings } from '@/features/settings/hooks/useSettings';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

import { useSealedImages } from '@/features/media/hooks/useSealedImages';

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
  /**
   * Correct what a journey really was. Omitted where the timeline is read-only.
   *
   * Speed alone cannot separate a slow cycle from a fast walk — Core Motion's
   * classifier has no Expo binding — so the app gets it wrong sometimes and
   * this is how you say so.
   */
  readonly onCorrectMode?: (segment: MoveSegment) => void;
  /**
   * What you wrote about your days — all of them, cut to this one here.
   *
   * Passed whole rather than pre-filtered because the day on screen is this
   * screen's own state: it is the thing the arrows change, and handing the
   * caller the job of keeping a filtered list in step with it would be a second
   * source of truth for which day is showing.
   */
  readonly notes?: readonly DayNote[];
  /** Absent where the timeline is read-only, which is what hides the writing controls. */
  readonly onWriteNote?: (dayKey: string, segments: readonly Segment[]) => void;
  readonly onOpenNote?: (note: DayNote) => void;
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
  notes,
  onWriteNote,
  onOpenNote,
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

  // Cut to the day on screen here rather than by the caller: which day is
  // showing is this screen's own state, and a filtered list passed in would be
  // a second answer to it that could fall out of step with the arrows.
  const dayNotes = useMemo(
    () => (day ? notesForDay(notes ?? [], day.key, tzOffsetMinutes) : []),
    [day, notes, tzOffsetMinutes],
  );

  const replay = useReplay(segments);

  const summary = summarizeDay(segments);
  const calories = activeCalories(segments, settings.settings.weightKg);

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

          {/* The date is the button. A calendar icon beside a date is the same
              thing twice, and the date is a bigger target than an icon. */}
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

        {/* **Below the player, not above it.** The player drives the map and has
            to sit against it: anything between the two detaches the scrubber
            from the thing it scrubs, which is what a section of notes wedged in
            there did.

            Its own section rather than rows in the timeline — a timeline is a
            record of where the phone was minute by minute, and a sentence
            threaded into it arrives as another reading the app took. What a
            diary is indexed by is the date; the time is a detail within the day,
            which is why these still sort by it.

            The pen lives in the heading, on the right, where it is next to the
            thing it adds to rather than floating above the page. It stays
            outside the player's `segments.length` guard: a day the app recorded
            nothing on is the day most worth writing about. */}
        <Section
          label="NOTES"
          count={dayNotes.length}
          action={
            onWriteNote && day ? (
              <Pressable
                onPress={() => onWriteNote(day.key, segments)}
                accessibilityRole="button"
                accessibilityLabel="Write a note about this day"
                style={({ pressed }) => [styles.dayAction, pressed && styles.pressed]}
              >
                <Ionicons name="create-outline" size={20} color={colors.textPrimary} />
              </Pressable>
            ) : null
          }
        >
          {dayNotes.length > 0 ? (
            <View style={styles.timeline}>
              {dayNotes.map((note) => (
                <NoteRow key={note.id} note={note} tzOffsetMinutes={tzOffsetMinutes} onOpen={onOpenNote} />
              ))}
            </View>
          ) : (
            <Text style={styles.empty}>Nothing written about this day yet.</Text>
          )}
        </Section>

        {/* Collapsed like the notes above it, and for the same reason: a day of
            errands is dozens of rows, and a page that opens on all of them is a
            page you scroll rather than read. The count in the heading is what
            makes collapsing safe — it hides the rows without hiding that there
            are any. */}
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
  dayNav: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    // The bar is sticky, so it needs a ground of its own — without one the
    // content scrolls visibly underneath it.
    backgroundColor: colors.background,
  },
  dayNavLabelButton: { flex: 1, paddingVertical: spacing.xs },
  navButton: {
    width: 36,
    height: 36,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  navDisabled: { opacity: 0.35 },
  dayNavLabel: { ...typography.body, fontWeight: '600', color: colors.textPrimary, textAlign: 'center' },
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
