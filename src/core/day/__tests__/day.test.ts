import type { MoveSegment, Segment, StaySegment } from '../../segments';
import { dayKeyOf, groupByDay, startOfLocalDay, summarizeDay } from '../index';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

/** Sydney in winter: ten hours ahead of UTC. */
const SYDNEY = 600;
/** New York in winter: five hours behind. */
const NEW_YORK = -300;

function stay(startedAt: number, endedAt: number): StaySegment {
  return {
    kind: 'stay',
    id: `seg-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 10,
    center: { lat: 0, lon: 0 },
    radiusM: 5,
  };
}

function move(startedAt: number, endedAt: number, distanceM: number, mode: MoveSegment['mode']): MoveSegment {
  return {
    kind: 'move',
    id: `seg-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 20,
    distanceM,
    mode,
    label: null,
    modeIsManual: false,
    path: [],
    topSpeedMps: 3,
  };
}

describe('dayKeyOf', () => {
  const noon = Date.UTC(2026, 0, 5, 12, 0, 0);

  it('reads UTC when the offset is zero', () => {
    expect(dayKeyOf(noon, 0)).toBe('2026-01-05');
  });

  it('pads months and days, and leaves two-digit ones alone', () => {
    expect(dayKeyOf(Date.UTC(2026, 8, 9, 12), 0)).toBe('2026-09-09');
    expect(dayKeyOf(Date.UTC(2026, 10, 15, 12), 0)).toBe('2026-11-15');
  });

  // 22:00 UTC is already tomorrow in Sydney, and still today in New York. An
  // app that gets this wrong files an evening run under the wrong date, and the
  // owner cannot find it.
  it('is a local day, not a UTC one', () => {
    const evening = Date.UTC(2026, 0, 5, 22, 0, 0);
    expect(dayKeyOf(evening, SYDNEY)).toBe('2026-01-06');
    expect(dayKeyOf(evening, 0)).toBe('2026-01-05');
    expect(dayKeyOf(evening, NEW_YORK)).toBe('2026-01-05');
  });

  it('handles the moment either side of local midnight', () => {
    const midnightSydney = Date.UTC(2026, 0, 5, 14, 0, 0);
    expect(dayKeyOf(midnightSydney - 1, SYDNEY)).toBe('2026-01-05');
    expect(dayKeyOf(midnightSydney, SYDNEY)).toBe('2026-01-06');
  });

  it('crosses a year boundary', () => {
    expect(dayKeyOf(Date.UTC(2025, 11, 31, 20, 0, 0), SYDNEY)).toBe('2026-01-01');
  });
});

describe('startOfLocalDay', () => {
  it('finds the midnight that began the day', () => {
    const noon = Date.UTC(2026, 0, 5, 12, 0, 0);
    expect(startOfLocalDay(noon, 0)).toBe(Date.UTC(2026, 0, 5, 0, 0, 0));
  });

  it("finds it in the caller's zone, not the runtime's", () => {
    // 12:00 UTC on the 5th is 22:00 on the 5th in Sydney; its midnight was
    // 14:00 UTC on the 4th.
    const noon = Date.UTC(2026, 0, 5, 12, 0, 0);
    expect(startOfLocalDay(noon, SYDNEY)).toBe(Date.UTC(2026, 0, 4, 14, 0, 0));
  });

  it('is idempotent', () => {
    const noon = Date.UTC(2026, 0, 5, 12, 0, 0);
    const midnight = startOfLocalDay(noon, NEW_YORK);
    expect(startOfLocalDay(midnight, NEW_YORK)).toBe(midnight);
  });

  it('agrees with dayKeyOf', () => {
    const noon = Date.UTC(2026, 0, 5, 12, 0, 0);
    for (const offset of [0, SYDNEY, NEW_YORK, 330]) {
      expect(dayKeyOf(startOfLocalDay(noon, offset), offset)).toBe(dayKeyOf(noon, offset));
    }
  });
});

describe('groupByDay', () => {
  const day1 = Date.UTC(2026, 0, 5, 9, 0, 0);
  const day2 = Date.UTC(2026, 0, 6, 9, 0, 0);

  it('returns nothing for nothing', () => {
    expect(groupByDay([], 0)).toEqual([]);
  });

  it('puts the newest day first', () => {
    const groups = groupByDay([stay(day1, day1 + HOUR), stay(day2, day2 + HOUR)], 0);
    expect(groups.map((group) => group.key)).toEqual(['2026-01-06', '2026-01-05']);
  });

  it('sorts the segments within a day oldest first', () => {
    const groups = groupByDay([stay(day1 + HOUR, day1 + 2 * HOUR), stay(day1, day1 + HOUR)], 0);
    expect(groups[0]?.segments.map((segment) => segment.startedAt)).toEqual([day1, day1 + HOUR]);
  });

  it('reports the local midnight each day began at', () => {
    const groups = groupByDay([stay(day1, day1 + HOUR)], 0);
    expect(groups[0]?.startedAt).toBe(Date.UTC(2026, 0, 5, 0, 0, 0));
  });

  // Splitting it at midnight would be more literally correct and much worse to
  // look at: a night ride home becomes two rides, neither of them the distance
  // you actually went.
  it('files a segment that crosses midnight under the day it started', () => {
    const lateNight = Date.UTC(2026, 0, 5, 23, 40, 0);
    const groups = groupByDay([move(lateNight, lateNight + 40 * MINUTE, 8_000, 'cycle')], 0);

    expect(groups).toHaveLength(1);
    expect(groups[0]?.key).toBe('2026-01-05');
  });
});

describe('summarizeDay', () => {
  const start = Date.UTC(2026, 0, 5, 8, 0, 0);

  it('is all zeroes for an empty day', () => {
    const summary = summarizeDay([]);
    expect(summary).toMatchObject({ distanceM: 0, movingMs: 0, stillMs: 0, spanMs: 0, moveCount: 0, stayCount: 0 });
    expect(summary.byMode.walk).toEqual({ distanceM: 0, durationMs: 0, count: 0 });
  });

  it('adds up distance, time and counts by mode', () => {
    const summary = summarizeDay([
      stay(start, start + HOUR),
      move(start + HOUR, start + HOUR + 20 * MINUTE, 1_600, 'walk'),
      stay(start + HOUR + 20 * MINUTE, start + 2 * HOUR),
      move(start + 2 * HOUR, start + 2 * HOUR + 30 * MINUTE, 12_000, 'cycle'),
      move(start + 3 * HOUR, start + 3 * HOUR + 15 * MINUTE, 1_400, 'walk'),
    ]);

    expect(summary.distanceM).toBe(15_000);
    expect(summary.moveCount).toBe(3);
    expect(summary.stayCount).toBe(2);
    expect(summary.byMode.walk).toEqual({ distanceM: 3_000, durationMs: 35 * MINUTE, count: 2 });
    expect(summary.byMode.cycle).toEqual({ distanceM: 12_000, durationMs: 30 * MINUTE, count: 1 });
    expect(summary.byMode.drive).toEqual({ distanceM: 0, durationMs: 0, count: 0 });
  });

  // The hours the phone recorded nothing — asleep, in a drawer, battery flat —
  // must not be counted as time spent standing still. That is arithmetic that
  // is technically correct and a lie.
  it('measures the span it saw, not the twenty-four hours it did not', () => {
    const segments: Segment[] = [stay(start, start + HOUR), stay(start + 6 * HOUR, start + 7 * HOUR)];
    const summary = summarizeDay(segments);

    expect(summary.stillMs).toBe(2 * HOUR);
    expect(summary.spanMs).toBe(7 * HOUR);
    expect(summary.movingMs + summary.stillMs).toBeLessThan(summary.spanMs);
  });

  it('accounts for every millisecond of a contiguous timeline', () => {
    const segments: Segment[] = [
      stay(start, start + HOUR),
      move(start + HOUR, start + 2 * HOUR, 5_000, 'walk'),
      stay(start + 2 * HOUR, start + 3 * HOUR),
    ];
    const summary = summarizeDay(segments);
    expect(summary.movingMs + summary.stillMs).toBe(summary.spanMs);
  });
});
