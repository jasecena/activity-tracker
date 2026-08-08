import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { groupByDay } from '@/core/day';
import type { MediaItem } from '@/core/media';
import { visitsByPlace, type Place } from '@/core/places';
import { buildTrack, positionAt } from '@/core/replay';
import { journeyLabelId } from '@/core/segments';
import type { MoveSegment, Segment, StaySegment } from '@/core/segments';
import { SegmentScreen } from '@/features/activities/SegmentScreen';
import { useHeartbeat } from '@/features/activities/hooks/useHeartbeat';
import { useTimeline } from '@/features/activities/hooks/useTimeline';
import { CaptureScreen } from '@/features/capture/CaptureScreen';
import { MediaScreen } from '@/features/capture/MediaScreen';
import { useMedia } from '@/features/capture/hooks/useMedia';
import { DataScreen } from '@/features/data/DataScreen';
import { HistoryScreen } from '@/features/history/HistoryScreen';
import { MediaGalleryScreen } from '@/features/media/MediaGalleryScreen';
import { PlaceScreen } from '@/features/places/PlaceScreen';
import { PlacesScreen } from '@/features/places/PlacesScreen';
import { PlacePicker } from '@/features/places/components/PlacePicker';
import { usePlaces } from '@/features/places/hooks/usePlaces';
import { NamedJourneysScreen } from '@/features/labels/NamedJourneysScreen';
import { JourneyLabelSheet } from '@/features/labels/components/JourneyLabelSheet';
import { useJourneyLabels } from '@/features/labels/hooks/useJourneyLabels';
import { ReplayScreen } from '@/features/replay/ReplayScreen';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { useSettings } from '@/features/settings/hooks/useSettings';
import { colors, spacing } from '@/theme/tokens';

import { SwipeBackPage } from './SwipeBackPage';
import { usePageStack } from './usePageStack';

type Tab = 'replay' | 'capture' | 'gallery' | 'settings';

/**
 * The tabs that can have a detail page over them.
 *
 * Capture is not one. It is a viewfinder and a shutter, and the list it used to
 * carry — the one route it had to a detail page — belongs to Media now.
 */
type PagedTab = Exclude<Tab, 'capture'>;

/** Pages that can sit above a tab's root. */
type Page =
  | { readonly kind: 'segment'; readonly segment: Segment }
  | { readonly kind: 'alldays' }
  | { readonly kind: 'places' }
  | { readonly kind: 'place'; readonly place: Place }
  | { readonly kind: 'journeys' }
  | { readonly kind: 'media'; readonly item: MediaItem }
  | { readonly kind: 'data' };

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'replay', label: 'Day', icon: 'today-outline' },
  // Capture in the middle, where a thumb reaches without moving the phone. It
  // is the only tab that is a thing you *do* rather than a thing you read, and
  // the only one you would ever open one-handed in a hurry.
  { key: 'capture', label: 'Capture', icon: 'camera-outline' },
  { key: 'gallery', label: 'Media', icon: 'images-outline' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline' },
];

/**
 * Four tabs, each with its own stack of detail pages.
 *
 * Still no navigation library. `usePageStack` is an array and three functions,
 * against a router that would bring a native screen container, a navigation
 * state tree and a serialisation format. One stack per tab rather than one
 * global stack, so going Today → a journey → Capture → back leaves the journey
 * where you left it.
 *
 * **Places used to be a tab and is now a page under Settings.** Day, Capture
 * and Media are things you do or look at daily; Places is a reference list you
 * consult, and iOS collapses a sixth tab into a "More" menu that is worse than
 * either. The reasoning in `docs/ARCHITECTURE.md` §13 survives four tabs and
 * one level of depth; it would not survive a fifth level, deep links or modal
 * routes.
 *
 * Every tab stays **mounted**, with the inactive ones hidden, and a detail page
 * renders *over* its tab rather than replacing it. Both for the same reason:
 * Today holds a running recording and a timeline it just derived, and neither
 * should be lost because you opened a place you visited in March.
 *
 * The two exceptions are the ones that hold hardware or plaintext. Capture is
 * told which tab is showing so it mounts its preview only when it is on screen
 * — a capture session running behind three hidden screens costs battery and
 * leaves the recording indicator lit while you read Settings. Media is told for
 * the same reason twice over: a video should not keep playing out of sight, and
 * a decrypted capture should not sit in the cache for a tab nobody is looking
 * at.
 *
 * The hooks live here because they are shared. A stay can be named from Today
 * or from any day in History, media is written by Capture and read by Replay,
 * and hoisting means one copy rather than several that might drift.
 */
export function TabShell() {
  const [tab, setTab] = useState<Tab>('replay');
  const [naming, setNaming] = useState<StaySegment | null>(null);
  const [namingJourney, setNamingJourney] = useState<MoveSegment | null>(null);
  const [replayDayKey, setReplayDayKey] = useState<string | null>(null);

  const settings = useSettings();
  const journeys = useJourneyLabels();
  const places = usePlaces();
  const media = useMedia();
  const timeline = useTimeline(settings.settings, journeys.labels, settings.ready && journeys.ready);

  // A phone that does not move produces no fixes, so an afternoon at a desk
  // would otherwise leave the day empty. Only while tracking is on: the switch
  // being off means the app writes down nowhere you are.
  useHeartbeat(settings.tracking, timeline.refresh);

  const stacks: Record<PagedTab, ReturnType<typeof usePageStack<Page>>> = {
    replay: usePageStack<Page>(),
    gallery: usePageStack<Page>(),
    settings: usePageStack<Page>(),
  };

  const mapsEnabled = settings.settings.mapsEnabled;

  // Today plus every finished day: what Places counts visits over, what the
  // naming picker uses to say "you have been here 12 times", and what an export
  // covers.
  const allSegments = useMemo(
    () => [...timeline.history.flatMap((day) => day.segments), ...timeline.today],
    [timeline.history, timeline.today],
  );
  const visits = useMemo(() => visitsByPlace(allSegments, places.places), [allSegments, places.places]);

  // Today is a day like any other to the player, so it is grouped the same way
  // rather than special-cased into the list.
  const replayDays = useMemo(
    () => groupByDay(allSegments, timeline.tzOffsetMinutes),
    [allSegments, timeline.tzOffsetMinutes],
  );

  const openSegment = (which: PagedTab) => (segment: Segment) => stacks[which].push({ kind: 'segment', segment });
  const openMedia = (which: PagedTab) => (item: MediaItem) => stacks[which].push({ kind: 'media', item });

  /**
   * Where a capture happened.
   *
   * The coordinate taken at the shutter wins, because it is an answer about
   * *this* capture rather than an inference from the day around it. Falling
   * back to the timeline is what makes every photo taken before the app stored
   * one still have a location — and null, when the day has no fix for that
   * instant, is a real answer the media screen says out loud.
   */
  const positionOf = (item: MediaItem) => {
    if (item.at) return { ...item.at, at: item.capturedAt, speedMps: null, segmentId: '', kind: 'stay' as const };

    const day = replayDays.find(
      (candidate) =>
        item.capturedAt >= candidate.startedAt && item.capturedAt <= candidate.startedAt + 24 * 60 * 60_000,
    );
    return day ? positionAt(buildTrack(day.segments), item.capturedAt) : null;
  };

  function renderPage(which: PagedTab) {
    const page = stacks[which].current;
    if (!page) return null;

    const back = stacks[which].pop;

    if (page.kind === 'segment') {
      return (
        <SegmentScreen
          segment={page.segment}
          places={places.places}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          mapsEnabled={mapsEnabled}
          onBack={back}
          onNamePlace={page.segment.kind === 'stay' ? () => setNaming(page.segment as StaySegment) : undefined}
          onNameJourney={page.segment.kind === 'move' ? () => setNamingJourney(page.segment as MoveSegment) : undefined}
        />
      );
    }
    if (page.kind === 'alldays') {
      return (
        <HistoryScreen
          days={replayDays}
          places={places.places}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          onBack={back}
          onOpenDay={(chosen) => {
            // Chosen from the list, so it becomes the day being shown and the
            // list closes behind it — the day view is where you were going.
            setReplayDayKey(chosen.key);
            back();
          }}
        />
      );
    }
    if (page.kind === 'places') {
      return (
        <PlacesScreen
          places={places.places}
          allSegments={allSegments}
          onBack={back}
          onOpen={(place) => stacks[which].push({ kind: 'place', place })}
        />
      );
    }
    if (page.kind === 'place') {
      // Looked up fresh rather than held in the stack, so a rename shows
      // immediately instead of leaving a stale title behind.
      const current = places.places.find((candidate) => candidate.id === page.place.id);
      if (!current) return null;
      return (
        <PlaceScreen
          place={current}
          allSegments={allSegments}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          onBack={back}
          onRename={places.rename}
          onForget={places.forget}
        />
      );
    }
    if (page.kind === 'journeys') {
      return (
        <NamedJourneysScreen
          labels={journeys.labels}
          segments={allSegments}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          mapsEnabled={mapsEnabled}
          onBack={back}
          onOpenSegment={openSegment(which)}
          onForget={journeys.forget}
        />
      );
    }
    if (page.kind === 'media') {
      return (
        <MediaScreen
          item={page.item}
          at={positionOf(page.item)}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          mapsEnabled={mapsEnabled}
          onBack={back}
          onForget={media.forget}
        />
      );
    }
    return (
      <DataScreen
        fixes={timeline.fixes}
        segments={allSegments}
        places={places.places}
        media={media.items}
        rejected={timeline.rejected}
        preset={settings.settings.preset}
        now={timeline.now}
        tzOffsetMinutes={timeline.tzOffsetMinutes}
        onBack={back}
      />
    );
  }

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.screens}>
        <View style={[styles.screen, tab !== 'capture' && styles.hidden]}>
          <CaptureScreen media={media} visible={tab === 'capture'} />
        </View>

        <View style={[styles.screen, tab !== 'replay' && styles.hidden]}>
          <ReplayScreen
            days={replayDays}
            places={places.places}
            media={media.items}
            settings={settings}
            tzOffsetMinutes={timeline.tzOffsetMinutes}
            mapsEnabled={mapsEnabled}
            ready={timeline.ready}
            selectedDayKey={replayDayKey}
            onSelectDay={setReplayDayKey}
            onOpenSegment={openSegment('replay')}
            onOpenMedia={openMedia('replay')}
            onOpenAllDays={() => stacks.replay.push({ kind: 'alldays' })}
          />
          {stacks.replay.current ? (
            <SwipeBackPage onBack={stacks.replay.pop}>{renderPage('replay')}</SwipeBackPage>
          ) : null}
        </View>

        <View style={[styles.screen, tab !== 'gallery' && styles.hidden]}>
          <MediaGalleryScreen
            items={media.items}
            tzOffsetMinutes={timeline.tzOffsetMinutes}
            visible={tab === 'gallery'}
            onOpenDetails={openMedia('gallery')}
          />
          {stacks.gallery.current ? (
            <SwipeBackPage onBack={stacks.gallery.pop}>{renderPage('gallery')}</SwipeBackPage>
          ) : null}
        </View>

        <View style={[styles.screen, tab !== 'settings' && styles.hidden]}>
          <SettingsScreen
            settings={settings}
            rejected={timeline.rejected}
            onOpenData={() => stacks.settings.push({ kind: 'data' })}
            onOpenPlaces={() => stacks.settings.push({ kind: 'places' })}
            onOpenJourneys={() => stacks.settings.push({ kind: 'journeys' })}
          />
          {stacks.settings.current ? (
            <SwipeBackPage onBack={stacks.settings.pop}>{renderPage('settings')}</SwipeBackPage>
          ) : null}
        </View>
      </View>

      <View style={styles.tabBar}>
        {TABS.map(({ key, label, icon }) => {
          const active = tab === key;
          return (
            <Pressable
              key={key}
              onPress={() => setTab(key)}
              accessibilityRole="tab"
              // "History tab", not "History": each screen has a heading of its
              // own, and an ambiguous label is a coin toss for both a screen
              // reader and the UI smoke test.
              accessibilityLabel={`${label} tab`}
              accessibilityState={{ selected: active }}
              style={({ pressed }) => [styles.tab, pressed && styles.pressed]}
            >
              {/* Icon only. The label is still the accessibility name, so a
                  screen reader and the smoke test keep saying "Day tab" — what
                  goes is the visible word, not the meaning. */}
              <Ionicons name={icon} size={30} color={active ? colors.move : colors.textMuted} />
            </Pressable>
          );
        })}
      </View>

      <PlacePicker
        stay={naming}
        places={places.places}
        visits={visits}
        tzOffsetMinutes={timeline.tzOffsetMinutes}
        onPickExisting={(place) => {
          if (naming) places.link(naming, place);
          setNaming(null);
        }}
        onCreate={(name) => {
          if (naming) places.name(naming, name);
          setNaming(null);
        }}
        onClose={() => setNaming(null)}
      />

      {/* Hoisted beside the place picker, and for the same reason: a journey can
          be named from Today, from a day in History, or from Replay. */}
      <JourneyLabelSheet
        journey={namingJourney}
        tzOffsetMinutes={timeline.tzOffsetMinutes}
        onSave={(label, mode) => {
          if (namingJourney) journeys.name(namingJourney, label, mode);
        }}
        // Offered whenever a label produced this row — by name *or* by merge. A
        // merge has no name to remove and is otherwise impossible to undo.
        onForget={
          namingJourney && journeys.labels.some((one) => one.id === journeyLabelId(namingJourney.startedAt))
            ? () => journeys.forget(journeyLabelId(namingJourney.startedAt))
            : undefined
        }
        onClose={() => setNamingJourney(null)}
      />
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safeArea: { flex: 1, backgroundColor: colors.background },
  screens: { flex: 1 },
  // Absolute fill rather than conditional rendering: every screen keeps its
  // state and its scroll position, and switching costs nothing.
  screen: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0 },
  // A detail page sits over its tab's root, which stays mounted underneath.
  page: { position: 'absolute', top: 0, right: 0, bottom: 0, left: 0, backgroundColor: colors.background },
  hidden: { display: 'none' },
  tabBar: {
    flexDirection: 'row',
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.surface,
  },
  // A bigger target than the icon needs. With no labels under them the row was
  // as short as an icon and a hair of padding, which is a smaller thing to hit
  // than anything else in the app and the one you reach for most.
  tab: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingVertical: spacing.md, minHeight: 56 },
  pressed: { opacity: 0.6 },
});
