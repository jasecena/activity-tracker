import { Modal, Pressable, StyleSheet, Text } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme/tokens';

export interface MenuItem {
  readonly label: string;
  readonly onPress: () => void;
  /** Renders in red. Reserve it for things that lose data. */
  readonly destructive?: boolean;
}

interface MenuSheetProps {
  readonly visible: boolean;
  readonly title?: string;
  readonly items: readonly MenuItem[];
  readonly onClose: () => void;
}

/**
 * A sheet of actions, iOS-style.
 *
 * Hand-rolled rather than `ActionSheetIOS` for one reason: the native sheet
 * cannot be rendered in a test environment, so every menu action would be
 * unreachable from the component suite. This is a `Modal` and a list of
 * `Pressable`s, which the suite can drive.
 *
 * The backdrop is itself a button. A sheet you can only dismiss by choosing
 * something is a trap, and "tap outside to cancel" is what everyone tries first.
 */
export function MenuSheet({ visible, title, items, onClose }: MenuSheetProps) {
  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close menu">
        {/* Stops a tap on the sheet itself from closing it. */}
        <Pressable style={styles.sheet} onPress={() => {}}>
          {title ? <Text style={styles.title}>{title}</Text> : null}
          {items.map((item) => (
            <Pressable
              key={item.label}
              onPress={() => {
                onClose();
                item.onPress();
              }}
              accessibilityRole="button"
              accessibilityLabel={item.label}
              style={({ pressed }) => [styles.item, pressed && styles.pressed]}
            >
              <Text style={[styles.itemText, item.destructive && styles.destructive]}>{item.label}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [styles.item, styles.cancel, pressed && styles.pressed]}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.sm,
    paddingBottom: spacing.xl,
  },
  title: { ...typography.caption, color: colors.textMuted, padding: spacing.md, textAlign: 'center' },
  item: { paddingVertical: spacing.md, paddingHorizontal: spacing.md, borderRadius: radius.sm },
  itemText: { ...typography.body, color: colors.textPrimary, textAlign: 'center' },
  destructive: { color: colors.danger },
  cancel: { marginTop: spacing.xs, backgroundColor: colors.surfaceRaised },
  cancelText: { ...typography.body, color: colors.textSecondary, textAlign: 'center', fontWeight: '600' },
  pressed: { opacity: 0.6 },
});
