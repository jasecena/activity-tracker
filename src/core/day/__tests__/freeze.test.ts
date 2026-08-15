import type { MoveSegment, Segment, StaySegment } from '../../segments';
import { applyRetention, mergeIntoLog, planFreeze } from '../index';

const HOUR = 3_600_000;
const MIDNIGHT = Date.UTC(2026, 0, 6, 0, 0, 0);

function stay(startedAt: number, endedAt: number): StaySegment {
  return {
    kind: 'stay',
    id: `seg-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 30,
    center: { lat: 0, lon: 0 },
    radiusM: 6,
    purpose: null,
  };
}

function move(startedAt: number, endedAt: number, distanceM = 8_000): MoveSegment {
  return {
    kind: 'move',
    id: `seg-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 60,
    distanceM,
    mode: 'drive',
    label: null,
    modeIsManual: false,
    path: [],
    topSpeedMps: 20,
  };
}

describe('planFreeze', () => {
  it('freezes nothing and keeps everything when the day is empty', () => {
    expect(planFreeze([], MIDNIGHT)).toEqual({ frozen: [], keepFixesFrom: MIDNIGHT });
  });

  it('freezes a day that finished before the boundary', () => {
    const yesterday = [stay(MIDNIGHT - 6 * HOUR, MIDNIGHT - 4 * HOUR), move(MIDNIGHT - 4 * HOUR, MIDNIGHT - 3 * HOUR)];
    const plan = planFreeze(yesterday, MIDNIGHT);

    expect(plan.frozen).toEqual(yesterday);
    expect(plan.keepFixesFrom).toBe(MIDNIGHT);
  });

  it('keeps a segment that is still running at the boundary', () => {
    const inProgress = stay(MIDNIGHT - HOUR, MIDNIGHT + HOUR);
    const plan = planFreeze([stay(MIDNIGHT - 5 * HOUR, MIDNIGHT - HOUR), inProgress], MIDNIGHT);

    expect(plan.frozen.map((segment) => segment.id)).toEqual([`seg-${MIDNIGHT - 5 * HOUR}`]);
    expect(plan.keepFixesFrom).toBe(MIDNIGHT - HOUR);
  });

  // The case the whole function exists for. Cutting the buffer at midnight
  // would leave the second half of a night drive to be re-derived alone, and it
  // would come out as a twenty-minute drive from nowhere rather than the
  // forty-minute one that happened.
  it('cuts at the start of a segment that straddles midnight, not at midnight', () => {
    const nightDrive = move(MIDNIGHT - 20 * 60_000, MIDNIGHT + 20 * 60_000);
    const plan = planFreeze([stay(MIDNIGHT - 3 * HOUR, MIDNIGHT - 20 * 60_000), nightDrive], MIDNIGHT);

    expect(plan.keepFixesFrom).toBe(nightDrive.startedAt);
    expect(plan.frozen).not.toContainEqual(nightDrive);
  });

  it('freezes nothing when the only segment is still running', () => {
    const plan = planFreeze([stay(MIDNIGHT - HOUR, MIDNIGHT + 2 * HOUR)], MIDNIGHT);
    expect(plan.frozen).toEqual([]);
    expect(plan.keepFixesFrom).toBe(MIDNIGHT - HOUR);
  });
});

describe('mergeIntoLog', () => {
  it('leaves the log alone when there is nothing to add', () => {
    const log = [stay(MIDNIGHT, MIDNIGHT + HOUR)];
    expect(mergeIntoLog(log, [])).toBe(log);
  });

  it('adds new segments in timeline order', () => {
    const older = stay(MIDNIGHT, MIDNIGHT + HOUR);
    const newer = move(MIDNIGHT + 2 * HOUR, MIDNIGHT + 3 * HOUR);
    expect(mergeIntoLog([newer], [older])).toEqual([older, newer]);
  });

  // Ids are derived from `startedAt`, so re-deriving a day the app already
  // froze produces the same ids. That is what makes folding the buffer twice —
  // after a crash, or just on every launch — safe rather than duplicating.
  it('updates a row rather than doubling it when the same segment is re-derived', () => {
    const first = move(MIDNIGHT, MIDNIGHT + HOUR, 5_000);
    const refined = move(MIDNIGHT, MIDNIGHT + HOUR, 5_400);

    const merged = mergeIntoLog([first], [refined]);
    expect(merged).toHaveLength(1);
    expect(merged[0]).toEqual(refined);
  });
});

describe('applyRetention', () => {
  it('drops what started before the cutoff and keeps the rest', () => {
    const old = stay(MIDNIGHT - 400 * 24 * HOUR, MIDNIGHT - 400 * 24 * HOUR + HOUR);
    const recent = stay(MIDNIGHT, MIDNIGHT + HOUR);

    expect(applyRetention([old, recent], MIDNIGHT - 24 * HOUR)).toEqual([recent]);
  });

  it('keeps a segment that starts exactly on the cutoff', () => {
    const edge: Segment = stay(MIDNIGHT, MIDNIGHT + HOUR);
    expect(applyRetention([edge], MIDNIGHT)).toEqual([edge]);
  });
});
