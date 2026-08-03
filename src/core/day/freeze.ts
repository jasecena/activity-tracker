import type { Segment } from '../segments';

export interface FreezePlan {
  /** Segments no future fix can change. Safe to move into the permanent log. */
  readonly frozen: readonly Segment[];
  /**
   * The earliest instant whose fixes must be kept in the buffer.
   *
   * Everything older can be dropped, because everything older has been frozen.
   */
  readonly keepFixesFrom: number;
}

/**
 * Decide which of a derived timeline is finished, and how much of the raw fix
 * buffer still has to be kept to re-derive the rest.
 *
 * The app re-derives today from raw fixes every time it needs it, so the buffer
 * cannot grow forever and cannot be truncated carelessly either. The subtle
 * case is the segment that is *in progress* at the boundary — a drive that
 * started at 23:40 and ended at 00:20. Cutting the buffer at midnight would
 * leave the second half of it to be re-derived alone, and it would come out as
 * a twenty-minute drive from nowhere rather than the forty-minute one that
 * happened. So the cut is made at the *start* of whichever segment straddles
 * the boundary, not at the boundary.
 *
 * `segments` must be in timeline order, which is what the engine produces.
 */
export function planFreeze(segments: readonly Segment[], boundary: number): FreezePlan {
  const straddling = segments.find((segment) => segment.endedAt > boundary);
  const keepFixesFrom = straddling ? straddling.startedAt : boundary;

  return {
    frozen: segments.filter((segment) => segment.endedAt <= keepFixesFrom),
    keepFixesFrom,
  };
}

/**
 * Fold newly frozen segments into the permanent log.
 *
 * By id, and last write wins. Ids are derived from `startedAt`, so re-deriving
 * a day the app already froze produces the same ids and updates those rows
 * rather than doubling them — which is what makes it safe to fold the buffer
 * again after a crash, or twice in a row, or on every launch.
 */
export function mergeIntoLog(log: readonly Segment[], incoming: readonly Segment[]): readonly Segment[] {
  if (incoming.length === 0) return log;

  const byId = new Map<string, Segment>();
  for (const segment of log) byId.set(segment.id, segment);
  for (const segment of incoming) byId.set(segment.id, segment);

  return [...byId.values()].sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Drop everything that started before `before`.
 *
 * Retention is off by default — the diary keeps everything until told
 * otherwise — so this is only reached when a limit has been set deliberately.
 */
export function applyRetention(log: readonly Segment[], before: number): readonly Segment[] {
  return log.filter((segment) => segment.startedAt >= before);
}
