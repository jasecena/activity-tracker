import type { Segment } from '../segments';

const MS_PER_MINUTE = 60_000;
const MS_PER_DAY = 24 * 60 * MS_PER_MINUTE;

/**
 * `tzOffsetMinutes` throughout this module is **minutes to add to UTC to get
 * local time** — so +600 for Sydney in winter, -300 for New York.
 *
 * Note the sign. JavaScript's `Date.prototype.getTimezoneOffset()` returns the
 * opposite (minutes to add to *local* to get UTC), which is the single most
 * reliable way to get this wrong. The app converts once, in
 * `services/clock.ts`, and every function here takes the sane direction.
 */
export type TzOffsetMinutes = number;

function pad(value: number): string {
  return value < 10 ? `0${value}` : `${value}`;
}

/**
 * The local calendar day a moment falls in, as `YYYY-MM-DD`.
 *
 * A string rather than a Date, because it is used as a key: two moments in the
 * same local day must produce the same key, and string equality is the only
 * comparison that cannot be accidentally sensitive to the runtime's own zone.
 */
export function dayKeyOf(at: number, tzOffsetMinutes: TzOffsetMinutes): string {
  const local = new Date(at + tzOffsetMinutes * MS_PER_MINUTE);
  // UTC getters on a shifted instant: the shift already made it local, and
  // asking for local components again would apply the runtime's zone on top.
  return `${local.getUTCFullYear()}-${pad(local.getUTCMonth() + 1)}-${pad(local.getUTCDate())}`;
}

/** The instant local midnight began, for the day containing `at`. */
export function startOfLocalDay(at: number, tzOffsetMinutes: TzOffsetMinutes): number {
  const shifted = at + tzOffsetMinutes * MS_PER_MINUTE;
  return Math.floor(shifted / MS_PER_DAY) * MS_PER_DAY - tzOffsetMinutes * MS_PER_MINUTE;
}

export interface DayGroup {
  /** `YYYY-MM-DD` in local time. */
  readonly key: string;
  /** Local midnight that began this day. */
  readonly startedAt: number;
  readonly segments: readonly Segment[];
}

/**
 * Group a timeline into local days, newest day first.
 *
 * A segment that crosses midnight is filed under the day it **started**, whole.
 * The alternative — splitting it at the boundary — is more literally correct
 * and worse to look at: a night ride home becomes two rides, neither of which
 * is the distance you actually went, and the one at 00:00 is the top row of
 * today for no reason you would recognise.
 */
export function groupByDay(segments: readonly Segment[], tzOffsetMinutes: TzOffsetMinutes): readonly DayGroup[] {
  const byKey = new Map<string, { startedAt: number; segments: Segment[] }>();

  for (const segment of segments) {
    const key = dayKeyOf(segment.startedAt, tzOffsetMinutes);
    const existing = byKey.get(key);
    // The day's midnight is recorded when the group is created rather than
    // looked up afterwards, so there is never a group without one.
    if (existing) existing.segments.push(segment);
    else byKey.set(key, { startedAt: startOfLocalDay(segment.startedAt, tzOffsetMinutes), segments: [segment] });
  }

  return [...byKey.entries()]
    .map(([key, group]) => ({
      key,
      startedAt: group.startedAt,
      segments: [...group.segments].sort((a, b) => a.startedAt - b.startedAt),
    }))
    .sort((a, b) => b.startedAt - a.startedAt);
}
