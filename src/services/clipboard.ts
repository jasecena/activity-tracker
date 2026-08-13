import * as Clipboard from 'expo-clipboard';

/**
 * The pasteboard.
 *
 * A service rather than a direct import, per the rule that native modules live
 * behind `src/services` — a one-line wrapper, but the point of the boundary is
 * that there is a single place to look for what this app can reach, not that
 * the file is long.
 *
 * **It only ever writes.** There is no read here and there should not be one:
 * reading the pasteboard raises a system prompt on iOS and hands an app whatever
 * its owner last copied from somewhere else, which is a thing a diary has no
 * business seeing. Copying out is the whole feature.
 *
 * Nothing is logged. What goes on the pasteboard is a note — the content this
 * app spends its whole design not printing anywhere.
 */
export async function copyText(text: string): Promise<boolean> {
  try {
    await Clipboard.setStringAsync(text);
    return true;
  } catch {
    // Not expected on iOS, where the pasteboard is always available — but a
    // silent failure would leave somebody pasting whatever was there before and
    // wondering why it is the wrong thing.
    console.warn('Could not copy to the pasteboard');
    return false;
  }
}
