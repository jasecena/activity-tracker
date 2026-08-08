import { dayKeyOf, type TzOffsetMinutes } from '@/core/day';
import type { Fix } from '@/core/geo';

import { archiveKeyFor, archivedDayKeys, readJson, removeKeys, STORAGE_KEYS, writeJson } from './storage';

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
 * Drop everything older than `before`, keeping it for the export.
 *
 * Called when a day is frozen: the fold never needs those readings again,
 * because the day's segments are its record. They used to be deleted outright,
 * which is why exporting "all raw fixes" produced today and nothing else.
 *
 * **One key per day is written, never the whole archive.** A single blob meant
 * every freeze read a year, sorted it and wrote it back — sealed, as hex, on
 * the thread that draws the screen. See `STORAGE_KEYS.fixArchive`.
 */
export async function pruneBuffer(before: number, tzOffsetMinutes: TzOffsetMinutes): Promise<void> {
  await serialise(async () => {
    const existing = await readBuffer();
    const kept = existing.filter((fix) => fix.at >= before);
    if (kept.length === existing.length) return;

    const byDay = new Map<string, Fix[]>();
    for (const fix of existing) {
      if (fix.at >= before) continue;
      const key = dayKeyOf(fix.at, tzOffsetMinutes);
      const day = byDay.get(key);
      if (day) day.push(fix);
      else byDay.set(key, [fix]);
    }

    for (const [dayKey, leaving] of byDay) {
      // Merged with whatever that day already holds. A freeze interrupted and
      // rerun must not lose the first half — and appending twice is caught by
      // the timestamps, which are unique per reading.
      const stored = normalizeFixes(await readJson<unknown>(archiveKeyFor(dayKey)));
      const seen = new Set(stored.map((fix) => fix.at));
      const merged = [...stored, ...leaving.filter((fix) => !seen.has(fix.at))].sort((a, b) => a.at - b.at);
      await writeJson(archiveKeyFor(dayKey), merged);
    }

    await writeJson(STORAGE_KEYS.fixBuffer, kept);
  });
}

/**
 * Raw fixes for days already frozen, oldest first. Only the export reads these.
 *
 * Every day at once, which is the one operation that genuinely needs them all —
 * and it happens when somebody presses Export, never while a timeline is being
 * drawn.
 */
export async function readArchive(): Promise<Fix[]> {
  const days = await archivedDayKeys();
  const all: Fix[] = [];
  for (const dayKey of days) {
    all.push(...normalizeFixes(await readJson<unknown>(archiveKeyFor(dayKey))));
  }
  return all.sort((a, b) => a.at - b.at);
}

/** How many readings are archived, without holding them all at once. */
export async function archivedCount(): Promise<number> {
  const days = await archivedDayKeys();
  let total = 0;
  for (const dayKey of days) {
    total += normalizeFixes(await readJson<unknown>(archiveKeyFor(dayKey))).length;
  }
  return total;
}

/**
 * Every reading still on the phone, oldest first.
 *
 * Read on demand rather than held in state: this is a year of fixes at its
 * largest, wanted once when somebody presses Export and never while the
 * timeline is being drawn.
 */
export async function allFixes(): Promise<Fix[]> {
  const [archive, buffer] = await Promise.all([readArchive(), readBuffer()]);
  return [...archive, ...buffer].sort((a, b) => a.at - b.at);
}

/**
 * Drop archived readings older than the cutoff.
 *
 * Called with the same instant the day log is trimmed by, so the archive can
 * never outlive the days it belongs to — "keep 30 days" has to mean one thing.
 *
 * Whole days go by their key, which is why the key is a date: `YYYY-MM-DD`
 * compares as a string exactly as it compares as a day. Only the day the cutoff
 * lands inside is read, and only that one is rewritten.
 */
export async function trimArchive(before: number, tzOffsetMinutes: TzOffsetMinutes): Promise<void> {
  const edge = dayKeyOf(before, tzOffsetMinutes);
  const days = await archivedDayKeys();

  const doomed = days.filter((dayKey) => dayKey < edge);
  await removeKeys(doomed.map(archiveKeyFor));

  if (!days.includes(edge)) return;

  await serialise(async () => {
    const stored = normalizeFixes(await readJson<unknown>(archiveKeyFor(edge)));
    const kept = stored.filter((fix) => fix.at >= before);
    if (kept.length === stored.length) return;
    if (kept.length === 0) await removeKeys([archiveKeyFor(edge)]);
    else await writeJson(archiveKeyFor(edge), kept);
  });
}
