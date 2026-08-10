import * as Battery from 'expo-battery';

import type { PowerReading } from '@/core/power';

/**
 * The only file in the app that asks how much charge is left.
 *
 * Everything above it deals in `PowerReading` — a number and a boolean — and
 * knows nothing about `BatteryState` or subscription objects, the same boundary
 * `location.ts` draws around Core Location.
 *
 * Reads never throw. A phone that will not say how charged it is should leave
 * the app recording exactly as it was, not crash and not quietly degrade: see
 * `core/power`, where a null level is explicitly not a low level.
 */

function isCharging(state: Battery.BatteryState): boolean {
  return state === Battery.BatteryState.CHARGING || state === Battery.BatteryState.FULL;
}

export async function readPower(): Promise<PowerReading> {
  try {
    const { batteryLevel, batteryState } = await Battery.getPowerStateAsync();
    return {
      // The simulator reports -1, and the platform uses the same convention as
      // Core Location does for an unusable reading: a negative number where a
      // real one is expected. Mapped to null at the boundary so nothing above
      // has to know the convention exists.
      level: typeof batteryLevel === 'number' && batteryLevel >= 0 ? batteryLevel : null,
      charging: isCharging(batteryState),
    };
  } catch {
    return { level: null, charging: false };
  }
}

/**
 * Watch the charge, and call back whenever it moves.
 *
 * Two subscriptions rather than one: iOS reports a level change and a plug
 * event separately, and the second is the one that matters most — going on
 * charge should restore full detail immediately rather than at the next
 * one-percent tick, which on a charging phone can be minutes away.
 *
 * The callback is handed a complete reading rather than the delta, so the
 * caller never has to reassemble a state from two half-events.
 */
export function watchPower(onChange: (reading: PowerReading) => void): () => void {
  const emit = () => {
    void readPower().then(onChange);
  };

  const subscriptions = [Battery.addBatteryLevelListener(emit), Battery.addBatteryStateListener(emit)];

  return () => {
    for (const subscription of subscriptions) subscription.remove();
  };
}
