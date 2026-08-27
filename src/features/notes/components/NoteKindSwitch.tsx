import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NoteKind } from '@/core/day';
import { colors, radius, spacing } from '@/theme/tokens';

/**
 * As tall as the microphone it sits beside.
 *
 * Kept in step with `QUICK_MIC_SIZE` in `NotesScreen` by being the same
 * number, not by importing it — the screen owns how big its own button is,
 * and a tab that pulled that value in would make this component depend on the
 * one place it is used.
 */
const TAB_HEIGHT = 76;

interface NoteKindSwitchProps {
  readonly kind: NoteKind;
  readonly onChange: (kind: NoteKind) => void;
  /** Shown under each label, so the choice says how much is behind it. */
  readonly counts: Readonly<Record<NoteKind, number>>;
  /**
   * What sits between the two tabs. The microphone, in practice.
   *
   * **Passed in rather than imported, so this component still owns only the
   * choice.** The two are together because of the thumb, not because either
   * knows anything about the other: the tab decides which list the microphone
   * writes into, which was already true when they were at opposite ends of the
   * screen. Taking a child keeps that relationship one-way.
   */
  readonly children?: React.ReactNode;
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
export function NoteKindSwitch({ kind, onChange, counts, children }: NoteKindSwitchProps) {
  const [notes, plans] = OPTIONS;
  const tab = (option: (typeof OPTIONS)[number]) => {
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
  };

  return (
    <View style={styles.row} accessibilityRole="tablist">
      {tab(notes!)}
      {children}
      {tab(plans!)}
    </View>
  );
}

const styles = StyleSheet.create({
  // **A bottom bar now, and no background of its own.** It used to be a strip
  // above the list, which is where a segmented control belongs when the list is
  // the whole screen. It is down here because that is where the thumb is, and
  // the microphone it flanks floats over the list rather than sitting on a
  // ground — so a filled bar behind the tabs would put a hard edge across the
  // page that the button alone never had. The cells carry their own.
  row: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
  },
  // **Sized to the microphone rather than to its own text.** All three are one
  // row now and a short tab beside a tall button reads as a mistake; the label
  // stays small because it is a label, and the target grows because a thumb
  // does not aim. `minHeight` rather than `height`, so a longer word wraps
  // instead of being clipped.
  cell: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    gap: 2,
    minHeight: TAB_HEIGHT,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.sm,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
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
