import { Ionicons } from '@expo/vector-icons';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { ScreenHeader } from '@/components/ScreenHeader';
import type { CheckResult, CheckStatus } from '@/services/diagnostics';
import type { Settings } from '@/services/settings';
import { colors, radius, spacing, typography } from '@/theme/tokens';

import { useDiagnostics } from './hooks/useDiagnostics';

interface DiagnosticsScreenProps {
  readonly settings: Settings;
  readonly onBack: () => void;
}

/**
 * Whether each thing that talks to the internet actually works.
 *
 * **The screen the app was missing.** Two of the three integrations had a press
 * behind them and reported their own failures; the third — plans — runs on its
 * own, so a broken one had nowhere to say so and every cause looked like the
 * same silent queue. `services/diagnostics` carries the reasoning for what each
 * check sends and why.
 *
 * Nothing runs on opening it. A screen that fired four network requests because
 * somebody tapped into it would be the same rule-break the checks themselves are
 * careful to avoid — every request this app makes is one a person asked for, and
 * this screen is not an exception to that just because its subject is requests.
 */
export function DiagnosticsScreen({ settings, onBack }: DiagnosticsScreenProps) {
  const diagnostics = useDiagnostics(settings);

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Check connections" onBack={onBack} />
      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.blurb}>
          Asks each service whether it is working and prints what it said. Nothing here sends a recording, a journey or
          a diary entry — the plans check writes the same salt file an ordinary send writes first, and nothing else
          leaves.
        </Text>

        <Pressable
          onPress={diagnostics.run}
          accessibilityRole="button"
          accessibilityLabel="Run the checks"
          disabled={diagnostics.running !== null}
          style={({ pressed }) => [
            styles.action,
            pressed && styles.pressed,
            diagnostics.running !== null && styles.actionOff,
          ]}
        >
          <Text style={styles.actionText}>{diagnostics.running === null ? 'Run the checks' : 'Checking…'}</Text>
        </Pressable>

        {diagnostics.results.map((result) => (
          <CheckRow key={result.id} result={result} />
        ))}

        {diagnostics.running !== null ? (
          <View style={styles.card}>
            <View style={styles.rowTop}>
              <ActivityIndicator color={colors.textSecondary} />
              <Text style={styles.rowTitle}>{diagnostics.running}</Text>
            </View>
          </View>
        ) : null}

        {diagnostics.ran ? (
          <Text style={styles.footnote}>
            These results are held on this screen only. Nothing is saved and nothing is written to a log — they name
            buckets and quote services, and device logs leave the phone.
          </Text>
        ) : null}
      </ScrollView>
    </View>
  );
}

const ICONS: Readonly<Record<CheckStatus, keyof typeof Ionicons.glyphMap>> = {
  ok: 'checkmark-circle',
  off: 'remove-circle-outline',
  failed: 'alert-circle',
};

/** Green, grey, red — and grey genuinely means "not switched on", never "unknown". */
const STATUS_COLORS: Readonly<Record<CheckStatus, string>> = {
  ok: colors.success,
  off: colors.textMuted,
  failed: colors.danger,
};

function CheckRow({ result }: { readonly result: CheckResult }) {
  return (
    <View style={styles.card}>
      <View style={styles.rowTop}>
        <Ionicons name={ICONS[result.status]} size={20} color={STATUS_COLORS[result.status]} />
        <Text style={styles.rowTitle}>{result.title}</Text>
      </View>
      <Text style={styles.rowDetail}>{result.summary}</Text>
      {/* The service's own words, shown rather than summarised. This is the
          line that turns "it did not work" into something to go and change, and
          it is why the transcription button prints one too. */}
      {result.detail ? <Text style={styles.said}>{result.detail}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, gap: spacing.sm, paddingBottom: spacing.xxl },
  blurb: { ...typography.caption, color: colors.textSecondary, paddingVertical: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  rowTop: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  rowTitle: { ...typography.body, color: colors.textPrimary, flex: 1 },
  rowDetail: { ...typography.caption, color: colors.textSecondary },
  said: {
    ...typography.caption,
    color: colors.textMuted,
    fontFamily: 'Menlo',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.xs,
  },
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs, marginTop: spacing.sm },
  action: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingVertical: spacing.md,
    alignItems: 'center',
  },
  actionOff: { opacity: 0.4 },
  actionText: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  pressed: { opacity: 0.6 },
});
