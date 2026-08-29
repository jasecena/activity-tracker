import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, spacing, typography } from '@/theme/tokens';

export interface HeaderAction {
  /** Announced to a screen reader, and the tooltip a sighted user never sees. */
  readonly label: string;
  readonly icon: keyof typeof Ionicons.glyphMap;
  /**
   * Shown instead of the icon.
   *
   * For the handful of actions where a glyph is a guess — "Today" next to a
   * calendar is two calendars — a short word says it outright.
   */
  readonly text?: string;
  readonly onPress: () => void;
}

interface ScreenHeaderProps {
  readonly title: string;
  readonly subtitle?: string;
  /** Omit on a tab root; supply on a page pushed above one. */
  readonly onBack?: () => void;
  /** Rendered right-aligned in the order given. Usually one; the day view has two. */
  readonly actions?: readonly HeaderAction[];
  /**
   * One action on the left, where a back button would be.
   *
   * **For a tab root, which has no back.** Settings is reached from the Notes
   * tab now rather than a tab of its own, and the top left is where a phone
   * puts the thing that is *not* about the page you are on — the same slot,
   * because a page has only one of the two.
   */
  readonly leading?: HeaderAction;
}

/**
 * The bar at the top of every page.
 *
 * The title carries `accessibilityRole="header"`, which is what lets a screen
 * reader jump between sections — and, incidentally, what lets the tests
 * distinguish the "Today" heading from the "Today" tab label, which are
 * different things that happen to share a word.
 */
export function ScreenHeader({ title, subtitle, onBack, actions = [], leading }: ScreenHeaderProps) {
  return (
    <View style={styles.header}>
      {leading && !onBack ? (
        <Pressable
          onPress={leading.onPress}
          accessibilityRole="button"
          accessibilityLabel={leading.label}
          hitSlop={12}
          style={({ pressed }) => [styles.back, pressed && styles.pressed]}
        >
          {leading.icon ? <Ionicons name={leading.icon} size={22} color={colors.move} /> : null}
        </Pressable>
      ) : null}

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

      {actions.map((action) => (
        <Pressable
          key={action.label}
          onPress={action.onPress}
          accessibilityRole="button"
          accessibilityLabel={action.label}
          hitSlop={12}
          style={({ pressed }) => [styles.action, pressed && styles.pressed]}
        >
          {action.text ? (
            <Text style={styles.actionText}>{action.text}</Text>
          ) : (
            <Ionicons name={action.icon} size={22} color={colors.textSecondary} />
          )}
        </Pressable>
      ))}
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
  actionText: { ...typography.body, fontWeight: '600', color: colors.move },
  pressed: { opacity: 0.6 },
});
