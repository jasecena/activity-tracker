import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, View } from 'react-native';

import type { RejectionReason } from '@/core/geo';
import { ScreenHeader } from '@/components/ScreenHeader';
import { TRACKING_PRESETS, type TrackingPresetId } from '@/services/location';
import { colors, radius, spacing, typography } from '@/theme/tokens';

import type { UseSettings } from './hooks/useSettings';

interface SettingsScreenProps {
  readonly settings: UseSettings;
  readonly rejected: Readonly<Record<RejectionReason, number>> | null;
  readonly onOpenData: () => void;
  /**
   * Places used to be a tab. It moved here when Replay and Capture arrived and
   * the bar ran out of room — it is a reference list you consult, not somewhere
   * you glance at several times a day.
   */
  readonly onOpenPlaces: () => void;
}

const PERMISSION_TEXT: Readonly<Record<string, string>> = {
  always: 'Always — records with the app closed',
  'when-in-use': 'While Using — gaps whenever the app is closed',
  denied: 'Denied — nothing is being recorded',
  unknown: 'Not asked yet',
};

const RETENTION_CHOICES: readonly { readonly label: string; readonly days: number | null }[] = [
  { label: 'Keep everything', days: null },
  { label: '1 year', days: 365 },
  { label: '90 days', days: 90 },
  { label: '30 days', days: 30 },
];

export function SettingsScreen({ settings, rejected, onOpenData, onOpenPlaces }: SettingsScreenProps) {
  const { settings: values } = settings;

  const confirmErase = () => {
    Alert.alert(
      'Erase everything?',
      'This destroys the encryption key, which makes every recorded day permanently unreadable. There is no copy anywhere else.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Erase', style: 'destructive', onPress: () => void settings.eraseAll() },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Settings" />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Track my day</Text>
              <Text style={styles.rowDetail}>{PERMISSION_TEXT[settings.permission] ?? ''}</Text>
            </View>
            <Switch
              value={settings.tracking}
              onValueChange={settings.setTracking}
              accessibilityLabel="Track my day"
              trackColor={{ true: colors.move, false: colors.border }}
            />
          </View>
        </View>

        <Text style={styles.sectionLabel}>ACCURACY &amp; BATTERY</Text>
        {/* Said before the list, not after: the rows below show your choice
            still selected, and without this the app would appear to be running
            a preset it is not. */}
        {settings.savingBattery ? (
          <View style={styles.notice}>
            <Text style={styles.noticeTitle}>Running on Battery saver</Text>
            <Text style={styles.noticeBody}>
              The battery is below 20%, so tracking has dropped to a point every 100 m. Your choice below is kept and
              comes back on its own once the phone is charged past 25%.
            </Text>
          </View>
        ) : null}
        <View style={styles.card}>
          {(Object.keys(TRACKING_PRESETS) as TrackingPresetId[]).map((id) => {
            const preset = TRACKING_PRESETS[id];
            const selected = values.preset === id;
            return (
              <Pressable
                key={id}
                onPress={() => settings.setPreset(id)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={`${preset.label}. ${preset.detail}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <View style={styles.rowText}>
                  <Text style={[styles.rowTitle, selected && styles.selected]}>{preset.label}</Text>
                  <Text style={styles.rowDetail}>
                    {preset.detail}
                    {id === settings.runningPreset && settings.savingBattery ? ' — running now' : ''}
                  </Text>
                </View>
                {selected ? <Text style={styles.tick}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>
        {/* The honest version of "does this drain my battery". */}
        <Text style={styles.footnote}>
          The GPS is only woken when you have moved by the distance above, so standing still costs nothing. Location
          updates are never paused automatically — iOS does not reliably resume them, and a day missing from a diary is
          worse than a percent of battery. Below 20% the app drops to Battery saver by itself, since it is the thing
          draining the phone; on a charger it never does.
        </Text>

        <Text style={styles.sectionLabel}>MAPS</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Show routes on a map</Text>
              <Text style={styles.rowDetail}>
                {values.mapsEnabled ? 'On — map imagery is fetched from Apple' : 'Off — routes are drawn without tiles'}
              </Text>
            </View>
            <Switch
              value={values.mapsEnabled}
              onValueChange={settings.setMapsEnabled}
              accessibilityLabel="Show routes on a map"
              trackColor={{ true: colors.move, false: colors.border }}
            />
          </View>
        </View>
        {/* The only place in the app that costs a network request, so it is the
            only place that has to be spelled out rather than assumed. */}
        <Text style={styles.footnote}>
          This is the one thing in the app that talks to the internet. Turning it on lets Apple see which part of the
          map you are looking at. Your route is never sent — it is drawn on top, on this phone. With it off, journeys
          are drawn from your own coordinates with a scale bar and no map underneath.
        </Text>

        <Text style={styles.sectionLabel}>CALORIES</Text>
        <View style={styles.card}>
          <View style={styles.row}>
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Weight</Text>
              <Text style={styles.rowDetail}>{values.weightKg} kg — used for the calorie estimate</Text>
            </View>
            <View style={styles.stepper}>
              <Pressable
                onPress={() => settings.setWeightKg(values.weightKg - 1)}
                accessibilityRole="button"
                accessibilityLabel="Decrease weight"
                style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
              >
                <Text style={styles.stepperText}>−</Text>
              </Pressable>
              <Pressable
                onPress={() => settings.setWeightKg(values.weightKg + 1)}
                accessibilityRole="button"
                accessibilityLabel="Increase weight"
                style={({ pressed }) => [styles.stepperButton, pressed && styles.pressed]}
              >
                <Text style={styles.stepperText}>+</Text>
              </Pressable>
            </View>
          </View>
        </View>

        <Text style={styles.sectionLabel}>HISTORY</Text>
        <View style={styles.card}>
          {RETENTION_CHOICES.map((choice) => {
            const selected = values.retentionDays === choice.days;
            return (
              <Pressable
                key={choice.label}
                onPress={() => settings.setRetentionDays(choice.days)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={choice.label}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Text style={[styles.rowTitle, selected && styles.selected]}>{choice.label}</Text>
                {selected ? <Text style={styles.tick}>✓</Text> : null}
              </Pressable>
            );
          })}
        </View>

        <Text style={styles.sectionLabel}>DATA</Text>
        <View style={styles.card}>
          <Pressable
            onPress={onOpenPlaces}
            accessibilityRole="button"
            accessibilityLabel="Places"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Places</Text>
              <Text style={styles.rowDetail}>Everywhere you have named, and how long you spent there</Text>
            </View>
            <Text style={styles.tick}>›</Text>
          </Pressable>
          <Pressable
            onPress={onOpenData}
            accessibilityRole="button"
            accessibilityLabel="Raw data and export"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Raw data &amp; export</Text>
              <Text style={styles.rowDetail}>
                {rejected ? `What is stored, why fixes were dropped, and CSV export` : 'What is stored, and CSV export'}
              </Text>
            </View>
            <Text style={styles.tick}>›</Text>
          </Pressable>
        </View>

        <Text style={styles.sectionLabel}>PRIVACY</Text>
        <View style={styles.card}>
          {/* This paragraph has to track the switch above it. "No network
              requests of any kind" was true of every build until maps existed,
              and leaving it there once they do would make the one screen that
              promises honesty the one screen that is wrong. */}
          <Text style={styles.privacy}>
            Everything — days, places, photos, video and voice notes — is encrypted on this phone with a key held in the
            iOS keychain and marked so it never enters a backup.{' '}
            {values.mapsEnabled
              ? 'Map imagery is the one exception: it is fetched from Apple while you look at a map. Nothing you have recorded is sent with it, and nothing else in the app talks to a network.'
              : 'The app makes no network requests of any kind — there is no server to send anything to.'}
          </Text>
        </View>

        <Pressable
          onPress={confirmErase}
          accessibilityRole="button"
          accessibilityLabel="Erase everything"
          style={({ pressed }) => [styles.erase, pressed && styles.pressed]}
        >
          <Text style={styles.eraseText}>Erase everything</Text>
        </Pressable>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
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
  sectionLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, marginTop: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.md,
  },
  rowText: { flex: 1, gap: 2 },
  rowTitle: { ...typography.body, color: colors.textPrimary },
  rowDetail: { ...typography.caption, color: colors.textSecondary },
  selected: { color: colors.move, fontWeight: '600' },
  tick: { ...typography.body, color: colors.move },
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs },
  stepper: { flexDirection: 'row', gap: spacing.xs },
  stepperButton: {
    width: 36,
    height: 36,
    borderRadius: radius.sm,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  stepperText: { ...typography.title, fontSize: 20, color: colors.textPrimary },
  privacy: { ...typography.caption, color: colors.textSecondary, paddingVertical: spacing.md },
  erase: {
    marginTop: spacing.lg,
    borderWidth: 1,
    borderColor: colors.danger,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  eraseText: { ...typography.body, color: colors.danger, fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
