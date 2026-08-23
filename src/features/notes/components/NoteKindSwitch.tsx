import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NoteKind } from '@/core/day';
import { colors, radius, spacing } from '@/theme/tokens';

interface NoteKindSwitchProps {
  readonly kind: NoteKind;
  readonly onChange: (kind: NoteKind) => void;
  /** Shown under each label, so the choice says how much is behind it. */
  readonly counts: Readonly<Record<NoteKind, number>>;
}

const OPTIONS: readonly { readonly kind: NoteKind; readonly label: string }[] = [
  { kind: 'note', label: 'Notes' },
  { kind: 'plan', label: 'Plans' },
];

/**
 * Which half of the diary is on screen — and, because of that, which half the
 * microphone writes into.
 *
 * **The segment is the mode, which is why there is no separate toggle.** The
 * first design had a switch beside the microphone saying "record a plan" and a
 * tag on the rows to tell the two apart in one mixed list. That was two controls
 * and a legend for one decision. Here the list you are looking at *is* the
 * answer: press the microphone under Plans and you have said a plan, press it
 * under Notes and you have written in the diary. Nothing to set, nothing to
 * remember to unset, and no way to be in a state the screen is not already
 * showing you.
 *
 * It also settles what the withdrawn Record button got wrong. That control asked
 * you to declare a journey before it had happened; this asks nothing before you
 * speak — you are already standing in one list or the other, and the press means
 * what the screen in front of you says it means.
 *
 * **Two, and only ever two.** Not a general segmented control: a third kind
 * would be a third argument about what a note is for, and this component would
 * be the wrong place to have it. `OPTIONS` is a literal here rather than a prop
 * for exactly that reason.
 *
 * **The count is part of the label rather than its accessibility value**, which
 * departs from `Section`'s rule and does so knowingly. A `Section` is one
 * labelled element whose children iOS collapses, so a count inside it could not
 * be its own node; these are two buttons side by side with nothing nested in
 * them, and the count is the thing that tells you the other list is not empty
 * before you go and look. So it is read out with the name.
 */
export function NoteKindSwitch({ kind, onChange, counts }: NoteKindSwitchProps) {
  return (
    <View style={styles.row} accessibilityRole="tablist">
      {OPTIONS.map((option) => {
        const selected = option.kind === kind;
        const count = counts[option.kind];
        return (
          <Pressable
            key={option.kind}
            onPress={() => onChange(option.kind)}
            accessibilityRole="tab"
            accessibilityState={{ selected }}
            accessibilityLabel={`${option.label}, ${count === 1 ? '1 entry' : `${count} entries`}`}
            style={({ pressed }) => [styles.cell, selected && styles.cellOn, pressed && styles.pressed]}
          >
            <Text style={[styles.label, selected && styles.labelOn]}>{option.label}</Text>
            <Text style={[styles.count, selected && styles.countOn]}>{count}</Text>
          </Pressable>
        );
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: 'row',
    gap: spacing.xs,
    marginHorizontal: spacing.md,
    marginBottom: spacing.sm,
    padding: spacing.xs,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
  },
  cell: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
    borderRadius: radius.sm,
  },
  cellOn: { backgroundColor: colors.surfaceRaised },
  pressed: { opacity: 0.6 },
  label: { fontSize: 15, fontWeight: '600', color: colors.textMuted },
  labelOn: { color: colors.textPrimary },
  count: {
    fontSize: 13,
    fontWeight: '500',
    color: colors.textMuted,
    fontVariant: ['tabular-nums'],
  },
  countOn: { color: colors.textSecondary },
});
