import {
  applyManualWindows,
  DEFAULT_SEGMENT_CONFIG,
  manualSegmentId,
  segmentFixes,
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
