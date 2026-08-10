/**
 * The battery, off-device.
 *
 * Defaults to a comfortably charged phone that is not plugged in, which is the
 * state where the app behaves normally — a test that wants the low-battery path
 * calls `__setPower`.
 *
 * The listeners are real: `__setPower` fires them, so a test can prove the app
 * reacts to a charge that moves rather than only to the one it read at launch.
 */
export enum BatteryState {
  UNKNOWN = 0,
  UNPLUGGED = 1,
  CHARGING = 2,
  FULL = 3,
}

type Listener = (event: unknown) => void;

let level = 0.8;
let state: BatteryState = BatteryState.UNPLUGGED;

const levelListeners = new Set<Listener>();
const stateListeners = new Set<Listener>();

export const getPowerStateAsync = jest.fn(async () => ({
  batteryLevel: level,
  batteryState: state,
  lowPowerMode: false,
}));

export const getBatteryLevelAsync = jest.fn(async () => level);
export const getBatteryStateAsync = jest.fn(async () => state);
export const isLowPowerModeEnabledAsync = jest.fn(async () => false);

export const addBatteryLevelListener = jest.fn((listener: Listener) => {
  levelListeners.add(listener);
  return { remove: () => levelListeners.delete(listener) };
});

export const addBatteryStateListener = jest.fn((listener: Listener) => {
  stateListeners.add(listener);
  return { remove: () => stateListeners.delete(listener) };
});

export const addLowPowerModeListener = jest.fn(() => ({ remove: () => undefined }));

/** Test-only: move the charge and notify whoever is listening. */
export function __setPower(next: { level?: number; state?: BatteryState }): void {
  if (next.level !== undefined) {
    level = next.level;
    for (const listener of levelListeners) listener({ batteryLevel: level });
  }
  if (next.state !== undefined) {
    state = next.state;
    for (const listener of stateListeners) listener({ batteryState: state });
  }
}

export function __reset(): void {
  level = 0.8;
  state = BatteryState.UNPLUGGED;
  levelListeners.clear();
  stateListeners.clear();
}
