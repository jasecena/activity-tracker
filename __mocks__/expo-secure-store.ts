/**
 * An in-memory keychain.
 *
 * Behaves like the real one for the length of a test file: a key written is a
 * key read back, and a key deleted is gone. That is enough to exercise the
 * vault's real cipher end to end rather than mocking the encryption itself,
 * which would leave the part most worth testing untested.
 */
const store = new Map<string, string>();

export const AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY = 'afterFirstUnlockThisDeviceOnly';
export const WHEN_UNLOCKED_THIS_DEVICE_ONLY = 'whenUnlockedThisDeviceOnly';

export async function getItemAsync(key: string): Promise<string | null> {
  return store.get(key) ?? null;
}

export async function setItemAsync(key: string, value: string): Promise<void> {
  store.set(key, value);
}

export async function deleteItemAsync(key: string): Promise<void> {
  store.delete(key);
}

/** Test-only: forget everything, so one file's key does not leak into the next. */
export function __reset(): void {
  store.clear();
}
