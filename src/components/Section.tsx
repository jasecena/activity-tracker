import { Ionicons } from '@expo/vector-icons';
import { useState, type ReactNode } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { colors, radius, spacing, typography } from '@/theme/tokens';

interface SectionProps {
  readonly label: string;
  /**
   * How many things are inside, shown in the heading.
   *
   * The whole cost of collapsing by default is not knowing whether there is
   * anything in there, and a number in the heading is what buys that back for
   * nothing — "NOTES · 3" is as much as opening it would have told you at a
   * glance.
   */
  readonly count: number;
  /** Drawn in the heading, on the right. Does not toggle the section. */
  readonly action?: ReactNode;
  readonly children: ReactNode;
}

/**
 * A heading that opens.
 *
 * The Day screen holds four things that are each worth a whole screen — the
 * map, the player, the diary and the timeline — and printing all of them
 * expanded made the page a scroll where the thing you came for was somewhere in
 * the middle. Collapsed by default turns it back into a page you can see at
 * once, and the count in each heading means collapsing hides the contents
 * without hiding their existence.
 *
 * Local state, deliberately not remembered between visits. A section that
 * reopens because it was open on a different day three days ago is a page whose
 * shape depends on history nobody can see; opening one is cheap and the default
 * is the same every time.
 */
export function Section({ label, count, action, children }: SectionProps) {
  const [open, setOpen] = useState(false);

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Pressable
          onPress={() => setOpen(!open)}
          accessibilityRole="button"
          accessibilityState={{ expanded: open }}
          // **Label is the name alone; the count is the accessibility *value*.**
          // iOS collapses the children of a labelled element, so the number
          // cannot be its own node — but folding it into the label would make
          // the only handle on this control change every time the contents do,
          // and the Maestro flow matches labels whole-string. VoiceOver reads
          // the value after the label, so nothing is lost by the split.
          accessibilityLabel={label}
          accessibilityValue={{ text: `${count} ${count === 1 ? 'item' : 'items'}` }}
          style={({ pressed }) => [styles.toggle, pressed && styles.pressed]}
        >
          <Ionicons name={open ? 'chevron-down' : 'chevron-forward'} size={14} color={colors.textMuted} />
          <Text style={styles.label}>{label}</Text>
          <Text style={styles.count}>{count}</Text>
        </Pressable>

        {/* Outside the toggle, so pressing it does not also open the section —
            one tap doing two things is a tap whose outcome the platform picks. */}
        {action}
      </View>

      {open ? children : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: { marginTop: spacing.md },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  toggle: { flexDirection: 'row', alignItems: 'center', gap: spacing.xs, flex: 1, paddingVertical: spacing.xs },
  label: { ...typography.label, fontSize: 11, color: colors.textMuted },
  count: {
    ...typography.caption,
    fontSize: 11,
    color: colors.textMuted,
    backgroundColor: colors.surface,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.xs,
    overflow: 'hidden',
  },
  pressed: { opacity: 0.6 },
});
