import {
  applyManualWindows,
  closeAbandonedWindows,
  DEFAULT_SEGMENT_CONFIG,
  manualSegmentId,
  segmentFixes,
  windowsForDay,
  splitSegment,
  type ManualWindow,
  type MoveSegment,
  type Segment,
} from '../index';

import { chain, leg, T0 } from './fixtures';

const MINUTE = 60_000;
const CONFIG = DEFAULT_SEGMENT_CONFIG;

function still(fromM: number, startAt: number, durationMs: number) {
  return leg({ fromM, startAt, durationMs, speedMps: 0, intervalMs: MINUTE });
}

function walk(fromM: number, startAt: number, durationMs: number) {
  return leg({ fromM, startAt, durationMs, speedMps: 1.4, intervalMs: 10_000 });
}

function totalDistance(segments: readonly Segment[]): number {
  return segments.reduce((sum, segment) => sum + (segment.kind === 'move' ? segment.distanceM : 0), 0);
}

function asMove(segment: Segment | undefined): MoveSegment {
  if (!segment || segment.kind !== 'move') throw new Error(`expected a move, got ${segment?.kind ?? 'nothing'}`);
  return segment;
}

const DAY = chain(
  still(0, T0, 10 * MINUTE),
  walk(0, T0 + 10 * MINUTE, 20 * MINUTE),
  still(1680, T0 + 30 * MINUTE, 10 * MINUTE),
);

describe('splitSegment', () => {
  const move = asMove(segmentFixes(DAY, CONFIG).segments[1]);

  it('leaves a segment alone when the cut is at or outside its bounds', () => {
    expect(splitSegment(move, move.startedAt)).toEqual([move]);
    expect(splitSegment(move, move.endedAt)).toEqual([move]);
    expect(splitSegment(move, move.startedAt - 1)).toEqual([move]);
    expect(splitSegment(move, move.endedAt + 1)).toEqual([move]);
  });

  it('cuts a move into two that meet exactly at the cut', () => {
    const at = move.startedAt + 10 * MINUTE;
    const [first, second] = splitSegment(move, at);

    expect(first?.startedAt).toBe(move.startedAt);
    expect(first?.endedAt).toBe(at);
    expect(second?.startedAt).toBe(at);
    expect(second?.endedAt).toBe(move.endedAt);
  });

  // Labelling half of a walk must not make the day's total shrink. Recomputing
  // each half from its own thinned path would do exactly that.
  it('preserves the total distance', () => {
    const halves = splitSegment(move, move.startedAt + 7 * MINUTE);
    expect(totalDistance(halves)).toBeCloseTo(move.distanceM, 6);
  });

  it('gives both halves the boundary position, so the routes join up', () => {
    const at = move.startedAt + 10 * MINUTE;
    const [first, second] = splitSegment(move, at);
    const firstPath = asMove(first).path;
    const secondPath = asMove(second).path;

    expect(firstPath[firstPath.length - 1]).toEqual(secondPath[0]);
    expect(firstPath[firstPath.length - 1]?.at).toBe(at);
  });

  it('cuts a stay in two without moving it', () => {
    const stay = segmentFixes(DAY, CONFIG).segments[0];
    if (!stay || stay.kind !== 'stay') throw new Error('expected a stay');
    const at = stay.startedAt + 5 * MINUTE;
    const [first, second] = splitSegment(stay, at);

    expect(first?.kind).toBe('stay');
    expect(second?.kind).toBe('stay');
    expect(first?.endedAt).toBe(at);
    expect(second?.startedAt).toBe(at);
  });

  it('gives the two halves different ids', () => {
    const [first, second] = splitSegment(move, move.startedAt + 5 * MINUTE);
    expect(first?.id).not.toBe(second?.id);
  });
});

describe('applyManualWindows', () => {
  const { segments } = segmentFixes(DAY, CONFIG);
  const now = T0 + 40 * MINUTE;

  function window(overrides: Partial<ManualWindow> = {}): ManualWindow {
    return {
      id: 'w1',
      label: 'Commute',
      mode: 'walk',
      startedAt: T0 + 15 * MINUTE,
      endedAt: T0 + 25 * MINUTE,
      ...overrides,
    };
  }

  it('changes nothing when there are no windows', () => {
    expect(applyManualWindows(segments, [], now)).toEqual(segments);
  });

  it('names the stretch you recorded', () => {
    const result = applyManualWindows(segments, [window()], now);
    const labelled = result.filter((segment) => segment.kind === 'move' && segment.label === 'Commute');

    expect(labelled).toHaveLength(1);
    expect(labelled[0]?.startedAt).toBe(T0 + 15 * MINUTE);
    expect(labelled[0]?.endedAt).toBe(T0 + 25 * MINUTE);
  });

  // The engine can tell a ride from a drive. It cannot know this one was the
  // commute — so when you say so, it does not argue.
  it('lets your answer overrule the classifier', () => {
    const result = applyManualWindows(segments, [window({ mode: 'cycle' })], now);
    const labelled = asMove(result.find((segment) => segment.kind === 'move' && segment.label === 'Commute'));

    expect(labelled.mode).toBe('cycle');
    expect(labelled.modeIsManual).toBe(true);
  });

  it('preserves the total distance of the day it re-cuts', () => {
    const result = applyManualWindows(segments, [window()], now);
    expect(totalDistance(result)).toBeCloseTo(totalDistance(segments), 6);
  });

  it('leaves the rest of the day untouched and in order', () => {
    const result = applyManualWindows(segments, [window()], now);
    const starts = result.map((segment) => segment.startedAt);

    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(result[0]?.startedAt).toBe(T0);
    expect(result[result.length - 1]?.endedAt).toBe(T0 + 40 * MINUTE);
  });

  // You pressed Record at the start of a walk, so the wait at the crossing is
  // part of the walk — not a place you went.
  it('swallows the stays inside a recording', () => {
    const wide = window({ startedAt: T0 + 5 * MINUTE, endedAt: T0 + 35 * MINUTE });
    const result = applyManualWindows(segments, [wide], now);
    const inside = result.filter((s) => s.startedAt >= wide.startedAt && s.endedAt <= (wide.endedAt ?? now));

    expect(inside).toHaveLength(1);
    expect(inside[0]?.kind).toBe('move');
  });

  it('closes a still-running recording at the instant it is asked about', () => {
    const open = window({ endedAt: null, startedAt: T0 + 30 * MINUTE });
    const result = applyManualWindows(segments, [open], now);
    const labelled = result.find((segment) => segment.kind === 'move' && segment.label === 'Commute');

    expect(labelled?.endedAt).toBe(now);
  });

  it('ignores a window that has not lasted any time yet', () => {
    const instant = window({ startedAt: now, endedAt: null });
    expect(applyManualWindows(segments, [instant], now)).toEqual(segments);
  });

  // Location denied, or a basement with no signal. The recording still happened
  // and still gets a row — an empty timeline after deliberately pressing Record
  // reads as the app being broken.
  it('gives a recording with no fixes behind it a row anyway', () => {
    const later = window({ id: 'w2', startedAt: T0 + 100 * MINUTE, endedAt: T0 + 110 * MINUTE });
    const result = applyManualWindows(segments, [later], T0 + 120 * MINUTE);
    const labelled = asMove(result.find((segment) => segment.kind === 'move' && segment.label === 'Commute'));

    expect(labelled.startedAt).toBe(T0 + 100 * MINUTE);
    expect(labelled.endedAt).toBe(T0 + 110 * MINUTE);
    expect(labelled.distanceM).toBe(0);
    expect(labelled.fixCount).toBe(0);
  });

  it('keeps a running recording under one id as its end moves with the clock', () => {
    const open = window({ endedAt: null, startedAt: T0 + 15 * MINUTE });
    const earlier = applyManualWindows(segments, [open], T0 + 20 * MINUTE);
    const later = applyManualWindows(segments, [open], T0 + 25 * MINUTE);

    const idOf = (list: readonly Segment[]) => list.find((segment) => segment.kind === 'move' && segment.label)?.id;
    expect(idOf(earlier)).toBe(idOf(later));
    expect(idOf(earlier)).toBe('manual-w1');
    // The same answer the UI gets without re-deriving anything, which is how a
    // recording finds its own row.
    expect(manualSegmentId(open)).toBe(idOf(earlier));
  });

  // Two recordings that overlap force the second to cut through a segment the
  // first already coalesced — a segment whose route is a handful of points, or
  // none at all. That is the one path where a cut has no shape to apportion by
  // and has to fall back to splitting by time.
  it('cuts through a segment an earlier recording already claimed', () => {
    const first = window({ id: 'a', label: 'First', startedAt: T0 + 12 * MINUTE, endedAt: T0 + 26 * MINUTE });
    const second = window({ id: 'b', label: 'Second', startedAt: T0 + 20 * MINUTE, endedAt: T0 + 32 * MINUTE });

    const result = applyManualWindows(segments, [first, second], now);

    expect(totalDistance(result)).toBeCloseTo(totalDistance(segments), 6);
    const labels = result.filter((s) => s.kind === 'move' && s.label).map((s) => (s.kind === 'move' ? s.label : null));
    expect(labels).toEqual(['First', 'Second']);
    // The first recording keeps the part the second did not take.
    const kept = asMove(result.find((s) => s.kind === 'move' && s.label === 'First'));
    expect(kept.endedAt).toBe(T0 + 20 * MINUTE);
    expect(kept.modeIsManual).toBe(true);
  });

  it('cuts a recording that caught no fixes at all, by time', () => {
    const empty = window({ id: 'a', label: 'Blind', startedAt: T0 + 100 * MINUTE, endedAt: T0 + 120 * MINUTE });
    const overlapping = window({
      id: 'b',
      label: 'Also blind',
      startedAt: T0 + 110 * MINUTE,
      endedAt: T0 + 130 * MINUTE,
    });

    const result = applyManualWindows(segments, [empty, overlapping], T0 + 140 * MINUTE);
    const blind = asMove(result.find((s) => s.kind === 'move' && s.label === 'Blind'));

    expect(blind.startedAt).toBe(T0 + 100 * MINUTE);
    expect(blind.endedAt).toBe(T0 + 110 * MINUTE);
    expect(blind.distanceM).toBe(0);
  });

  it('applies several windows in the order they happened', () => {
    const first = window({ id: 'a', label: 'Morning', startedAt: T0 + 12 * MINUTE, endedAt: T0 + 18 * MINUTE });
    const second = window({ id: 'b', label: 'Afternoon', startedAt: T0 + 22 * MINUTE, endedAt: T0 + 28 * MINUTE });

    const result = applyManualWindows(segments, [second, first], now);
    const labels = result.filter((s) => s.kind === 'move' && s.label).map((s) => (s.kind === 'move' ? s.label : null));

    expect(labels).toEqual(['Morning', 'Afternoon']);
  });
});

/**
 * Reported from a real phone: Today showed a journey at 16:37, a time that had
 * not arrived, for a recording nobody had started that day — and it appeared in
 * no export, because it had no fixes behind it.
 *
 * The cause was a Record pressed the previous day and never stopped. A running
 * window is closed at `now`, so every subsequent day grew a row spanning from
 * yesterday's clock time to this moment.
 */
describe('a recording nobody stopped', () => {
  const YESTERDAY_1637 = Date.UTC(2026, 7, 6, 16, 37, 0);
  const TODAY_1000 = Date.UTC(2026, 7, 7, 10, 0, 0);
  const MIDNIGHT = Date.UTC(2026, 7, 7, 0, 0, 0);

  const forgotten: ManualWindow = {
    id: 'w-1',
    label: 'Walk',
    mode: 'walk',
    startedAt: YESTERDAY_1637,
    endedAt: null,
  };

  it('is closed at the end of the day it started', () => {
    const [closed] = closeAbandonedWindows([forgotten], TODAY_1000, 0);
    expect(closed?.endedAt).toBe(MIDNIGHT);
  });

  // The symptom itself, asserted the way it is actually seen: today's timeline
  // is *empty*, not merely free of rows extending past midnight. An earlier
  // version of this test allowed a row ending exactly at midnight and so passed
  // while the phantom was still on screen.
  it('leaves today with no row at all', () => {
    const leaked = applyManualWindows([], [forgotten], TODAY_1000);
    expect(leaked).toHaveLength(1);
    expect(leaked[0]?.startedAt).toBe(YESTERDAY_1637);

    const tidied = closeAbandonedWindows([forgotten], TODAY_1000, 0);
    const today = applyManualWindows([], windowsForDay(tidied, TODAY_1000, 0), TODAY_1000);
    expect(today).toEqual([]);
  });

  // Forgetting to stop is not required. A recording properly stopped yesterday
  // leaked the same phantom row, because every window was applied to every day.
  it('does not leak a recording that was stopped yesterday either', () => {
    const stopped: ManualWindow = { ...forgotten, endedAt: YESTERDAY_1637 + 20 * MINUTE };
    expect(applyManualWindows([], [stopped], TODAY_1000)).toHaveLength(1);
    expect(applyManualWindows([], windowsForDay([stopped], TODAY_1000, 0), TODAY_1000)).toEqual([]);
  });

  it('leaves a recording that is genuinely still running alone', () => {
    const startedToday: ManualWindow = { ...forgotten, startedAt: Date.UTC(2026, 7, 7, 9, 0, 0) };
    expect(closeAbandonedWindows([startedToday], TODAY_1000, 0)).toEqual([startedToday]);
  });

  it('leaves a recording that was properly stopped alone', () => {
    const stopped: ManualWindow = { ...forgotten, endedAt: YESTERDAY_1637 + 600_000 };
    expect(closeAbandonedWindows([stopped], TODAY_1000, 0)).toEqual([stopped]);
  });

  // A day is a wall-clock idea, so which day a recording started on depends on
  // the offset — the same sign convention as the rest of `core/day`.
  it('decides which day it started on in local time', () => {
    const lateEvening = Date.UTC(2026, 7, 6, 23, 30, 0);
    const window: ManualWindow = { ...forgotten, startedAt: lateEvening };
    // In UTC that is the 6th, and 10:00 on the 7th is a later day: closed.
    expect(closeAbandonedWindows([window], TODAY_1000, 0)[0]?.endedAt).toBe(MIDNIGHT);
    // Ten hours east it is already the 7th, the same day as `now`: left alone.
    expect(closeAbandonedWindows([window], TODAY_1000, 600)[0]?.endedAt).toBeNull();
  });

  it('returns the very same array when there is nothing to close, so no write happens', () => {
    const untouched = [{ ...forgotten, endedAt: YESTERDAY_1637 + 60_000 }];
    expect(closeAbandonedWindows(untouched, TODAY_1000, 0)).toBe(untouched);
  });

  it('closes several forgotten recordings, each on its own day', () => {
    const older: ManualWindow = { ...forgotten, id: 'w-0', startedAt: Date.UTC(2026, 7, 4, 8, 0, 0) };
    const closed = closeAbandonedWindows([older, forgotten], TODAY_1000, 0);
    expect(closed[0]?.endedAt).toBe(Date.UTC(2026, 7, 5, 0, 0, 0));
    expect(closed[1]?.endedAt).toBe(MIDNIGHT);
  });
});

describe('windowsForDay', () => {
  const TODAY_1000 = Date.UTC(2026, 7, 7, 10, 0, 0);
  const DAY_START = Date.UTC(2026, 7, 7, 0, 0, 0);

  function window(overrides: Partial<ManualWindow>): ManualWindow {
    return { id: 'w', label: 'Walk', mode: 'walk', startedAt: DAY_START, endedAt: null, ...overrides };
  }

  // The reason Record still works when you are standing still with no signal:
  // the window is today's, so it keeps its row even with nothing behind it.
  it('keeps a recording made today, even one that caught nothing', () => {
    const today = window({ startedAt: TODAY_1000 - MINUTE, endedAt: TODAY_1000 });
    expect(windowsForDay([today], TODAY_1000, 0)).toEqual([today]);
  });

  it('keeps a recording that is still running today', () => {
    const open = window({ startedAt: TODAY_1000 - MINUTE, endedAt: null });
    expect(windowsForDay([open], TODAY_1000, 0)).toEqual([open]);
  });

  it('drops one that ended before the day began', () => {
    expect(windowsForDay([window({ endedAt: DAY_START })], TODAY_1000, 0)).toEqual([]);
    expect(windowsForDay([window({ endedAt: DAY_START - 1 })], TODAY_1000, 0)).toEqual([]);
  });

  // A night ride belongs to the day it ends on as far as labelling goes: it is
  // still in play when the timeline it overlaps is derived.
  it('keeps one that straddles midnight', () => {
    const straddling = window({ startedAt: DAY_START - 10 * MINUTE, endedAt: DAY_START + 30 * MINUTE });
    expect(windowsForDay([straddling], TODAY_1000, 0)).toEqual([straddling]);
  });

  it('decides the boundary in local time', () => {
    const lateYesterday = window({ endedAt: Date.UTC(2026, 7, 6, 23, 30, 0) });
    expect(windowsForDay([lateYesterday], TODAY_1000, 0)).toEqual([]);
    // Ten hours east, that instant is already the 7th — the same day as `now`.
    expect(windowsForDay([lateYesterday], TODAY_1000, 600)).toEqual([lateYesterday]);
  });
});
