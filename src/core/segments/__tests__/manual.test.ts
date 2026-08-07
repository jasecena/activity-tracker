import {
  applyJourneyLabels,
  DEFAULT_SEGMENT_CONFIG,
  journeyLabelId,
  labelledSegmentId,
  segmentFixes,
  splitSegment,
  type JourneyLabel,
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

describe('applyJourneyLabels', () => {
  const { segments } = segmentFixes(DAY, CONFIG);
  const now = T0 + 40 * MINUTE;

  function named(overrides: Partial<JourneyLabel> = {}): JourneyLabel {
    return {
      id: 'j1',
      label: 'Commute',
      mode: 'walk',
      startedAt: T0 + 15 * MINUTE,
      endedAt: T0 + 25 * MINUTE,
      ...overrides,
    };
  }

  it('changes nothing when there are no windows', () => {
    expect(applyJourneyLabels(segments, [])).toEqual(segments);
  });

  it('names the stretch you recorded', () => {
    const result = applyJourneyLabels(segments, [named()]);
    const labelled = result.filter((segment) => segment.kind === 'move' && segment.label === 'Commute');

    expect(labelled).toHaveLength(1);
    expect(labelled[0]?.startedAt).toBe(T0 + 15 * MINUTE);
    expect(labelled[0]?.endedAt).toBe(T0 + 25 * MINUTE);
  });

  // The engine can tell a ride from a drive. It cannot know this one was the
  // commute — so when you say so, it does not argue.
  it('lets your answer overrule the classifier', () => {
    const result = applyJourneyLabels(segments, [named({ mode: 'cycle' })]);
    const labelled = asMove(result.find((segment) => segment.kind === 'move' && segment.label === 'Commute'));

    expect(labelled.mode).toBe('cycle');
    expect(labelled.modeIsManual).toBe(true);
  });

  it('preserves the total distance of the day it re-cuts', () => {
    const result = applyJourneyLabels(segments, [named()]);
    expect(totalDistance(result)).toBeCloseTo(totalDistance(segments), 6);
  });

  it('leaves the rest of the day untouched and in order', () => {
    const result = applyJourneyLabels(segments, [named()]);
    const starts = result.map((segment) => segment.startedAt);

    expect([...starts].sort((a, b) => a - b)).toEqual(starts);
    expect(result[0]?.startedAt).toBe(T0);
    expect(result[result.length - 1]?.endedAt).toBe(T0 + 40 * MINUTE);
  });

  // You pressed Record at the start of a walk, so the wait at the crossing is
  // part of the walk — not a place you went.
  it('swallows the stays inside a recording', () => {
    const wide = named({ startedAt: T0 + 5 * MINUTE, endedAt: T0 + 35 * MINUTE });
    const result = applyJourneyLabels(segments, [wide]);
    const inside = result.filter((s) => s.startedAt >= wide.startedAt && s.endedAt <= wide.endedAt);

    expect(inside).toHaveLength(1);
    expect(inside[0]?.kind).toBe('move');
  });

  it('ignores a label that covers no time at all', () => {
    expect(applyJourneyLabels(segments, [named({ startedAt: now, endedAt: now })])).toEqual(segments);
  });

  // The reported bug, stated as the rule that replaces it. The old version
  // invented a row from the label's own bounds whenever it found nothing
  // inside, so a name from one day printed a hollow row on every day after it.
  it('emits nothing for a label whose journey is gone', () => {
    const elsewhere = named({ startedAt: T0 + 500 * MINUTE, endedAt: T0 + 520 * MINUTE });
    expect(applyJourneyLabels(segments, [elsewhere])).toEqual(segments);
  });

  it('emits nothing when there is no timeline to label', () => {
    expect(applyJourneyLabels([], [named()])).toEqual([]);
  });

  it('gives the row it produces an id derived from the label', () => {
    const label = named();
    const result = applyJourneyLabels(segments, [label]);
    const row = result.find((segment) => segment.kind === 'move' && segment.label === 'Commute');
    expect(row?.id).toBe(labelledSegmentId(label));
  });

  // Naming the same journey twice must update one label, not accumulate two.
  it('derives a label id from the instant it starts', () => {
    expect(journeyLabelId(T0)).toBe(journeyLabelId(T0));
    expect(journeyLabelId(T0)).not.toBe(journeyLabelId(T0 + 1));
  });

  // No clock anywhere in the module: the same label over the same day gives the
  // same answer whenever it is asked, which is what lets a frozen day and a
  // live one go through the identical code path.
  it('does not depend on what time it is', () => {
    const label = named();
    expect(applyJourneyLabels(segments, [label])).toEqual(applyJourneyLabels(segments, [label]));
  });

  // A label over a stretch of stops coalesces into a row whose "route" is a
  // handful of points in one spot — no length to apportion by. Cutting that
  // with a second label is the one path where the split falls back to
  // splitting by time, and it is reachable without any Record button.
  it('cuts a labelled stretch that has no shape to apportion, by time', () => {
    const stops = named({ id: 'a', label: 'At the desk', startedAt: T0, endedAt: T0 + 10 * MINUTE });
    const inner = named({ id: 'b', label: 'Coffee', startedAt: T0 + 3 * MINUTE, endedAt: T0 + 6 * MINUTE });

    const result = applyJourneyLabels(segments, [stops, inner]);
    const coffee = asMove(result.find((s) => s.kind === 'move' && s.label === 'Coffee'));

    expect(coffee.startedAt).toBe(T0 + 3 * MINUTE);
    expect(coffee.endedAt).toBe(T0 + 6 * MINUTE);
    expect(totalDistance(result)).toBeCloseTo(totalDistance(segments), 6);
  });

  // Your answer must survive being cut. Re-classifying a half by speed would
  // let a split quietly overturn the mode you chose.
  it('keeps your mode on both halves when a labelled stretch is cut', () => {
    const ride = named({
      id: 'a',
      label: 'Ride',
      mode: 'cycle',
      startedAt: T0 + 12 * MINUTE,
      endedAt: T0 + 30 * MINUTE,
    });
    const labelled = asMove(applyJourneyLabels(segments, [ride]).find((s) => s.kind === 'move' && s.label === 'Ride'));

    const [first, second] = splitSegment(labelled, T0 + 20 * MINUTE);
    expect(asMove(first).mode).toBe('cycle');
    expect(asMove(second).mode).toBe('cycle');
    expect(asMove(first).modeIsManual).toBe(true);
  });

  it('applies several labels in the order they happened', () => {
    const first = named({ id: 'a', label: 'Morning', startedAt: T0 + 12 * MINUTE, endedAt: T0 + 18 * MINUTE });
    const second = named({ id: 'b', label: 'Afternoon', startedAt: T0 + 22 * MINUTE, endedAt: T0 + 28 * MINUTE });

    const result = applyJourneyLabels(segments, [second, first]);
    const labels = result.filter((s) => s.kind === 'move' && s.label).map((s) => (s.kind === 'move' ? s.label : null));

    expect(labels).toEqual(['Morning', 'Afternoon']);
  });
});
