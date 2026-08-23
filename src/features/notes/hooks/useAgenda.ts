import { useCallback, useEffect, useRef, useState } from 'react';

import { EMPTY_AGENDA, type Agenda } from '@/core/agenda';
import { fetchAgenda, type AgendaFailure } from '@/services/agenda';
import { now as readNow } from '@/services/clock';
import type { Settings } from '@/services/settings';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

/**
 * The agenda, kept between launches and refreshed when the app opens.
 *
 * **Cached because the machine at home sleeps.** It is a computer in somebody's
 * house, not a service: it will be off for a weekend, and a phone that showed
 * nothing whenever it could not reach the bucket would be useless precisely on
 * the days somebody is away from their desk. So the last agenda that was read is
 * kept, sealed like everything else, and shown with how old it is rather than
 * hidden.
 *
 * **This is a cache and never a source of truth**, which is what makes it safe
 * to throw away. Everything in it is derived at the other end from plans this
 * phone sent; the machine can rebuild it whenever it likes, and nothing here is
 * ever written back.
 *
 * **Refreshed on a press and on the screen appearing, never on a timer.** The
 * plan upload had to be automatic — there is no press after the recording that
 * could carry it — but a download has an obvious one: you are looking at the
 * list. A poll would be this app's second automatic request, and the first one
 * is already the exception that had to be written into Settings.
 */

export interface UseAgenda {
  readonly agenda: Agenda;
  readonly busy: boolean;
  /** Why the last attempt did not work, or null. Shown, never logged. */
  readonly trouble: AgendaFailure | null;
  /** True once a fetch has completed, so an empty list can be told from an unread one. */
  readonly loaded: boolean;
  readonly refresh: () => void;
}

export function useAgenda(settings: Settings, active: boolean): UseAgenda {
  const [agenda, setAgenda] = useState<Agenda>(EMPTY_AGENDA);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [trouble, setTrouble] = useState<AgendaFailure | null>(null);

  // One fetch at a time. Two would race the cache write and could leave an older
  // agenda on screen than the one already downloaded.
  const running = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = await readJson<Agenda>(STORAGE_KEYS.agenda);
      if (!live || !stored) return;
      setAgenda(stored);
    })();
    return () => {
      live = false;
    };
  }, []);

  const refresh = useCallback(() => {
    if (running.current) return;
    running.current = true;
    void (async () => {
      setBusy(true);
      try {
        const result = await fetchAgenda(settings);
        if (result.ok) {
          setAgenda(result.agenda);
          setTrouble(null);
          await writeJson(STORAGE_KEYS.agenda, result.agenda);
        } else {
          // **What was already read stays on screen.** A failed refresh is a
          // reason to say so, never a reason to blank a list somebody is
          // reading — and a build that cannot understand a newer agenda is
          // exactly the case where the old one is still the best answer it has.
          setTrouble(result);
        }
      } finally {
        setLoaded(true);
        setBusy(false);
        running.current = false;
      }
    })();
  }, [settings]);

  /**
   * Once, when the Plans list is first looked at in this session.
   *
   * Keyed on becoming active rather than on every activation: switching tabs
   * back and forth is not a request for a fresh answer, and the machine
   * republishes on its own schedule anyway. Pulling to refresh is the deliberate
   * way to ask again.
   */
  const asked = useRef(false);
  useEffect(() => {
    if (!active || asked.current) return;
    asked.current = true;
    refresh();
  }, [active, refresh]);

  return { agenda, busy, trouble, loaded, refresh };
}

/** How old an agenda has to be before the screen says so. */
export const STALE_AFTER_MS = 24 * 3_600_000;

/** For the line under the list. `readNow` is called by the caller, not here. */
export function agendaAge(agenda: Agenda): number {
  return agenda.generatedAt > 0 ? readNow() - agenda.generatedAt : 0;
}
