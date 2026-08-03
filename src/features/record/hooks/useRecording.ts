import { useCallback, useEffect, useRef, useState } from 'react';

import type { ActivityMode, ManualWindow } from '@/core/segments';
import { now as readNow } from '@/services/clock';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

export interface UseRecording {
  ready: boolean;
  windows: readonly ManualWindow[];
  /** The one still running, if any. */
  active: ManualWindow | null;
  start: (label: string, mode: ActivityMode) => void;
  stop: () => void;
  discard: (id: string) => void;
}

function isWindow(candidate: unknown): candidate is ManualWindow {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { id, label, mode, startedAt, endedAt } = candidate as Partial<ManualWindow>;
  if (typeof id !== 'string' || typeof label !== 'string' || typeof mode !== 'string') return false;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return false;
  return endedAt === null || (typeof endedAt === 'number' && Number.isFinite(endedAt));
}

export function normalizeWindows(input: unknown): ManualWindow[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isWindow).sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Manual recordings.
 *
 * Pressing Record does **not** start a second location subscription — see
 * `core/segments/manual.ts` for why that matters. It writes down an instant and
 * a name. The fixes were being collected anyway, so the window is a lens over
 * them, applied when the timeline is read.
 *
 * Two consequences that are worth having:
 *
 * - Starting a recording costs nothing and cannot fail. There is no permission
 *   to check at that moment and no hardware to spin up.
 * - You can stop a recording you forgot to start. The fixes are already there;
 *   only the label was missing. (The UI does not yet let you backdate one, but
 *   the model does, and that is where it would go.)
 */
export function useRecording(): UseRecording {
  const [windows, setWindows] = useState<readonly ManualWindow[]>([]);
  const [ready, setReady] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = normalizeWindows(await readJson<unknown>(STORAGE_KEYS.manualWindows));
      if (!live) return;
      if (!touched.current) setWindows(stored);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const persist = useCallback((next: readonly ManualWindow[]) => {
    touched.current = true;
    setWindows(next);
    void writeJson(STORAGE_KEYS.manualWindows, next);
  }, []);

  const active = windows.find((window) => window.endedAt === null) ?? null;

  const start = useCallback(
    (label: string, mode: ActivityMode) => {
      const startedAt = readNow();
      const trimmed = label.trim();
      // Closing whatever was running rather than refusing: someone who presses
      // Record twice means "start this one", and leaving two windows open would
      // make `active` a coin toss.
      const closed = windows.map((window) => (window.endedAt === null ? { ...window, endedAt: startedAt } : window));
      persist([
        ...closed,
        {
          // Derived from the instant, like every other id in this app, so the
          // same recording keeps its identity across a reload.
          id: `w-${startedAt}`,
          label: trimmed.length > 0 ? trimmed : 'Recording',
          mode,
          startedAt,
          endedAt: null,
        },
      ]);
    },
    [persist, windows],
  );

  const stop = useCallback(() => {
    if (!active) return;
    const endedAt = readNow();
    persist(windows.map((window) => (window.id === active.id ? { ...window, endedAt } : window)));
  }, [active, persist, windows]);

  const discard = useCallback(
    (id: string) => persist(windows.filter((window) => window.id !== id)),
    [persist, windows],
  );

  return { ready, windows, active, start, stop, discard };
}
