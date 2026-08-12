import { Alert, Pressable, ScrollView, StyleSheet, Switch, Text, TextInput, View } from 'react-native';

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
  /** Every journey you have named, on one map. */
  readonly onOpenJourneys: () => void;
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

/**
 * What honestly leaves this phone, given what is switched on.
 *
 * Four sentences for four states rather than one hedged sentence for all of
 * them. The screen whose entire purpose is not overstating protection is the
 * worst possible place to write something that is true in three configurations
 * out of four — and this paragraph has already been wrong twice, both times in
 * the direction of claiming more safety than the app provided.
 *
 * The transcription clause names the recording specifically. "A network
 * request" and "a recording of your voice" are not the same admission, and
 * collapsing them into one word would be the same failure in a new place.
 */
function networkNote(mapsEnabled: boolean, canTranscribe: boolean): string {
  if (mapsEnabled && canTranscribe) {
    return 'Two things leave this phone. Map imagery is fetched from Apple while you look at a map, and a voice note is uploaded to ElevenLabs when you press Transcribe on it. Nothing you have recorded goes with a map request, and nothing but the recording itself goes with a transcription.';
  }
  if (mapsEnabled) {
    return 'Map imagery is the one exception: it is fetched from Apple while you look at a map. Nothing you have recorded is sent with it, and nothing else in the app talks to a network.';
  }
  if (canTranscribe) {
    return 'One thing can leave this phone: a voice note, uploaded to ElevenLabs when you press Transcribe on it, and never on its own. Nothing goes with it — not your notes, not your days, not where you were. Nothing else in the app talks to a network.';
  }
  return 'The app makes no network requests of any kind — there is no server to send anything to.';
}

export function SettingsScreen({ settings, rejected, onOpenData, onOpenPlaces, onOpenJourneys }: SettingsScreenProps) {
  const { settings: values } = settings;

  /**
   * Two prompts, not one, and the second is not a repeat of the first.
   *
   * The first says what is destroyed. The second says that it is already gone
   * by the time you could regret it — there is no key escrow, no backup to
   * restore from and, until the sync lands, nothing off this phone at all. A
   * single destructive alert is the pattern for an action that can be redone;
   * this one cannot be, and the whole store is behind it.
   *
   * The second prompt asks a *different* question so that a person tapping
   * through by reflex has to read something. Repeating "Erase everything?"
   * twice trains exactly the muscle memory the second prompt exists to break.
   */
  const confirmEraseFinal = () => {
    Alert.alert(
      'There is no way back',
      'Nothing is kept anywhere else, so none of it can be recovered. Erase it all?',
      [
        { text: 'Keep my data', style: 'cancel' },
        { text: 'Erase everything', style: 'destructive', onPress: () => void settings.eraseAll() },
      ],
    );
  };

  const confirmErase = () => {
    Alert.alert(
      'Erase everything?',
      'This destroys the encryption key and deletes every photo, video and voice note. Every recorded day becomes permanently unreadable.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: confirmEraseFinal },
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
        {/* One of two places in the app that cost a network request, so it is
            one of two places that have to be spelled out rather than assumed.
            It said "the one thing" until transcription shipped; a privacy
            paragraph that is one release out of date is the failure this screen
            exists to avoid. */}
        <Text style={styles.footnote}>
          One of the two things in this app that talk to the internet. Turning it on lets Apple see which part of the
          map you are looking at. Your route is never sent — it is drawn on top, on this phone. With it off, journeys
          are drawn from your own coordinates with a scale bar and no map underneath.
        </Text>

        <Text style={styles.sectionLabel}>TRANSCRIBING VOICE NOTES</Text>
        <View style={styles.card}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>ElevenLabs API key</Text>
            <Text style={styles.rowDetail}>
              {values.transcriptionKey.length > 0
                ? 'Set — a Transcribe button appears on notes that have a recording'
                : 'Not set — voice notes stay on this phone and cannot be transcribed'}
            </Text>
          </View>
          <TextInput
            value={values.transcriptionKey}
            onChangeText={settings.setTranscriptionKey}
            placeholder="xi-..."
            placeholderTextColor={colors.textMuted}
            style={styles.keyInput}
            accessibilityLabel="ElevenLabs API key"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />

          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Language</Text>
            <Text style={styles.rowDetail}>
              An ISO code, pinned rather than detected. Telling the service which language to expect is most of its
              accuracy.
            </Text>
          </View>
          <TextInput
            value={values.transcriptionLanguage}
            onChangeText={settings.setTranscriptionLanguage}
            placeholder="fa"
            placeholderTextColor={colors.textMuted}
            style={styles.keyInput}
            accessibilityLabel="Transcription language code"
            autoCapitalize="none"
            autoCorrect={false}
            maxLength={3}
          />
        </View>
        {/* The plainest statement in the app, because it is the only feature
            that sends a recording of its owner anywhere. */}
        <Text style={styles.footnote}>
          The second thing that talks to the internet, and the only one that sends anything you recorded.{' '}
          <Text style={styles.footnoteStrong}>Nothing is transcribed automatically.</Text> When you press Transcribe on
          a note, that one recording is uploaded to ElevenLabs and the text comes back and is added to the end of the
          note. Nothing else goes with it — not what you typed, not the title, not the day, not where you were. Clear
          the key and the button disappears. Your key is stored encrypted on this phone and never leaves it.
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
        {/* Retention reaches the day log and the fix archive and nothing else,
            so "keep 30 days" is not what it sounds like once there are
            photographs. That asymmetry is deliberate — a fix is something the
            app collected on its own, a capture is something you chose to take,
            and deleting the second on a timer is not the app's call — but it
            was previously invisible, which is what made it a problem. Captures
            are also the only store with no bound on them, so the sentence has
            to be here rather than inferred from the Data screen's total. */}
        <Text style={styles.footnote}>
          This covers the recorded days and the raw fixes behind them. Photos, video, voice notes and anything you have
          written in your diary are never deleted on a timer — they stay until you delete them, however old the day they
          belong to. So a day can outlive its own readings as a sentence about what happened.
        </Text>

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
            onPress={onOpenJourneys}
            accessibilityRole="button"
            accessibilityLabel="Named journeys"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Named journeys</Text>
              <Text style={styles.rowDetail}>Every journey you have given a name, on one map</Text>
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
          {/* This paragraph has to track the app, and it has now been wrong
              twice for the same reason: something changed underneath it and the
              sentence stayed. "No network requests of any kind" outlived the
              maps switch; "everything is encrypted with a key in the keychain"
              outlived the media container, which was withdrawn in favour of
              ordinary files that iOS encrypts and a backup-exclusion flag.

              Both times the error ran the same way — the screen claimed more
              protection than the app provided. That is the direction that
              matters, and it is why this is two sentences about two mechanisms
              rather than one comfortable sentence about everything. The one
              screen that promises honesty must not be the one screen that is
              wrong. */}
          <Text style={styles.privacy}>
            Days, places and labels are encrypted on this phone with a key held in the iOS keychain and marked so it
            never enters a backup. Photos, video and voice notes are files in this app&apos;s own storage, which iOS
            encrypts under your passcode, and they are marked so they never enter a backup either.{' '}
            {networkNote(values.mapsEnabled, values.transcriptionKey.length > 0)}
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
  footnoteStrong: { fontWeight: '600', color: colors.textPrimary },
  keyInput: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    marginTop: spacing.xs,
    marginBottom: spacing.sm,
  },
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
