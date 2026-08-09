/**
 * The screen lock, off-device.
 *
 * Both calls are spies rather than no-ops, because what is worth asserting is
 * that the lock is taken for exactly as long as a capture is in progress and
 * given back afterwards — a lock held for ever is a phone that never sleeps,
 * which is the opposite failure and a much quieter one.
 */
export const activateKeepAwakeAsync = jest.fn(async () => undefined);
export const deactivateKeepAwake = jest.fn(async () => undefined);
export const isAvailableAsync = jest.fn(async () => true);
export const useKeepAwake = jest.fn(() => undefined);

export function __reset(): void {
  activateKeepAwakeAsync.mockClear();
  deactivateKeepAwake.mockClear();
}
