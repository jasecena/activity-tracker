import type { Fix } from '@/core/geo';

import { readJson, STORAGE_KEYS, writeJson } from './storage';

/**
 * The raw fix buffer: everything Core Location has handed over that has not yet
 * been frozen into a finished day.
 *
 * This is the app's source of truth. The timeline is not stored — it is
 * re-derived from these fixes whenever it is needed, which is cheap (a day is a
 * few thousand of them) and removes a whole category of bug: there is no
 * persisted machine state to migrate, no half-written segment, and a fold that
 * crashed halfway simply runs again.
 *
 * **Appends are serialised through `queue`.** The background task and the
 * foreground app share one JavaScript context but not one execution order, and
 * an append is a read-modify-write. Two of them interleaving loses whichever
 * batch read first — which, since the background task is the one that runs
 * while you are actually out walking, would mean losing exactly the fixes that
 * matter. Chaining every append onto the previous one costs nothing and makes
 * that impossible.
 */

let queue: Promise<unknown> = Promise.resolve();

/** Run `task` after every append already in flight, whatever they did. */
function serialise<T>(task: () => Promise<T>): Promise<T> {
  const next = queue.then(task, task);
  // Swallow rejections on the *chain* only, so one failed append does not
  // reject every append queued behind it. The caller still sees its own error.
  queue = next.catch(() => undefined);
  return next;
}

function isFix(candidate: unknown): candidate is Fix {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { lat, lon, at } = candidate as Partial<Fix>;
  return typeof lat === 'number' && typeof lon === 'number' && typeof at === 'number' && Number.isFinite(at);
}

/**
 * The trust boundary for the buffer.
 *
 * Sorted by time on the way out, not merely filtered. The engine's ordering
 * rule (`judgeFix` rejects anything not newer than the last accepted fix) makes
 * an out-of-order buffer lossy rather than wrong — and iOS genuinely does
 * deliver batches out of order when it wakes an app with several queued.
 */
export function normalizeFixes(input: unknown): Fix[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isFix)
    .map((fix) => ({
      lat: fix.lat,
      lon: fix.lon,
      at: fix.at,
      accuracyM: typeof fix.accuracyM === 'number' ? fix.accuracyM : Infinity,
      reportedSpeedMps: typeof fix.reportedSpeedMps === 'number' ? fix.reportedSpeedMps : null,
      altitudeM: typeof fix.altitudeM === 'number' ? fix.altitudeM : null,
    }))
    .sort((a, b) => a.at - b.at);
}

export async function readBuffer(): Promise<Fix[]> {
  return normalizeFixes(await readJson<unknown>(STORAGE_KEYS.fixBuffer));
}

/**
 * Add fixes to the buffer.
 *
 * Called from the background task, where the app may have seconds to live. It
 * does the least possible: append and return. No segmentation, no day
 * arithmetic, no pruning — all of that is the foreground's job, because all of
 * it can be redone later from these fixes and none of it can be redone if the
 * fixes were never written.
 */
export async function appendFixes(fixes: readonly Fix[]): Promise<void> {
  if (fixes.length === 0) return;
  await serialise(async () => {
    const existing = await readBuffer();
    await writeJson(STORAGE_KEYS.fixBuffer, [...existing, ...fixes]);
  });
}

/**
 * Drop fixes older than `before`, once the days they belong to are frozen.
 *
 * Only ever called from the foreground, after the segments they produced have
 * been written to the day log. Losing the race here would cost a day's detail,
 * so it goes through the same queue as the appends.
 */
export async function pruneBuffer(before: number): Promise<void> {
  await serialise(async () => {
    const existing = await readBuffer();
    const kept = existing.filter((fix) => fix.at >= before);
    if (kept.length !== existing.length) {
      await writeJson(STORAGE_KEYS.fixBuffer, kept);
    }
  });
}
