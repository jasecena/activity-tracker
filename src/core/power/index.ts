/**
 * Deciding when to spare the battery.
 *
 * A location app is the thing draining the phone, so it is also the thing that
 * should notice when the phone is nearly flat. Below a threshold it drops to
 * the coarsest tracking preset — a 100 m distance filter and Wi-Fi-class
 * positioning — which costs the shape of a route some detail and buys the rest
 * of the day.
 *
 * Two properties matter more than the threshold itself.
 *
 * **It is a lens, not a setting.** Nothing here is persisted and the preset you
 * chose is never overwritten. The effective preset is derived from your choice
 * and the current charge, the same way the timeline is derived from fixes — so
 * when the phone is charged again, the app goes back to what you asked for
 * without having to remember to put it back.
 *
 * **It has hysteresis, and that is not a detail.** Applying the drop and the
 * restore at the same percentage means a phone hovering at the threshold
 * restarts Core Location every time the reading flickers — and restarting
 * location updates is itself expensive, so a naive implementation spends more
 * battery than it saves at exactly the moment there is none to spare.
 *
 * Pure, like everything in `core`: the charge is a parameter.
 */

/** Drop to the coarse preset below this. 0.2 is 20%. */
export const SAVE_BELOW = 0.2;

/**
 * ...and only come back above this.
 *
 * Five points of gap. Wide enough that the reading has to genuinely recover
 * rather than flicker, narrow enough that a phone on charge is back to full
 * detail within a few minutes.
 */
export const RESTORE_ABOVE = 0.25;

export interface PowerReading {
  /**
   * Charge from 0 to 1, or null when the platform will not say.
   *
   * Null on a simulator and briefly at launch on a device. It means "no
   * information", which is never a reason to degrade what the app records.
   */
  readonly level: number | null;
  /** On a charger. A phone at 15% and climbing does not need saving. */
  readonly charging: boolean;
}

/**
 * Whether to force the battery-saving preset.
 *
 * `wasSaving` is the current state, and the reason this is a function of it:
 * the answer at 22% depends on which direction you arrived from. Falling, you
 * are still saving; rising, you are not yet.
 */
export function shouldSaveBattery(reading: PowerReading, wasSaving: boolean): boolean {
  // No reading is not a low reading. Degrading a day's detail because the
  // platform declined to answer would be the app inventing a reason.
  if (reading.level === null || !Number.isFinite(reading.level)) return false;

  // Charging beats the threshold. The charge is going up, and the point of
  // this is to stretch a battery that is going down.
  if (reading.charging) return false;

  if (reading.level < SAVE_BELOW) return true;
  if (reading.level >= RESTORE_ABOVE) return false;

  // Between the two: hold whatever was already decided.
  return wasSaving;
}
