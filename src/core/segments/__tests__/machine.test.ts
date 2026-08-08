import {
  closeOut,
  DEFAULT_SEGMENT_CONFIG,
  ingest,
  ingestAll,
  initialSegmenter,
  lastKnownPosition,
  segmentFixes,
  type MoveSegment,
  type Segment,
  type StaySegment,
} from '../index';

import { chain, ELSEWHERE, fix, leg, shifted, T0 } from './fixtures';

const MINUTE = 60_000;
const CONFIG = DEFAULT_SEGMENT_CONFIG;

function still(fromM: number, startAt: number, durationMs: number) {
  return leg({ fromM, startAt, durationMs, speedMps: 0, intervalMs: MINUTE });
}

function walk(fromM: number, startAt: number, durationMs: number) {
  return leg({ fromM, startAt, durationMs, speedMps: 1.4, intervalMs: 10_000 });
}

function kinds(segments: readonly Segment[]): string[] {
  return segments.map((segment) => segment.kind);
}

function asMove(segment: Segment | undefined): MoveSegment {
  if (!segment || segment.kind !== 'move') throw new Error(`expected a move, got ${segment?.kind ?? 'nothing'}`);
  return segment;
}

function asStay(segment: Segment | undefined): StaySegment {
  if (!segment || segment.kind !== 'stay') throw new Error(`expected a stay, got ${segment?.kind ?? 'nothing'}`);
  return segment;
}

describe('an empty machine', () => {
  it('holds nothing and knows nowhere', () => {
    const state = initialSegmenter();
    expect(closeOut(state, CONFIG)).toEqual([]);
    expect(lastKnownPosition(state)).toBeNull();
    expect(segmentFixes([], CONFIG).segments).toEqual([]);
  });
});

describe('a plain day: sit, walk, sit', () => {
  const fixes = chain(
    still(0, T0, 10 * MINUTE),
    walk(0, T0 + 10 * MINUTE, 10 * MINUTE),
    still(840, T0 + 20 * MINUTE, 10 * MINUTE),
  );
  const { segments } = segmentFixes(fixes, CONFIG);

  it('produces exactly the three things that happened', () => {
    expect(kinds(segments)).toEqual(['stay', 'move', 'stay']);
  });

  it('measures the walk in metres actually travelled', () => {
    // 1.4 m/s for ten minutes.
    expect(asMove(segments[1]).distanceM).toBeCloseTo(840, 3);
    expect(asMove(segments[1]).mode).toBe('walk');
  });

  // Without this every change of activity leaves a hole a few seconds wide, and
  // a day of errands loses minutes nobody can account for.
  it('leaves no gap between one segment and the next', () => {
    expect(segments[0]?.endedAt).toBe(segments[1]?.startedAt);
    expect(segments[1]?.endedAt).toBe(segments[2]?.startedAt);
  });

  it('spans the whole day it was given', () => {
    expect(segments[0]?.startedAt).toBe(T0);
    expect(segments[segments.length - 1]?.endedAt).toBe(T0 + 30 * MINUTE);
  });

  it('places the stay where the phone actually sat', () => {
    expect(asStay(segments[0]).center.lat).toBeCloseTo(0, 9);
    expect(asStay(segments[0]).radiusM).toBeCloseTo(0, 6);
  });
});

/**
 * Where a stay says it was, against where its readings actually were.
 *
 * Deliberately run away from the origin. Every other fixture in this suite sits
 * at (0, 0) — which keeps the distances checkable in your head and keeps real
 * places out of the repository, but also means a centre computed with the wrong
 * divisor is still exactly zero. This is the assertion that origin hides.
 */
describe('where a stay says it was', () => {
  function boundsOfFixes(fixes: readonly { lat: number; lon: number }[]) {
    return {
      minLat: Math.min(...fixes.map((one) => one.lat)),
      maxLat: Math.max(...fixes.map((one) => one.lat)),
      minLon: Math.min(...fixes.map((one) => one.lon)),
      maxLon: Math.max(...fixes.map((one) => one.lon)),
    };
  }

  it('is inside the readings it was computed from', () => {
    const fixes = shifted(chain(still(0, T0, 20 * MINUTE)), ELSEWHERE);
    const { segments } = segmentFixes(fixes, CONFIG);
    const bounds = boundsOfFixes(fixes);

    const { center } = asStay(segments[0]);
    expect(center.lat).toBeGreaterThanOrEqual(bounds.minLat);
    expect(center.lat).toBeLessThanOrEqual(bounds.maxLat);
    expect(center.lon).toBeGreaterThanOrEqual(bounds.minLon);
    expect(center.lon).toBeLessThanOrEqual(bounds.maxLon);
  });

  // The bug that shipped. A merge counts the boundary fix once and used to sum
  // it twice, so the centre came out as the true mean scaled by (n + merges)/n
  // — which is invisible at the origin and, on a real phone, put a stay 800 km
  // out to sea. Two absorbed segments, so the error compounds rather than
  // being a rounding difference.
  it('is still inside them after absorbing the noise around it', () => {
    const fixes = shifted(
      chain(
        still(0, T0, 15 * MINUTE),
        walk(0, T0 + 15 * MINUTE, 30_000),
        still(42, T0 + 15 * MINUTE + 30_000, 15 * MINUTE),
        walk(42, T0 + 30 * MINUTE + 30_000, 30_000),
        still(84, T0 + 31 * MINUTE, 15 * MINUTE),
      ),
      ELSEWHERE,
    );
    const { segments } = segmentFixes(fixes, CONFIG);
    const bounds = boundsOfFixes(fixes);

    expect(kinds(segments)).toEqual(['stay']);
    const { center } = asStay(segments[0]);
    expect(center.lat).toBeGreaterThanOrEqual(bounds.minLat);
    expect(center.lat).toBeLessThanOrEqual(bounds.maxLat);
    expect(center.lon).toBeGreaterThanOrEqual(bounds.minLon);
    expect(center.lon).toBeLessThanOrEqual(bounds.maxLon);
  });

  // The centre is the plain mean of every reading, and after a merge it must
  // still be the mean of *all* of them — not of a count that disagrees with the
  // sum it divides.
  it('is the mean of every reading behind it', () => {
    const fixes = shifted(
      chain(
        still(0, T0, 15 * MINUTE),
        walk(0, T0 + 15 * MINUTE, 30_000),
        still(42, T0 + 15 * MINUTE + 30_000, 15 * MINUTE),
      ),
      ELSEWHERE,
    );
    const { segments } = segmentFixes(fixes, CONFIG);

    const stay = asStay(segments[0]);
    const meanLon = fixes.reduce((sum, one) => sum + one.lon, 0) / fixes.length;
    expect(stay.fixCount).toBe(fixes.length);
    expect(stay.center.lon).toBeCloseTo(meanLon, 9);
  });
});

describe('noise', () => {
  // Standing up to fetch a coffee is not a walk. Left in, a working day becomes
  // forty rows of "Walk, 30 m".
  it('folds a move too short to matter back into the stay around it', () => {
    const fixes = chain(
      still(0, T0, 10 * MINUTE),
      walk(0, T0 + 10 * MINUTE, 30_000),
      still(42, T0 + 10 * MINUTE + 30_000, 10 * MINUTE),
    );
    const { segments } = segmentFixes(fixes, CONFIG);

    expect(kinds(segments)).toEqual(['stay']);
    expect(segments[0]?.startedAt).toBe(T0);
    expect(segments[0]?.endedAt).toBe(T0 + 20 * MINUTE + 30_000);
  });

  // A minute at a crossing is part of the walk, not a place you went.
  it('folds a stay too short to matter into the movement around it', () => {
    const fixes = chain(
      walk(0, T0, 10 * MINUTE),
      still(840, T0 + 10 * MINUTE, MINUTE),
      walk(840, T0 + 11 * MINUTE, 10 * MINUTE),
    );
    const { segments } = segmentFixes(fixes, CONFIG);

    expect(kinds(segments)).toEqual(['move']);
    expect(asMove(segments[0]).distanceM).toBeCloseTo(1680, 3);
    expect(segments[0]?.endedAt).toBe(T0 + 21 * MINUTE);
  });

  it('keeps the time from an absorbed segment, even though the row disappears', () => {
    const fixes = chain(still(0, T0, 10 * MINUTE), walk(0, T0 + 10 * MINUTE, 30_000));
    const { segments } = segmentFixes(fixes, CONFIG);

    // The 30-second shuffle is not a row, but the day still ran until 10:30.
    expect(kinds(segments)).toEqual(['stay']);
    expect(segments[0]?.endedAt).toBe(T0 + 10 * MINUTE + 30_000);
  });

  it('emits a lone short segment rather than losing the stretch entirely', () => {
    const fixes = [fix(T0, 0), fix(T0 + 10_000, 14)];
    const { segments } = segmentFixes(fixes, CONFIG);

    expect(segments).toHaveLength(1);
    expect(segments[0]?.startedAt).toBe(T0);
    expect(segments[0]?.endedAt).toBe(T0 + 10_000);
  });
});

describe('gaps', () => {
  // Two hours indoors is not a two-hour stay and it is certainly not a walk
  // through the building. It is an absence, and the timeline shows a hole.
  it('closes what is open and does not bridge the silence', () => {
    const fixes = chain(still(0, T0, 10 * MINUTE), still(5_000, T0 + 90 * MINUTE, 10 * MINUTE));
    const { segments } = segmentFixes(fixes, CONFIG);

    expect(kinds(segments)).toEqual(['stay', 'stay']);
    expect(segments[0]?.endedAt).toBe(T0 + 10 * MINUTE);
    expect(segments[1]?.startedAt).toBe(T0 + 90 * MINUTE);
    // Crucially: no move segment covering the 5 km between them.
    expect(segments.every((segment) => segment.kind === 'stay')).toBe(true);
  });
});

describe('bad fixes', () => {
  it('drops a teleport without letting it inflate the distance', () => {
    const clean = chain(still(0, T0, 10 * MINUTE), walk(0, T0 + 10 * MINUTE, 10 * MINUTE));
    // The classic: a stale cached position from 40 km away, stamped `now`.
    const withGlitch = [...clean.slice(0, 12), fix(T0 + 11 * MINUTE + 5_000, 40_000), ...clean.slice(12)];

    const dirty = segmentFixes(withGlitch, CONFIG);
    const tidy = segmentFixes(clean, CONFIG);

    expect(dirty.rejected.teleport).toBe(1);
    expect(dirty.segments).toEqual(tidy.segments);
  });

  it('drops readings too vague to say anything, and counts them', () => {
    const fixes = [
      fix(T0, 0),
      fix(T0 + 10_000, 300, { accuracyM: 1_500 }),
      fix(T0 + 20_000, 0),
      // How `services/location.ts` maps Core Location's "this reading is invalid".
      fix(T0 + 30_000, 0, { accuracyM: Infinity }),
    ];
    const { rejected } = segmentFixes(fixes, CONFIG);
    expect(rejected.inaccurate).toBe(2);
  });

  it('never lets a rejected fix become the reference for the next one', () => {
    // If the 40 km glitch became `lastFix`, the *next* real fix would look like
    // a 40 km teleport back, and one bad reading would cost two.
    const fixes = [fix(T0, 0), fix(T0 + 10_000, 40_000), fix(T0 + 20_000, 14), fix(T0 + 30_000, 28)];
    const { rejected, segments } = segmentFixes(fixes, CONFIG);

    expect(rejected.teleport).toBe(1);
    expect(asMove(segments[0]).distanceM).toBeCloseTo(28, 3);
  });
});

describe('folding', () => {
  const fixes = chain(
    still(0, T0, 10 * MINUTE),
    walk(0, T0 + 10 * MINUTE, 10 * MINUTE),
    still(840, T0 + 20 * MINUTE, 10 * MINUTE),
  );

  // The property the whole persistence design rests on: the app throws its
  // timeline away and rebuilds it from the fix buffer, and must get the same
  // answer — including the same ids, or the day log would fill with duplicates.
  it('is deterministic, ids included', () => {
    expect(segmentFixes(fixes, CONFIG)).toEqual(segmentFixes(fixes, CONFIG));
  });

  it('gives the same answer one fix at a time as all at once', () => {
    let state = initialSegmenter();
    const emitted: Segment[] = [];
    for (const item of fixes) {
      const result = ingest(state, item, CONFIG);
      state = result.state;
      emitted.push(...result.emitted);
    }
    expect([...emitted, ...closeOut(state, CONFIG)]).toEqual(segmentFixes(fixes, CONFIG).segments);
  });

  it('can be resumed from a partially folded state', () => {
    const first = ingestAll(initialSegmenter(), fixes.slice(0, 5), CONFIG);
    const second = ingestAll(first.state, fixes.slice(5), CONFIG);
    expect([...first.emitted, ...second.emitted, ...closeOut(second.state, CONFIG)]).toEqual(
      segmentFixes(fixes, CONFIG).segments,
    );
  });

  it('reports where the phone last was', () => {
    const { state } = ingestAll(initialSegmenter(), fixes, CONFIG);
    expect(lastKnownPosition(state)?.lat).toBeCloseTo(840 / 111194.93, 6);
  });
});

describe('routes', () => {
  it('thins the stored path but keeps both ends', () => {
    const fixes = walk(0, T0, 10 * MINUTE);
    const move = asMove(segmentFixes(fixes, CONFIG).segments[0]);

    // 840 m at 25 m resolution is far fewer points than the 61 fixes.
    expect(move.path.length).toBeLessThan(fixes.length);
    expect(move.path[0]?.at).toBe(T0);
    expect(move.path[move.path.length - 1]?.at).toBe(T0 + 10 * MINUTE);
  });

  it('records a top speed consistent with the distance it reports', () => {
    const move = asMove(segmentFixes(walk(0, T0, 10 * MINUTE), CONFIG).segments[0]);
    expect(move.topSpeedMps).toBeCloseTo(1.4, 6);
  });
});
