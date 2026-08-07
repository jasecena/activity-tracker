import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { now as readNow } from '@/services/clock';
import { appendFixes } from '@/services/fixBuffer';
import { currentFix } from '@/services/location';

/**
 * How often to ask where the phone is while the app is open.
 *
 * Ten minutes is short enough that an afternoon at a desk becomes a stay with
 * readings behind it, and long enough that it is nothing next to what an open
 * screen already costs.
 */
export const HEARTBEAT_MS = 10 * 60_000;

/**
 * Is the app open?
 *
 * Anything that is not `background` counts, including `undefined` — which
 * `AppState.currentState` genuinely is before the first transition on some
 * runtimes. Reading that as "not open" would leave the heartbeat dormant until
 * the app was backgrounded and reopened, which is a silent no-op for exactly
 * the session it was meant to cover.
 *
 * `inactive` counts as open too: it is the transient state during an app switch
 * or an incoming call, and dropping the beat for it would only add churn.
 */
function isOpen(state: AppStateStatus | undefined): boolean {
  return state !== 'background';
}

/**
 * Record a position every so often while the app is open, whether or not the
 * phone has moved.
 *
 * The gap this fills, found the hard way: the distance filter means a phone
 * that does not move produces **no fixes at all**. That is what makes tracking
 * cheap (§ 8), and it is also why sitting still for an afternoon could leave a
 * day with nothing in it — the reported "I pressed Record while seated and it
 * recorded nothing" was exactly this. A stay is only a stay if something
 * observed it.
 *
 * Three constraints, each of which changes the design:
 *
 * **Only while tracking is on.** Not a throttle but a rule: the switch being
 * off means the app records nowhere you go, and a heartbeat that ignored it
 * would write down your position after you asked it not to.
 *
 * **Only while the app is open.** In the background the distance filter is the
 * whole battery argument, and a timer there would undo it. `pausesUpdatesAuto`
 * is false for a related reason — see § 8.
 *
 * **Self-rescheduling rather than an interval.** Each fix schedules the next
 * from the moment it landed, so returning to the app after two minutes does not
 * take one and returning after twenty takes one immediately. An interval would
 * fire on a fixed grid and take a fix every time you glanced at the screen.
 */
export function useHeartbeat(enabled: boolean, onRecorded: () => void): void {
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [open, setOpen] = useState(() => isOpen(AppState.currentState));

  useEffect(() => {
    const subscription = AppState.addEventListener('change', (state) => setOpen(isOpen(state)));
    return () => subscription.remove();
  }, []);

  useEffect(() => {
    if (!enabled || !open) return;

    let live = true;
    // Null means nothing has been recorded this session, so the first one is
    // immediate: opening the app is itself a moment worth writing down.
    const wait = lastAt === null ? 0 : Math.max(0, HEARTBEAT_MS - (readNow() - lastAt));

    const timer = setTimeout(() => {
      void (async () => {
        const fix = await currentFix();
        if (!live) return;

        if (fix) {
          await appendFixes([fix]);
          if (!live) return;
          onRecorded();
        }

        // Stamped even when the reading failed — a denied or unavailable fix
        // must not turn into a request every render for the rest of the day.
        // Setting it reschedules this effect, which is what paces the next one.
        setLastAt(readNow());
      })();
    }, wait);

    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [enabled, open, lastAt, onRecorded]);
}
