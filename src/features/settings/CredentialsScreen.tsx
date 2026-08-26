import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, radius, spacing, typography } from '@/theme/tokens';

import type { UseSettings } from './hooks/useSettings';

interface CredentialsScreenProps {
  readonly settings: UseSettings;
  readonly onBack: () => void;
}

/**
 * Everywhere this app can be given a key, on one page.
 *
 * **Moved off the Settings screen rather than added to it.** These three
 * sections — the backup bucket, the plans bucket, transcription — were most of
 * that screen's length, and they are the part you touch once and then never
 * again. Settings is where you change how the app behaves; this is where you
 * tell it who it is allowed to talk to. Mixing the two put four secret-key
 * fields between the tracking switch and the retention choice, which is a long
 * way to scroll past something nobody edits twice.
 *
 * It sits directly above Check connections in the DATA list, and that ordering
 * is deliberate: entering a credential and testing it are the same errand, and
 * this is the page you come back from when a check goes red.
 *
 * Nothing about how the values are held has changed. Each set is drafted
 * locally and written on blur, because persisting per keystroke would seal and
 * write the store on every letter of a secret key; each passphrase is typed
 * twice, can never be changed, and is thrown away the moment scrypt has made a
 * key from it.
 */
export function CredentialsScreen({ settings, onBack }: CredentialsScreenProps) {
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

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Credentials" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
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
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
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
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs },
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
