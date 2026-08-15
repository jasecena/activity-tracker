import { StyleSheet, type ViewStyle } from 'react-native';

/**
 * The layout invariant every bottom sheet in this app has to hold, asserted the
 * one way that could actually catch it going wrong.
 *
 * Three sheets carry it — `NoteSheet`, `PlacePicker`, `JourneyLabelSheet` — and
 * all three have shipped a version that did not. The rule is:
 *
 * **A sheet is anchored to the bottom, capped in height, and scrolls.** Anchored
 * because that is what a sheet is. Capped because the keyboard takes most of the
 * screen and a sheet allowed to grow past what is left is laid out from y = 0,
 * with its title over the status bar and its lower half spilling past a
 * background that stopped at the wrong height. Scrolling because a cap without
 * one is a Save button nobody can reach.
 *
 * And it is asserted as **containment** rather than as a named style, which is
 * the lesson the sticky day bar taught at the cost of a release: React Native
 * moves styles between nodes, so a style can be real, correct, and attached one
 * level away from the thing it was meant to govern. What has to hold is that the
 * controls are *inside* the scroller and that something above it is capped —
 * both of which survive the style being moved and neither of which a snapshot of
 * `styles.sheet` would notice.
 *
 * Walked rather than queried, following `MapCanvas.test.tsx`: this version of
 * the testing library exposes no `UNSAFE_*` queries, and a scroller has no role
 * or text to find it by.
 */
export interface DrawnNode {
  readonly type?: string;
  readonly props?: Record<string, unknown>;
  readonly children?: readonly unknown[];
}

/** Root first, down to the first node of `type` — or null if there is none. */
export function pathTo(root: unknown, type: string): DrawnNode[] | null {
  const walk = (node: unknown, trail: DrawnNode[]): DrawnNode[] | null => {
    if (!node || typeof node !== 'object') return null;
    const element = node as DrawnNode;
    const here = [...trail, element];
    if (element.type === type) return here;
    for (const child of element.children ?? []) {
      const found = walk(child, here);
      if (found) return found;
    }
    return null;
  };

  return walk(root, []);
}

/** Every accessibility label in this node's subtree. */
export function labelsUnder(node: DrawnNode): string[] {
  const found: string[] = [];

  const walk = (candidate: unknown): void => {
    if (!candidate || typeof candidate !== 'object') return;
    const element = candidate as DrawnNode;
    const label = element.props?.accessibilityLabel;
    if (typeof label === 'string') found.push(label);
    for (const child of element.children ?? []) walk(child);
  };

  walk(node);
  return found;
}

/**
 * Assert the whole rule over a rendered tree.
 *
 * `mustContain` is the accessibility label of something at the far end of the
 * sheet — the last control, usually Save. Naming the *far* one is the point: it
 * is what proves the scroller wraps the sheet rather than some fragment of it.
 */
export function expectSheetIsBoundedAndScrolls(tree: unknown, mustContain: readonly string[]): void {
  const path = pathTo(tree, 'RCTScrollView');
  expect(path).not.toBeNull();

  const scroller = path![path!.length - 1]!;
  const labels = labelsUnder(scroller);
  for (const label of mustContain) expect(labels).toContain(label);

  const capped = path!
    .slice(0, -1)
    .some((node) => StyleSheet.flatten(node.props?.style as ViewStyle)?.maxHeight !== undefined);
  expect(capped).toBe(true);
}
