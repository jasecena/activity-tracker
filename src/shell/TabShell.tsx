import { Ionicons } from '@expo/vector-icons';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useTimeline } from '@/features/activities/hooks/useTimeline';
import { HistoryScreen } from '@/features/history/HistoryScreen';
import { usePlaces } from '@/features/places/hooks/usePlaces';
import { useRecording } from '@/features/record/hooks/useRecording';
import { SettingsScreen } from '@/features/settings/SettingsScreen';
import { useSettings } from '@/features/settings/hooks/useSettings';
import { TodayScreen } from '@/features/today/TodayScreen';
import { colors, spacing, typography } from '@/theme/tokens';

type Tab = 'today' | 'history' | 'settings';

const TABS: { key: Tab; label: string; icon: keyof typeof Ionicons.glyphMap }[] = [
  { key: 'today', label: 'Today', icon: 'today-outline' },
  { key: 'history', label: 'History', icon: 'calendar-outline' },
  { key: 'settings', label: 'Settings', icon: 'settings-outline' },
];

/**
 * Three tabs, hand-rolled.
 *
 * No navigation library: three tabs need no router, no navigation state and no
 * native screen container, and this stays one file with no extra native module
 * in the build.
 *
 * Every screen stays **mounted**, with the inactive ones hidden. Today holds a
 * running recording and a timeline it just derived; unmounting it to glance at
 * History would throw both away and re-read the store on the way back.
 *
 * The hooks live here rather than in the screens because two of them are shared
 * — the timeline needs the manual windows and the segmentation settings, and
 * Settings needs the rejection counts the timeline produced. Lifting them is
 * what keeps a single fold serving all three tabs.
 */
export function TabShell() {
  const [tab, setTab] = useState<Tab>('today');

  const settings = useSettings();
  const recording = useRecording();
  const places = usePlaces();
  const timeline = useTimeline(settings.settings, recording.windows, settings.ready && recording.ready);

  return (
    <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
      <View style={styles.screens}>
        <View style={[styles.screen, tab !== 'today' && styles.hidden]}>
          <TodayScreen
            segments={timeline.today}
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
            weightKg={settings.settings.weightKg}
            tzOffsetMinutes={timeline.tzOffsetMinutes}
          />
        </View>
        <View style={[styles.screen, tab !== 'settings' && styles.hidden]}>
          <SettingsScreen
            settings={settings}
            places={places.places}
            onForgetPlace={places.forget}
            rejected={timeline.rejected}
          />
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
