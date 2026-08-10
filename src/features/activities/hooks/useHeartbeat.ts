import { useEffect, useState } from 'react';
import { AppState, type AppStateStatus } from 'react-native';

import { now as readNow } from '@/services/clock';
import { appendFixes } from '@/services/fixBuffer';
import { askPosition } from '@/services/position';

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
 * from the moment it landed. An interval would fire on a fixed grid regardless
 * of what had already been recorded.
 *
 * **Every arrival counts.** Opening the app clears the throttle, so a position
 * is recorded then and there — a cold launch and a return from the background
 * alike. The app switcher does not count: iOS reports `inactive` while it is
 * up, and treating that as an arrival would wake the GPS every time the phone
 * was flicked past.
 */
export function useHeartbeat(enabled: boolean, onRecorded: () => void): void {
  const [lastAt, setLastAt] = useState<number | null>(null);
  const [open, setOpen] = useState(() => isOpen(AppState.currentState));

  useEffect(() => {
    // The previous state, in a closure rather than in state: nothing renders
    // from it, and it exists only to tell a real reopening apart from the
    // active/inactive flicker of the app switcher.
    let wasOpen = isOpen(AppState.currentState);

    const subscription = AppState.addEventListener('change', (state) => {
      const nowOpen = isOpen(state);

      // Opening the app is itself a moment worth writing down, so the interval
      // restarts from here rather than carrying over from before. Without
      // this, coming back after two minutes records nothing — the throttle
      // that stops a glance costing a fix also stops an arrival costing one.
      //
      // Only on a genuine reopening. `inactive` is what iOS reports while the
      // app switcher is up or a call is ringing, and treating each of those as
      // an arrival would wake the GPS every time the phone was flicked past.
      if (nowOpen && !wasOpen) setLastAt(null);

      wasOpen = nowOpen;
      setOpen(nowOpen);
    });

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
        const fix = await askPosition();
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
