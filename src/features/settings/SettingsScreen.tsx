import { useState } from 'react';
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
      'anything you file under Plans is sealed and sent to a second, separate bucket on its own, without a press — its words only, never its recording, never anything from the diary, and under a different passphrase from the backup, so whatever reads your plans cannot open your journeys',
    canSendPlans &&
      canTranscribe &&
      "a plan's recording is uploaded to ElevenLabs on its own too, to fetch the words that get sent",
  ].filter((entry): entry is string => typeof entry === 'string');

  if (destinations.length === 0) {
    return 'The app makes no network requests of any kind — there is no server to send anything to.';
  }

  const count =
    destinations.length === 1 ? 'One thing leaves this phone' : `${destinations.length} things leave this phone`;
  // **"None of it happens on its own" was true until Plans existed, and saying
  // it now would be the third string in this app's history to promise more than
  // it provides.** So the sentence names the exception instead of dropping the
  // claim: everything else still waits to be asked, and the one thing that does
  // not is the one you filed under a list that says so.
  const automatic = canSendPlans
    ? 'Everything but the Plans list waits to be asked; a plan goes as soon as you have made one.'
    : 'None of it happens on its own.';
  return `${count}: ${destinations.join('; ')}. Nothing else in the app talks to a network. ${automatic}`;
}

export function SettingsScreen({ settings, rejected, onOpenData, onOpenPlaces, onOpenJourneys }: SettingsScreenProps) {
  const { settings: values } = settings;

  /**
   * The bucket's four fields, held locally and written on blur.
   *
   * Persisting per keystroke would seal and write the store on every letter of
   * a secret key. They are drafts of one setting rather than four settings.
   */
  const [bucket, setBucket] = useState(values.backupBucket);
  const [region, setRegion] = useState(values.backupRegion);
  const [accessKeyId, setAccessKeyId] = useState(values.backupAccessKeyId);
  const [secretKey, setSecretKey] = useState(values.backupSecretKey);
  const saveTarget = () => settings.setBackupTarget({ bucket, region, accessKeyId, secretKey });

  /**
   * The plans bucket's four, held the same way and kept deliberately separate.
   *
   * Four more fields is not nothing, and the reason they are not one shared set
   * is the whole point of the feature: the credential typed here reaches a
   * bucket that has never held a coordinate, and the machine at home is given
   * this one and never the other.
   */
  const [exBucket, setExBucket] = useState(values.exchangeBucket);
  const [exRegion, setExRegion] = useState(values.exchangeRegion);
  const [exAccessKeyId, setExAccessKeyId] = useState(values.exchangeAccessKeyId);
  const [exSecretKey, setExSecretKey] = useState(values.exchangeSecretKey);
  const saveExchangeTarget = () =>
    settings.setExchangeTarget({
      bucket: exBucket,
      region: exRegion,
      accessKeyId: exAccessKeyId,
      secretKey: exSecretKey,
    });

  const [exPhrase, setExPhrase] = useState('');
  const [exPhraseAgain, setExPhraseAgain] = useState('');
  const saveExchangePassphrase = () => {
    if (exPhrase.length === 0 || exPhrase !== exPhraseAgain) return;
    Alert.alert(
      'Set this passphrase for good?',
      'Use a different one from your backup passphrase. Whatever reads your plans holds this key — and if it is the same key, it can open every journey in your backup too. It cannot be changed afterwards.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set it',
          onPress: () => {
            settings.setExchangePassphrase(exPhrase);
            setExPhrase('');
            setExPhraseAgain('');
          },
        },
      ],
    );
  };

  /**
   * The passphrase, twice.
   *
   * It can never be changed and the app can never read the bucket back to check
   * it, so a typo is permanent and silent — confirming is the only defence, and
   * it costs one field. Both drafts are dropped the moment it is set: what is
   * kept is the key scrypt makes, never the phrase.
   */
  const [phrase, setPhrase] = useState('');
  const [phraseAgain, setPhraseAgain] = useState('');
  const savePassphrase = () => {
    if (phrase.length === 0 || phrase !== phraseAgain) return;
    Alert.alert(
      'Set this passphrase for good?',
      'It cannot be changed afterwards, and nothing in this app can recover it. Everything backed up will be sealed with it — without it, the bucket cannot be opened by anybody, including you.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Set it',
          onPress: () => {
            settings.setBackupPassphrase(phrase);
            setPhrase('');
            setPhraseAgain('');
          },
        },
      ],
    );
  };

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
        <Text style={styles.sectionLabel}>BACKUP</Text>
        <View style={styles.card}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Bucket</Text>
            <Text style={styles.rowDetail}>
              {values.backupBucket.length > 0 ? `${values.backupBucket} · ${values.backupRegion}` : 'Not set'}
            </Text>
          </View>
          <TextInput
            value={bucket}
            onChangeText={setBucket}
            onBlur={saveTarget}
            placeholder="bucket name"
            placeholderTextColor={colors.textMuted}
            style={styles.keyInput}
            accessibilityLabel="Backup bucket"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            value={region}
            onChangeText={setRegion}
            onBlur={saveTarget}
            placeholder="ap-southeast-2"
            placeholderTextColor={colors.textMuted}
            style={styles.keyInput}
            accessibilityLabel="Backup region"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            value={accessKeyId}
            onChangeText={setAccessKeyId}
            onBlur={saveTarget}
            placeholder="AKIA..."
            placeholderTextColor={colors.textMuted}
            style={styles.keyInput}
            accessibilityLabel="Backup access key id"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            value={secretKey}
            onChangeText={setSecretKey}
            onBlur={saveTarget}
            placeholder="secret access key"
            placeholderTextColor={colors.textMuted}
            style={styles.keyInput}
            accessibilityLabel="Backup secret key"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>

        <View style={styles.card}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Passphrase</Text>
            <Text style={styles.rowDetail}>
              {values.backupKeyHex.length > 0
                ? 'Set. It cannot be changed, and nothing here can recover it.'
                : 'Type it twice. It is never stored and can never be changed.'}
            </Text>
          </View>
          {values.backupKeyHex.length === 0 ? (
            <>
              <TextInput
                value={phrase}
                onChangeText={setPhrase}
                placeholder="passphrase"
                placeholderTextColor={colors.textMuted}
                style={styles.keyInput}
                accessibilityLabel="Backup passphrase"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <TextInput
                value={phraseAgain}
                onChangeText={setPhraseAgain}
                placeholder="passphrase again"
                placeholderTextColor={colors.textMuted}
                style={styles.keyInput}
                accessibilityLabel="Backup passphrase again"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Pressable
                onPress={savePassphrase}
                disabled={phrase.length === 0 || phrase !== phraseAgain}
                accessibilityRole="button"
                accessibilityLabel="Set the backup passphrase"
                style={({ pressed }) => [
                  styles.action,
                  (phrase.length === 0 || phrase !== phraseAgain) && styles.actionOff,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.actionText}>
                  {phrase.length > 0 && phrase !== phraseAgain ? 'They do not match' : 'Set it, for good'}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
        <Text style={styles.footnote}>
          Backing up sends the days that are over to your own S3 bucket, sealed on this phone first. It happens only
          when you press the button on the Raw data screen — nothing is automatic. The passphrase is asked for twice
          because a typo in it is permanent and silent: it can never be changed, and the app cannot read the bucket back
          to check. Write it down somewhere that is not this phone.
        </Text>

        {/* **The second bucket, and why there is one.**

            Plans go up so something at home can read them and send back an
            agenda. That something must hold the key to whatever it reads — so
            the question is not whether to trust it, but how much to put within
            its reach. A separate bucket under a separate passphrase answers
            that: it can read what you filed under Plans, and it cannot open a
            single journey, photo or recording in the backup. */}
        <Text style={styles.sectionLabel}>PLANS</Text>
        <View style={styles.card}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Bucket</Text>
            <Text style={styles.rowDetail}>
              {values.exchangeBucket.length > 0
                ? `${values.exchangeBucket} · ${values.exchangeRegion}`
                : 'Not set — plans stay on this phone'}
            </Text>
          </View>
          <TextInput
            value={exBucket}
            onChangeText={setExBucket}
            onBlur={saveExchangeTarget}
            placeholder="bucket name"
            placeholderTextColor={colors.textMuted}
            style={styles.keyInput}
            accessibilityLabel="Plans bucket"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            value={exRegion}
            onChangeText={setExRegion}
            onBlur={saveExchangeTarget}
            placeholder="ap-southeast-2"
            placeholderTextColor={colors.textMuted}
            style={styles.keyInput}
            accessibilityLabel="Plans region"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            value={exAccessKeyId}
            onChangeText={setExAccessKeyId}
            onBlur={saveExchangeTarget}
            placeholder="AKIA..."
            placeholderTextColor={colors.textMuted}
            style={styles.keyInput}
            accessibilityLabel="Plans access key id"
            autoCapitalize="none"
            autoCorrect={false}
          />
          <TextInput
            value={exSecretKey}
            onChangeText={setExSecretKey}
            onBlur={saveExchangeTarget}
            placeholder="secret access key"
            placeholderTextColor={colors.textMuted}
            style={styles.keyInput}
            accessibilityLabel="Plans secret key"
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
          />
        </View>

        <View style={styles.card}>
          <View style={styles.rowText}>
            <Text style={styles.rowTitle}>Plans passphrase</Text>
            <Text style={styles.rowDetail}>
              {values.exchangeKeyHex.length > 0
                ? 'Set. It cannot be changed, and nothing here can recover it.'
                : 'A different one from the backup passphrase. Type it twice.'}
            </Text>
          </View>
          {values.exchangeKeyHex.length === 0 ? (
            <>
              <TextInput
                value={exPhrase}
                onChangeText={setExPhrase}
                placeholder="plans passphrase"
                placeholderTextColor={colors.textMuted}
                style={styles.keyInput}
                accessibilityLabel="Plans passphrase"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <TextInput
                value={exPhraseAgain}
                onChangeText={setExPhraseAgain}
                placeholder="plans passphrase again"
                placeholderTextColor={colors.textMuted}
                style={styles.keyInput}
                accessibilityLabel="Plans passphrase again"
                autoCapitalize="none"
                autoCorrect={false}
                secureTextEntry
              />
              <Pressable
                onPress={saveExchangePassphrase}
                disabled={exPhrase.length === 0 || exPhrase !== exPhraseAgain}
                accessibilityRole="button"
                accessibilityLabel="Set the plans passphrase"
                style={({ pressed }) => [
                  styles.action,
                  (exPhrase.length === 0 || exPhrase !== exPhraseAgain) && styles.actionOff,
                  pressed && styles.pressed,
                ]}
              >
                <Text style={styles.actionText}>
                  {exPhrase.length > 0 && exPhrase !== exPhraseAgain ? 'They do not match' : 'Set it, for good'}
                </Text>
              </Pressable>
            </>
          ) : null}
        </View>
        <Text style={styles.footnote}>
          A plan goes up on its own as soon as you have made one — its words and the time, never its recording and never
          anything from the diary. It goes to a different bucket from your backup, under a different passphrase, so that
          whatever reads your plans at home cannot open a single journey. Use the same passphrase for both and you have
          given it all of them; the app cannot check that for you, because it does not keep the backup passphrase in any
          form it could compare.
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
          note. Nothing else goes with it — not what you typed, not the title, not the day, not where you were. The
          request also asks them not to keep the recording, though whether they honour that is theirs to decide, not
          this app&apos;s. Clear the key and the button disappears. Your key is stored encrypted on this phone and never
          leaves it.
        </Text>

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
