import { StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme/tokens';

interface StatTileProps {
  readonly label: string;
  readonly value: string;
  readonly accent?: string;
}

/** One number from the day's summary, with the word that says what it is. */
export function StatTile({ label, value, accent = colors.textPrimary }: StatTileProps) {
  return (
    // One label for the pair. Read separately a screen reader says "Distance"
    // and then, as an unrelated item, "4.20 km".
    <View style={styles.tile} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={[styles.value, { color: accent }]} numberOfLines={1} adjustsFontSizeToFit>
        {value}
      </Text>
      <Text style={styles.label}>{label.toUpperCase()}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  tile: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.sm,
    gap: spacing.xs,
    alignItems: 'center',
  },
  value: { ...typography.title, fontVariant: ['tabular-nums'] },
  label: { ...typography.label, fontSize: 10, color: colors.textMuted },
});
