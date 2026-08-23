import AsyncStorage from '@react-native-async-storage/async-storage';

import { monotonicNow } from './clock';
import { eraseAllMedia } from './mediaStore';
import { eraseAllNoteAudio } from './noteAudio';
import { record } from './timing';
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
  /**
   * Raw fixes for days already frozen, **one entry per day**.
   *
   * Nothing reads this to build a timeline — the fold runs over `fixBuffer`
   * alone, and a frozen day's segments are its record. It exists because
   * "export everything" meant today and nothing else: the buffer is pruned when
   * a day is frozen, and what was pruned used to be thrown away.
   *
   * **Per day, not one blob, and that is the whole design.** A single entry
   * meant every freeze read the entire archive, concatenated, sorted and wrote
   * it all back — sealed, as hex, on the thread that draws the screen. At a
   * realistic 1,500 readings a day that is 337 KB written on day one and 120 MB
   * a year later, for the sake of appending one day. It is the same shape as
   * the failure that made the media gallery unusable, and it degrades silently
   * over months rather than failing where anyone would see it.
   *
   * Freezing now writes one key: the day that just ended. Trimming deletes
   * whole keys by their date, so retention costs one read at the boundary
   * rather than a pass over everything.
   *
   * What is written is also **compacted**: nothing folds these again, so a
   * stationary run is stored as its arrival and its departure and the hundreds
   * of readings between them are gone. See `core/compact`. That is what bounds
   * the growth here at all — retention only reaches the far end, and a phone
   * sitting on a desk fills this faster than one out walking.
   */
  fixArchive: `${PREFIX}fix-archive/`,
  /**
   * What you wrote about your days. See `core/day/notes.ts`.
   *
   * **The one store here that nothing can rebuild.** Fixes come again tomorrow,
   * the timeline is a function of them, a thumbnail can be made from its
   * original — a sentence about a Tuesday cannot be recovered from anything.
   * That is why `normalizeDayNotes` repairs a row rather than dropping it
   * wherever it can, and why retention never reaches this key.
   */
  dayNotes: `${PREFIX}day-notes`,
  /** Places you have named. */
  places: `${PREFIX}places`,
  /** Names you gave journeys, as time ranges. See `core/segments/manual.ts`. */
  journeyLabels: `${PREFIX}journey-labels`,
  /**
   * Why you were at a stop, as time ranges. See `core/segments/visits.ts`.
   *
   * Its own key rather than a field on `places`, because a purpose belongs to
   * one visit and a place is the same place every time you go — the haircut on
   * Saturday would otherwise overwrite the groceries on Tuesday.
   */
  visitPurposes: `${PREFIX}visit-purposes`,
  /**
   * Stretches you said you did not move through, as time ranges.
   *
   * The same shape as the labels above and for the same reason: a range is
   * re-cut against whatever the day looks like now, so a change of tracking
   * preset cannot orphan it. See `core/segments/stationary.ts`.
   */
  stationaryClaims: `${PREFIX}stationary-claims`,
  /**
   * What has already gone to the bucket: a hash per object key.
   *
   * Not a timestamp and not a flag — a day whose notes changed has to go again,
   * and only the bytes know that. Losing this store costs one re-upload of
   * everything, never a lost day, because the bucket's own listing is consulted
   * as well.
   */
  backupLog: `${PREFIX}backup-log`,
  /**
   * What the plan sync has already done: whose recording has been asked about,
   * and what fingerprint went under each object key.
   *
   * Separate from `backupLog` because they answer to different buttons — the
   * backup is a press and this is not, so a phone that has never pressed Back up
   * still has a meaningful record here, and clearing one must not clear the
   * other.
   */
  planSync: `${PREFIX}plan-sync`,
  /**
   * The last agenda the machine at home published, as this build read it.
   *
   * **A cache, never a source of truth.** Everything in it is derived at the
   * other end from plans this phone sent, so it can be thrown away and asked for
   * again. It is kept only because that machine is a computer in a house rather
   * than a service: it will be off for a weekend, and a phone that showed
   * nothing whenever it could not reach the bucket would be useless exactly when
   * somebody is away from their desk.
   */
  agenda: `${PREFIX}agenda`,
  /**
   * The index of captured photos, video and voice notes.
   *
   * Only the index. The bytes live in `services/mediaStore.ts`, sealed under
   * the same key — a video does not fit through `JSON.stringify`.
   */
  media: `${PREFIX}media`,
  settings: `${PREFIX}settings`,
} as const;

/**
 * The archive is a family of keys rather than one, so the type has to admit a
 * day suffix. A template literal keeps that as narrow as a fixed union would
 * be: nothing outside this prefix will typecheck.
 */
export type StorageKey =
  (typeof STORAGE_KEYS)[keyof typeof STORAGE_KEYS] | `${typeof STORAGE_KEYS.fixArchive}${string}`;

/** Where one day's archived readings live. */
export function archiveKeyFor(dayKey: string): StorageKey {
  return `${STORAGE_KEYS.fixArchive}${dayKey}`;
}

/**
 * Every archived day on disk, oldest first.
 *
 * Sorted by name, which sorts by date because `dayKeyOf` writes `YYYY-MM-DD`
 * — the reason it is a string in the first place.
 */
export async function archivedDayKeys(): Promise<readonly string[]> {
  try {
    const keys = await AsyncStorage.getAllKeys();
    return keys
      .filter((key) => key.startsWith(STORAGE_KEYS.fixArchive))
      .map((key) => key.slice(STORAGE_KEYS.fixArchive.length))
      .sort();
  } catch (error) {
    console.warn('Could not list archived days', error);
    return [];
  }
}

/** Drop whole archived days. */
export async function removeKeys(keys: readonly StorageKey[]): Promise<void> {
  if (keys.length === 0) return;
  try {
    await AsyncStorage.multiRemove([...keys]);
  } catch (error) {
    console.warn('Could not remove stored values', error);
  }
}

/**
 * Keys the app used to write and no longer reads.
 *
 * Removed once on launch rather than left to rot. A retired key is not
 * harmless: `manual-windows` held the old Record button's open-ended windows,
 * which is exactly the data that produced a journey on the wrong day at a time
 * that had not arrived. Leaving it would also leave an encrypted blob nobody
 * can account for, and "erase everything" would still have to know about it.
 */
const RETIRED_KEYS: readonly string[] = [
  `${PREFIX}manual-windows`,
  // The marker for a one-off pass over impossible coordinates. The pass has
  // gone, and the marker has to be retired rather than merely deleted from
  // `STORAGE_KEYS`: a phone that ran it still holds the key, and dropping the
  // name from the enumeration would leave "erase everything" unable to name it.
  `${PREFIX}cleaned-far-positions`,
];

/** Drop what older builds wrote. Cheap, idempotent, and safe to call on every launch. */
export async function dropRetiredKeys(): Promise<void> {
  try {
    await AsyncStorage.multiRemove([...RETIRED_KEYS]);
  } catch (error) {
    console.warn('Could not remove retired storage keys', error);
  }
}

/**
 * The name a read is measured under.
 *
 * Every archived day collapses to one name. The key itself is
 * `fix-archive/2026-08-09`, and a date its owner had data on is a diary fact
 * rather than a machine one — `services/timing.ts` has the rule. Nothing is
 * lost by it: the spans stay separate, so a launch that read four archived days
 * still shows four rows, and what you actually want to know is whether archive
 * reads are the slow ones.
 */
function spanNameFor(key: StorageKey): string {
  return key.startsWith(STORAGE_KEYS.fixArchive) ? 'read archived day' : `read ${key}`;
}

/** Reads, decrypts and parses a stored value, or null if it is missing or unusable. */
export async function readJson<T>(key: StorageKey): Promise<T | null> {
  // Every launch read funnels through here, so timing this one function is a
  // per-store breakdown of the slow first tab for free.
  const began = monotonicNow();
  try {
    const envelope = await AsyncStorage.getItem(key);
    if (envelope === null) return null;

    const plaintext = await open(envelope);
    // Unreadable rather than absent: wrong key, tampered, or a format we no
    // longer speak. Identical handling, because there is nothing else to do.
    if (plaintext === null) return null;

    // The size goes over as a number: formatting it here would be a string
    // built on every read, including the ones past the cap that are discarded.
    record(spanNameFor(key), monotonicNow() - began, Math.round(envelope.length / 1024), 'kB');
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
 * **The plaintext goes first, then the key, then the rows the key protected.**
 * Ordering can only ever protect what is not already protected, and since
 * captures stopped being sealed, the files on disk are the only thing here that
 * a crash halfway through could leave readable. Destroying the key does nothing
 * to a JPEG, and nothing to the diary's recordings either — which is why both
 * directories go before it and not after.
 *
 * That reverses the rule that used to stand here — key first, so that dying
 * halfway left ciphertext — which was correct while media was sealed under the
 * same key and stopped being correct when it wasn't. Between the two calls, the
 * old order left a directory of photographs.
 *
 * Both deletions are **synchronous**, which is what makes this worth the
 * reordering rather than merely tidier: they run to completion before the first
 * `await` below, so there is no suspension point inside them and no window at
 * all where the app can be killed mid-delete. The key and the rows keep their own
 * order relative to each other, for the original reason — clearing rows first
 * and dying before the key is gone leaves a key protecting nothing.
 */
export async function eraseEverything(): Promise<void> {
  eraseAllMedia();
  eraseAllNoteAudio();

  await destroyKey();

  // Everything under the prefix, not a list of names. The archive is a key per
  // day, so an enumeration of `STORAGE_KEYS` would leave a year of them behind
  // — unreadable, since the key above is gone, but sitting in the container for
  // the life of the install and missing from every total the app can show.
  let owned: readonly string[] = [];
  try {
    owned = (await AsyncStorage.getAllKeys()).filter((key) => key.startsWith(PREFIX));
  } catch (error) {
    console.warn('Could not enumerate stored keys', error);
  }

  await AsyncStorage.multiRemove([...new Set([...owned, ...Object.values(STORAGE_KEYS), ...RETIRED_KEYS])]);
}
