import { Ionicons } from '@expo/vector-icons';
import { useMemo, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import type { DayGroup } from '@/core/day';
import { formatDayTitle } from '@/core/format';
import type { Place } from '@/core/places';
import { useTimeline } from '@/features/activities/hooks/useTimeline';
import { DayScreen } from '@/features/history/DayScreen';
import { HistoryScreen } from '@/features/history/HistoryScreen';
import { PlaceScreen } from '@/features/places/PlaceScreen';
import { PlacesScreen } from '@/features/places/PlacesScreen';
import { usePlaces } from '@/features/places/hooks/usePlaces';
import { useRecording } from '@/features/record/hooks/useRecording';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { useSettings } from '@/features/settings/hooks/useSettings';
import { TodayScreen } from '@/features/today/TodayScreen';
import { colors, spacing, typography } from '@/theme/tokens';

import { usePageStack } from './usePageStack';

type Tab = 'today' | 'history' | 'places' | 'settings';

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'today', label: 'Today', icon: 'today-outline' },
  { key: 'history', label: 'History', icon: 'calendar-outline' },
  { key: 'places', label: 'Places', icon: 'location-outline' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline' },
];

/**
 * Four tabs, two of which have detail pages below them.
 *
 * Still no navigation library. `usePageStack` is an array and three functions,
 * against a router that would bring a native screen container, a navigation
 * state tree and a serialisation format to solve the same problem. This is a
 * revision of an earlier decision — "three tabs need no router" — and the
 * reasoning survives the fourth tab and one level of depth. It would not survive
 * a fifth level, deep links or modal routes.
 *
 * Every tab stays **mounted**, with the inactive ones hidden, and a detail page
 * renders *over* its tab rather than replacing it. Both matter for the same
 * reason: Today holds a running recording and a timeline it just derived, and
 * neither should be lost because you glanced at a place you visited in March.
 *
 * The hooks live here because they are shared. The timeline needs the manual
 * windows and the segmentation settings; Settings needs the rejection counts the
 * timeline produced; Places needs every segment ever recorded. One fold serves
 * all four tabs.
 */
export function TabShell() {
  const [tab, setTab] = useState<Tab>('today');

  const settings = useSettings();
  const recording = useRecording();
  const places = usePlaces();
  const timeline = useTimeline(settings.settings, recording.windows, settings.ready && recording.ready);

  const historyPages = usePageStack<DayGroup>();
  const placePages = usePageStack<Place>();

  // Today plus every finished day: what Places counts visits over, and what the
  // naming picker uses to say "you have been here 12 times".
  const allSegments = useMemo(
    () => [...timeline.history.flatMap((day) => day.segments), ...timeline.today],
    [timeline.history, timeline.today],
  );

  // A place is looked up fresh each render rather than held in the stack, so a
  // rename shows immediately instead of leaving a stale title behind.
  const openPlace = placePages.current
    ? (places.places.find((candidate) => candidate.id === placePages.current?.id) ?? null)
    : null;

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.screens}>
        <View style={[styles.screen, tab !== 'today' && styles.hidden]}>
          <TodayScreen
            segments={timeline.today}
            allSegments={allSegments}
            places={places}
            recording={recording}
            settings={settings}
            now={timeline.now}
            tzOffsetMinutes={timeline.tzOffsetMinutes}
            ready={timeline.ready}
          />
        </View>

        <View style={[styles.screen, tab !== 'history' && styles.hidden]}>
          <HistoryScreen
            days={timeline.history}
            places={places.places}
            tzOffsetMinutes={timeline.tzOffsetMinutes}
            onOpenDay={historyPages.push}
          />
          {historyPages.current ? (
            <View style={styles.page}>
              <DayScreen
                day={historyPages.current}
                places={places.places}
                weightKg={settings.settings.weightKg}
                tzOffsetMinutes={timeline.tzOffsetMinutes}
                title={formatDayTitle(historyPages.current.startedAt, timeline.tzOffsetMinutes)}
                onBack={historyPages.pop}
              />
            </View>
          ) : null}
        </View>

        <View style={[styles.screen, tab !== 'places' && styles.hidden]}>
          <PlacesScreen places={places.places} allSegments={allSegments} onOpen={placePages.push} />
          {openPlace ? (
            <View style={styles.page}>
              <PlaceScreen
                place={openPlace}
                allSegments={allSegments}
                tzOffsetMinutes={timeline.tzOffsetMinutes}
                onBack={placePages.pop}
                onRename={places.rename}
                onForget={places.forget}
              />
            </View>
          ) : null}
        </View>

        <View style={[styles.screen, tab !== 'settings' && styles.hidden]}>
          <SettingsScreen settings={settings} rejected={timeline.rejected} />
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
  page: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.background,
  },
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
