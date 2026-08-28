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
  /** Every journey you have named, on one map. */
  readonly onOpenJourneys: () => void;
  /**
   * Whether each thing that talks to the internet actually works.
   *
   * Its own page rather than a button beside each set of fields: the useful
   * answer is the four lines together — a plans bucket that signs but has no
   * passphrase reads very differently next to a backup bucket that works.
   */
  readonly onOpenDiagnostics: () => void;
  /**
   * Everywhere the app can be given a key, on one page.
   *
   * Directly above Check connections, because entering a credential and testing
   * it are the same errand — and this is the page you come back from when a
   * check goes red.
   */
  readonly onOpenCredentials: () => void;
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
/**
 * What leaves this phone, said accurately whatever is switched on.
 *
 * **Composed from a list rather than written out per combination**, and that is
 * a change forced by the third destination. Two switches were four sentences
 * and three would be eight — which is eight chances to leave one stale, and
 * this app has already shipped two claims that promised more protection than it
 * provided. A list cannot drift: adding a destination adds a line.
 *
 * Each entry says the thing that actually goes, because "talks to the internet"
 * is not the question anybody is asking. What they want to know is what of
 * theirs is in the request.
 */
/**
 * The hand-off, which is not a request and is still worth saying.
 *
 * **Said in both branches, including the one that claims no network requests at
 * all.** That claim stays literally true — opening a link is iOS's business and
 * this app never opens a socket for it — but somebody reading "no network
 * requests of any kind" is being told that nothing about them goes anywhere,
 * and pressing Open in Maps puts one of their coordinates in front of Google.
 * That it happens in a browser view rather than in this app's own code is a
 * true distinction and not the one the sentence is understood to make.
 *
 * This paragraph has been wrong twice — once claiming captures were sealed a
 * release after they stopped being, once promising recordings were never
 * uploaded while a network feature was shipping. Both times the code moved and
 * the sentence did not. This is the third opportunity and it is being taken.
 */
const HANDOFF =
  'Separately: opening a stay, a journey or the planner opens a web page inside this app — a browser view that runs on its own, which this app can neither read nor follow. A map sends Google the one coordinate and nothing else about the stay; the planner is your own machine. Both happen only when you press the link.';

function networkNote(mapsEnabled: boolean, canTranscribe: boolean, canBackUp: boolean, canSendPlans: boolean): string {
  const destinations = [
    mapsEnabled &&
      'map imagery is fetched from Apple while you look at a map, and nothing you have recorded goes with the request',
    canTranscribe &&
      'a voice note is uploaded to ElevenLabs when you press Transcribe on it, and nothing goes with it — not your notes, not your days, not where you were',
    canBackUp &&
      'the days that are over are sealed on this phone and sent to your own S3 bucket when you press Back up, which nobody but you holds the key to',
    // **Two buckets, said as two buckets.** The backup is where a year of
    // journeys lives; the plans bucket holds words and instants and has never
    // held a coordinate. They are sealed under different passphrases, so
    // whatever reads the second cannot open the first — and that is the whole
    // reason there are two, which makes it worth a clause here rather than a
    // sentence somewhere nobody reads.
    canSendPlans &&
      'anything you file under Plans is sealed and sent to a second, separate bucket when you press Send — its words only, never its recording, never anything from the diary, and under a different passphrase from the backup, so whatever reads your plans cannot open your journeys',
  ].filter((entry): entry is string => typeof entry === 'string');

  if (destinations.length === 0) {
    return `The app makes no network requests of any kind — there is no server to send anything to. ${HANDOFF}`;
  }

  const count =
    destinations.length === 1 ? 'One thing leaves this phone' : `${destinations.length} things leave this phone`;
  // **"None of it happens on its own" was true, then false, and is true again.**
  //
  // It was written when nothing here was automatic, left standing when Plans
  // arrived and started uploading unattended, and corrected to admit the
  // exception. Plans is a press again — because what it sends reaches a machine
  // that hands it to a model and writes the result into a database, so an
  // unreviewed transcript becomes a wrong row somebody has to go and find.
  //
  // Restoring the original sentence rather than keeping a hedged one: the claim
  // is simple again and should read that way. What must not happen is the third
  // version of this comment being written because somebody made something
  // automatic and left the sentence alone.
  const automatic = canSendPlans
    ? 'None of it happens on its own: every one of these waits for you to press something.'
    : 'None of it happens on its own.';
  return `${count}: ${destinations.join('; ')}. Nothing else in the app talks to a network. ${automatic} ${HANDOFF}`;
}

export function SettingsScreen({
  settings,
  rejected,
  onOpenData,
  onOpenPlaces,
  onOpenJourneys,
  onOpenDiagnostics,
  onOpenCredentials,
}: SettingsScreenProps) {
  const { settings: values } = settings;

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
      'This destroys the encryption key and deletes every photo, video and voice note. Every recorded day becomes permanently unreadable.\n\nAnything already backed up to your bucket is not touched — this app cannot delete from it.',
      [
        { text: 'Cancel', style: 'cancel' },
        { text: 'Continue', style: 'destructive', onPress: confirmEraseFinal },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Settings" />

      {/* **The keyboard would otherwise cover the field being typed into.**
          Eight text fields live down this page — the transcription key, and the
          five that configure the backup — and every one of them below the fold
          sits under the keyboard the moment it opens. This is iOS's own inset:
          the scroller gains exactly the keyboard's height at the bottom and
          scrolls the focused field into view, which is the whole fix on a plain
          scrolling page. The sheets need a `KeyboardAvoidingView` instead
          because they are anchored to the bottom rather than scrolling. */}
      <ScrollView contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
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
          One of the things in this app that talk to the internet. Turning it on lets Apple see which part of the map
          you are looking at. Your route is never sent — it is drawn on top, on this phone. With it off, journeys are
          drawn from your own coordinates with a scale bar and no map underneath.
        </Text>

        {/* **The bucket, and the one field that can never be changed.**
            
            Four fields for the destination, rotatable by retyping, and a
            passphrase that is typed twice and then gone. What is stored is the
            key scrypt makes from it, never the phrase — a phone taken apart
            yields something that opens this backup and nothing else. */}
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
          <Pressable
            onPress={onOpenCredentials}
            accessibilityRole="button"
            accessibilityLabel="Credentials"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Credentials</Text>
              <Text style={styles.rowDetail}>The backup bucket, the plans bucket, and the transcription key</Text>
            </View>
            <Text style={styles.tick}>›</Text>
          </Pressable>
          <Pressable
            onPress={onOpenDiagnostics}
            accessibilityRole="button"
            accessibilityLabel="Check connections"
            style={({ pressed }) => [styles.row, pressed && styles.pressed]}
          >
            <View style={styles.rowText}>
              <Text style={styles.rowTitle}>Check connections</Text>
              <Text style={styles.rowDetail}>
                Whether transcription, the backup bucket and the plans bucket are working
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
            {networkNote(
              values.mapsEnabled,
              values.transcriptionKey.length > 0,
              values.backupBucket.length > 0 && values.backupKeyHex.length > 0,
              values.exchangeBucket.length > 0 && values.exchangeKeyHex.length > 0,
            )}
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
  action: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingVertical: spacing.sm,
    alignItems: 'center',
    marginTop: spacing.xs,
  },
  actionOff: { opacity: 0.4 },
  actionText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  pressed: { opacity: 0.6 },
});
