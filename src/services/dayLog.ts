import { applyRetention, mergeIntoLog, planFreeze, startOfLocalDay } from '@/core/day';
import type { Segment } from '@/core/segments';

import { pruneBuffer, trimArchive } from './fixBuffer';
import { readJson, STORAGE_KEYS, writeJson } from './storage';

/**
 * Finished days.
 *
 * The permanent half of the store. Anything in here is a day no future fix can
 * change, so it is written once and then only read — which is what keeps a
 * year of history cheap to load and, later, straightforward to hand to
 * something else. The shape is a plain array of `Segment`, deliberately: it is
 * already the serialisable, self-describing thing an export would want.
 */

function isSegment(candidate: unknown): candidate is Segment {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { kind, id, startedAt, endedAt } = candidate as Partial<Segment>;
  if (kind !== 'move' && kind !== 'stay') return false;
  return typeof id === 'string' && typeof startedAt === 'number' && typeof endedAt === 'number';
}

/** The trust boundary for the log. Anything unrecognisable is dropped, not repaired. */
export function normalizeLog(input: unknown): Segment[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isSegment).sort((a, b) => a.startedAt - b.startedAt);
}

export async function readLog(): Promise<Segment[]> {
  return normalizeLog(await readJson<unknown>(STORAGE_KEYS.dayLog));
}

export interface FreezeOptions {
  /** Everything derived from the current buffer, in timeline order. */
  readonly derived: readonly Segment[];
  readonly now: number;
  readonly tzOffsetMinutes: number;
  /** Null keeps everything, which is the default. */
  readonly retentionDays: number | null;
}

/**
 * Move yesterday and earlier into the permanent log, and shrink the buffer to
 * match.
 *
 * Order matters and only in one direction: the log is written **before** the
 * buffer is pruned. If the process dies between the two, the worst outcome is
 * a buffer holding fixes for days already frozen — which the next fold merges
 * back over the same ids and nothing is lost. Pruning first and dying would
 * lose the day outright.
 */
export async function freezeFinishedDays({
  derived,
  now,
  tzOffsetMinutes,
  retentionDays,
}: FreezeOptions): Promise<Segment[]> {
  const boundary = startOfLocalDay(now, tzOffsetMinutes);
  const { frozen, keepFixesFrom } = planFreeze(derived, boundary);

  const existing = await readLog();
  const merged = mergeIntoLog(existing, frozen);
  const cutoff = retentionDays === null ? null : now - retentionDays * 24 * 3_600_000;
  const kept = cutoff === null ? merged : applyRetention(merged, cutoff);

  if (kept !== existing) {
    await writeJson(STORAGE_KEYS.dayLog, kept);
  }
  await pruneBuffer(keepFixesFrom);
  // The same cutoff as the log, so "keep 30 days" means one thing rather than
  // two — an archive outliving the days it describes would be a store of
  // coordinates for a period the app claims to have forgotten.
  if (cutoff !== null) await trimArchive(cutoff);

  return [...kept];
}

/** Forget a single day. The one deletion that is not "erase everything". */
export async function forgetSegments(ids: readonly string[]): Promise<Segment[]> {
  const doomed = new Set(ids);
  const kept = (await readLog()).filter((segment) => !doomed.has(segment.id));
  await writeJson(STORAGE_KEYS.dayLog, kept);
  return kept;
}
