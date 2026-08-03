import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

export interface HeaderAction {
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  readonly onPress: () => void;
}

interface ScreenHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Omit on a tab root; supply on a page pushed above one. */
  readonly onBack?: () => void;
  readonly action?: HeaderAction;
}

/**
 * The bar at the top of every page.
 *
 * The title carries `accessibilityRole="header"`, which is what lets a screen
 * reader jump between sections — and, incidentally, what lets the tests
 * distinguish the "Today" heading from the "Today" tab label, which are
 * different things that happen to share a word.
 */
export function ScreenHeader({ title, subtitle, onBack, action }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      {onBack ? (
        <Pressable
          onPress={onBack}
          accessibilityRole="button"
          accessibilityLabel="Back"
          // Bigger than the glyph: a 24 px chevron is below the 44 pt target
          // Apple asks for, and this one is used constantly.
          hitSlop={12}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          <Ionicons name="chevron-back" size={26} color={colors.move} />
        </Pressable>
      ) : null}

      <View style={styles.titles}>
        <Text style={styles.title} accessibilityRole="header" numberOfLines={1}>
          {title}
        </Text>
        {subtitle ? (
          <Text style={styles.subtitle} numberOfLines={1}>
            {subtitle}
          </Text>
        ) : null}
      </View>

      {action ? (
        <Pressable
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={12}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          <Ionicons name={action.icon} size={22} color={colors.textSecondary} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
  },
  back: { marginLeft: -spacing.xs },
  titles: { flex: 1 },
  title: { ...typography.title, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary },
  action: { padding: spacing.xs },
  pressed: { opacity: 0.6 },
});
