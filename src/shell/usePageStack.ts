import { useCallback, useMemo, useState } from 'react';

export interface PageStack<T> {
  /** Pages above the tab's root, oldest first. Empty means the root is showing. */
  readonly stack: readonly T[];
  /** The page on top, or null at the root. */
  readonly current: T | null;
  readonly push: (page: T) => void;
  readonly pop: () => void;
  readonly reset: () => void;
}

/**
 * A stack of pages within one tab.
 *
 * Still no navigation library. The app has four tabs and one level of detail
 * below two of them; a router would bring a native screen container, a
 * navigation state tree and a serialisation format, to replace an array and
 * three functions.
 *
 * What it deliberately does *not* do is unmount the tab underneath. Detail pages
 * render over the root, so returning from a day keeps the list's scroll position
 * and — the reason this matters — keeps Today's derived timeline and any running
 * recording alive no matter where you have wandered.
 */
export function usePageStack<T>(): PageStack<T> {
  const [stack, setStack] = useState<readonly T[]>([]);

  const push = useCallback((page: T) => setStack((current) => [...current, page]), []);
  const pop = useCallback((): void => setStack((current) => current.slice(0, -1)), []);
  const reset = useCallback(() => setStack([]), []);

  return useMemo(
    () => ({ stack, current: stack.length > 0 ? (stack[stack.length - 1] ?? null) : null, push, pop, reset }),
    [stack, push, pop, reset],
  );
}
