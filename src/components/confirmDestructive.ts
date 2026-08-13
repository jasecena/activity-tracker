import { Alert } from 'react-native';

interface DestructiveConfirmation {
  /** What is about to go, as a question. "Delete this note?" */
  readonly title: string;
  /** What it costs, in one sentence. Say if it cannot be undone, because it cannot. */
  readonly message: string;
  /** The word on the red button. A verb, never "OK". */
  readonly confirmLabel: string;
  readonly onConfirm: () => void;
}

/**
 * Ask before destroying something its owner made.
 *
 * **One function rather than a habit**, because the rule is easy to state and
 * easy to forget at the one call site that matters: *anything that erases data
 * asks first.* Three places in this app deleted without asking — a note, a
 * recording on a note, and the name given to a journey — and each was written by
 * somebody who knew the rule and was thinking about something else at the time.
 *
 * The bar is **data its owner made**, not "an action that changes something".
 * Deleting a fix or a segment would not qualify: the app collected those on its
 * own and can collect them again. A sentence about a Tuesday, thirty seconds of
 * talking, and the name somebody gave a walk cannot be recovered from anything —
 * that is the same line `retentionDays` draws and the same reason
 * `normalizeDayNotes` repairs rather than drops.
 *
 * Cancel is the default so the destructive button is never the one a stray tap
 * lands on, and the confirm button is labelled with the verb rather than "OK",
 * so the dialog can be answered without re-reading the question.
 */
export function confirmDestructive({ title, message, confirmLabel, onConfirm }: DestructiveConfirmation): void {
  Alert.alert(title, message, [
    { text: 'Cancel', style: 'cancel' },
    { text: confirmLabel, style: 'destructive', onPress: onConfirm },
  ]);
}
