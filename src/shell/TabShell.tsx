import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { DayGroup } from '@/core/day';
import { formatDayTitle } from '@/core/format';
import { visitsByPlace, type Place } from '@/core/places';
import type { Segment, StaySegment } from '@/core/segments';
import { SegmentScreen } from '@/features/activities/SegmentScreen';
import { useTimeline } from '@/features/activities/hooks/useTimeline';
import { DataScreen } from '@/features/data/DataScreen';
import { DayScreen } from '@/features/history/DayScreen';
import { HistoryScreen } from '@/features/history/HistoryScreen';
import { PlaceScreen } from '@/features/places/PlaceScreen';
import { PlacesScreen } from '@/features/places/PlacesScreen';
import { PlacePicker } from '@/features/places/components/PlacePicker';
import { usePlaces } from '@/features/places/hooks/usePlaces';
import { useRecording } from '@/features/record/hooks/useRecording';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { useSettings } from '@/features/settings/hooks/useSettings';
import { TodayScreen } from '@/features/today/TodayScreen';
import { colors, spacing, typography } from '@/theme/tokens';

import { usePageStack } from './usePageStack';

type Tab = 'today' | 'history' | 'places' | 'settings';

/** Pages that can sit above a tab's root. */
type Page =
  | { readonly kind: 'segment'; readonly segment: Segment }
  | { readonly kind: 'day'; readonly day: DayGroup }
  | { readonly kind: 'place'; readonly place: Place }
  | { readonly kind: 'data' };

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'today', label: 'Today', icon: 'today-outline' },
  { key: 'history', label: 'History', icon: 'calendar-outline' },
  { key: 'places', label: 'Places', icon: 'location-outline' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline' },
];

/**
 * Four tabs, each with its own stack of detail pages.
 *
 * Still no navigation library. `usePageStack` is an array and three functions,
 * against a router that would bring a native screen container, a navigation
 * state tree and a serialisation format. One stack per tab rather than one
 * global stack, so going Today → a journey → Places → back leaves the journey
 * where you left it.
 *
 * Every tab stays **mounted**, with the inactive ones hidden, and a detail page
 * renders *over* its tab rather than replacing it. Both for the same reason:
 * Today holds a running recording and a timeline it just derived, and neither
 * should be lost because you opened a place you visited in March.
 *
 * The hooks and the place picker live here because they are shared. A stay can
 * be named from Today or from any day in History, and hoisting the picker means
 * one copy rather than one per screen that might drift.
 */
export function TabShell() {
  const [tab, setTab] = useState<Tab>('today');
  const [naming, setNaming] = useState<StaySegment | null>(null);

  const settings = useSettings();
  const recording = useRecording();
  const places = usePlaces();
  const timeline = useTimeline(settings.settings, recording.windows, settings.ready && recording.ready);

  const stacks: Record<Tab, ReturnType<typeof usePageStack<Page>>> = {
    today: usePageStack<Page>(),
    history: usePageStack<Page>(),
    places: usePageStack<Page>(),
    settings: usePageStack<Page>(),
  };

  // Today plus every finished day: what Places counts visits over, what the
  // naming picker uses to say "you have been here 12 times", and what an export
  // covers.
  const allSegments = useMemo(
    () => [...timeline.history.flatMap((day) => day.segments), ...timeline.today],
    [timeline.history, timeline.today],
  );
  const visits = useMemo(() => visitsByPlace(allSegments, places.places), [allSegments, places.places]);

  const openSegment = (which: Tab) => (segment: Segment) => stacks[which].push({ kind: 'segment', segment });

  function renderPage(which: Tab) {
    const page = stacks[which].current;
    if (!page) return null;

    const back = stacks[which].pop;

    if (page.kind === 'segment') {
      return (
        <SegmentScreen
          segment={page.segment}
          places={places.places}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          onBack={back}
          onNamePlace={page.segment.kind === 'stay' ? () => setNaming(page.segment as StaySegment) : undefined}
        />
      );
    }
    if (page.kind === 'day') {
      return (
        <DayScreen
          day={page.day}
          places={places.places}
          weightKg={settings.settings.weightKg}
          tzOffsetMinutes={timeline.tzOffsetMinutes}
          title={formatDayTitle(page.day.startedAt, timeline.tzOffsetMinutes)}
          onBack={back}
          onOpenSegment={openSegment(which)}
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
    return (
      <DataScreen
        fixes={timeline.fixes}
        segments={allSegments}
        places={places.places}
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
        <View style={[styles.screen, tab !== 'today' && styles.hidden]}>
          <TodayScreen
            segments={timeline.today}
            places={places.places}
            onOpenSegment={openSegment('today')}
            recording={recording}
            settings={settings}
            now={timeline.now}
            tzOffsetMinutes={timeline.tzOffsetMinutes}
            ready={timeline.ready}
          />
          {stacks.today.current ? <View style={styles.page}>{renderPage('today')}</View> : null}
        </View>

        <View style={[styles.screen, tab !== 'history' && styles.hidden]}>
          <HistoryScreen
            days={timeline.history}
            places={places.places}
            tzOffsetMinutes={timeline.tzOffsetMinutes}
            onOpenDay={(day) => stacks.history.push({ kind: 'day', day })}
          />
          {stacks.history.current ? <View style={styles.page}>{renderPage('history')}</View> : null}
        </View>

        <View style={[styles.screen, tab !== 'places' && styles.hidden]}>
          <PlacesScreen
            places={places.places}
            allSegments={allSegments}
            onOpen={(place) => stacks.places.push({ kind: 'place', place })}
          />
          {stacks.places.current ? <View style={styles.page}>{renderPage('places')}</View> : null}
        </View>

        <View style={[styles.screen, tab !== 'settings' && styles.hidden]}>
          <SettingsScreen
            settings={settings}
            rejected={timeline.rejected}
            onOpenData={() => stacks.settings.push({ kind: 'data' })}
          />
          {stacks.settings.current ? <View style={styles.page}>{renderPage('settings')}</View> : null}
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
              <Ionicons name={icon} size={24} color={active ? colors.move : colors.textMuted} />
              <Text style={[styles.tabLabel, active && styles.tabLabelActive]}>{label}</Text>
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
  tab: { flex: 1, alignItems: 'center', gap: spacing.xs, paddingTop: spacing.sm, paddingBottom: spacing.xs },
  tabLabel: { ...typography.caption, color: colors.textMuted },
  tabLabelActive: { color: colors.move },
  pressed: { opacity: 0.6 },
});
