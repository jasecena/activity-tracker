import AsyncStorage from '@react-native-async-storage/async-storage';

import { eraseAllMedia } from './mediaStore';
import { destroyKey, open, seal } from './vault';

/**
 * The app's only persistent store, and every byte of it encrypted.
 *
 * Two rules, both of which exist because this store is a diary of where its
 * owner has been.
 *
 * **Nothing is written in plaintext.** Values go through `services/vault.ts`,
 * which seals them under a key that lives in the keychain and never leaves the
 * device. See that file for what that does and does not protect against.
 *
 * **Everything read back is untrusted input.** It was written by an older
 * build, truncated by a crash mid-write, or is ciphertext this device can no
 * longer read because it came from a restored backup. Every caller runs what it
 * gets through a `normalize*` function from `src/core` before believing a word
 * of it. Reads never throw: a store that cannot be read is indistinguishable
 * from a fresh install, and crashing on launch over a bad preferences file is a
 * far worse failure than starting empty.
 */

const PREFIX = 'activity-tracker/v1/';

export const STORAGE_KEYS = {
  /**
   * Raw fixes not yet folded into frozen days.
   *
   * The app keeps these rather than a persisted segmenter state, and re-derives
   * the timeline from them every time. Recomputing is the recovery story — see
   * the note on `core/segments/machine.ts`.
   */
  fixBuffer: `${PREFIX}fix-buffer`,
  /** Days old enough that no new fix can change them. Append-only. */
  dayLog: `${PREFIX}day-log`,
  /** Places you have named. */
  places: `${PREFIX}places`,
  /** Manual recording windows, including one that may still be running. */
  manualWindows: `${PREFIX}manual-windows`,
  /**
   * The index of captured photos, video and voice notes.
   *
   * Only the index. The bytes live in `services/mediaStore.ts`, sealed under
   * the same key — a video does not fit through `JSON.stringify`.
   */
  media: `${PREFIX}media`,
  settings: `${PREFIX}settings`,
} as const;

export type StorageKey = (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS];

/** Reads, decrypts and parses a stored value, or null if it is missing or unusable. */
export async function readJson<T>(key: StorageKey): Promise<T | null> {
  try {
    const envelope = await AsyncStorage.getItem(key);
    if (envelope === null) return null;

    const plaintext = await open(envelope);
    // Unreadable rather than absent: wrong key, tampered, or a format we no
    // longer speak. Identical handling, because there is nothing else to do.
    if (plaintext === null) return null;

    return JSON.parse(plaintext) as T;
  } catch (error) {
    console.warn(`Discarding unreadable stored value for ${key}`, error);
    return null;
  }
}

/** Serialises, encrypts and writes a value. Failures are logged and swallowed. */
export async function writeJson(key: StorageKey, value: unknown): Promise<void> {
  try {
    await AsyncStorage.setItem(key, await seal(JSON.stringify(value)));
  } catch (error) {
    console.warn(`Could not persist ${key}`, error);
  }
}

/**
 * Erase everything, irreversibly.
 *
 * Destroys the key first. If the process dies halfway through, what is left on
 * disk is ciphertext nobody can read — whereas clearing the rows first and
 * dying before the key is gone leaves a key protecting nothing. Order matters
 * here in exactly one direction.
 */
export async function eraseEverything(): Promise<void> {
  await destroyKey();
  await AsyncStorage.multiRemove(Object.values(STORAGE_KEYS));
  // Housekeeping, not protection. The sealed media became unreadable the
  // instant the key above was destroyed; this stops the bytes sitting in the
  // container for the life of the install.
  eraseAllMedia();
}
