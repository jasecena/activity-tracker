import fc from 'fast-check';

import { EARTH_RADIUS_M, type PathPoint } from '../../geo';
import type { MoveSegment, Segment, StaySegment } from '../../segments';
import { buildTrack, holesIn, positionAt, replaySpan } from '../index';

/**
 * Everything here is at the equator, at longitude 0 — the middle of the
 * Atlantic — for the reason spelled out in `segments/__tests__/fixtures.ts`: a
 * plausible latitude in a committed file is a permanent record of where its
 * author was, and `.gitleaks.toml` fails the build over one.
 */
const DEG_PER_METRE_LAT = 1 / ((EARTH_RADIUS_M * Math.PI) / 180);

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const MINUTE = 60_000;

function north(metres: number): number {
  return metres * DEG_PER_METRE_LAT;
}

function point(at: number, northM: number, speedMps: number | null = 1): PathPoint {
  return { lat: north(northM), lon: 0, at, speedMps };
}

function move(startedAt: number, path: readonly PathPoint[]): MoveSegment {
  const last = path[path.length - 1];
  return {
    kind: 'move',
    id: `m-${startedAt}`,
    startedAt,
    endedAt: last?.at ?? startedAt,
    fixCount: path.length,
    distanceM: 0,
    mode: 'walk',
    label: null,
    modeIsManual: false,
    path,
    topSpeedMps: 1,
  };
}

function stay(startedAt: number, endedAt: number, northM: number): StaySegment {
  return {
    kind: 'stay',
    id: `s-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 10,
    center: { lat: north(northM), lon: 0 },
    radiusM: 5,
  };
}

/**
 * A contiguous morning: a stay, a walk north, another stay. The boundary fix
 * belongs to both segments either side of it, exactly as the segmenter emits.
 */
function contiguousDay(): Segment[] {
  const walkFrom = T0 + 30 * MINUTE;
  const walkTo = walkFrom + 10 * MINUTE;
  return [
    stay(T0, walkFrom, 0),
    move(walkFrom, [point(walkFrom, 0, null), point(walkFrom + 5 * MINUTE, 300), point(walkTo, 600)]),
    stay(walkTo, walkTo + 20 * MINUTE, 600),
  ];
}

describe('buildTrack', () => {
  it('is empty for a day with nothing in it', () => {
    const track = buildTrack([]);
    expect(track.points).toEqual([]);
    expect(positionAt(track, T0)).toBeNull();
  });

  it('spans the first instant to the last', () => {
    const track = buildTrack(contiguousDay());
    expect(track.from).toBe(T0);
    expect(track.to).toBe(T0 + 60 * MINUTE);
  });

  it('sorts segments handed to it out of order', () => {
    const day = contiguousDay();
    const shuffled = [day[2], day[0], day[1]].filter((segment): segment is Segment => segment !== undefined);
    expect(buildTrack(shuffled).points).toEqual(buildTrack(day).points);
  });

  it('holds a stay in place with a point at each end', () => {
    const track = buildTrack([stay(T0, T0 + 30 * MINUTE, 0)]);
    expect(track.points).toHaveLength(2);
    expect(track.points[0]?.at).toBe(T0);
    expect(track.points[1]?.at).toBe(T0 + 30 * MINUTE);
    expect(track.points[0]?.lat).toBe(track.points[1]?.lat);
  });

  // The bug this exists to prevent: dropping the duplicated boundary instant
  // leaves the old segment's last point beside the new segment's *second*
  // point, separated by real time — which is exactly the shape `positionAt`
  // reads as a hole. Every change of activity would sprout a gap.
  // The engine never emits overlapping segments, but the day log is read back
  // from disk and `normalizeLog` only checks shapes — an older build, or a
  // half-merged write, can hand this in. A track that goes backwards would make
  // the binary search below return nonsense for every instant after it.
  it('drops points that go backwards rather than trusting them', () => {
    const overlapping = [
      move(T0, [point(T0, 0, null), point(T0 + 20 * MINUTE, 1_200)]),
      move(T0 + 10 * MINUTE, [point(T0 + 10 * MINUTE, 5_000, null), point(T0 + 30 * MINUTE, 6_000)]),
    ];
    const track = buildTrack(overlapping);

    const times = track.points.map((candidate) => candidate.at);
    expect(times).toEqual([...times].sort((a, b) => a - b));
    expect(times).not.toContain(T0 + 10 * MINUTE);
  });

  it('keeps both points at a segment boundary', () => {
    const track = buildTrack(contiguousDay());
    const boundary = T0 + 30 * MINUTE;
    const atBoundary = track.points.filter((candidate) => candidate.at === boundary);
    expect(atBoundary).toHaveLength(2);
    expect(atBoundary[0]?.kind).toBe('stay');
    expect(atBoundary[1]?.kind).toBe('move');
  });
});

describe('positionAt', () => {
  const track = buildTrack(contiguousDay());

  it('knows nothing before the first fix or after the last', () => {
    expect(positionAt(track, T0 - 1)).toBeNull();
    expect(positionAt(track, track.to + 1)).toBeNull();
  });

  it('is exact at both ends of the span', () => {
    expect(positionAt(track, track.from)?.lat).toBe(0);
    expect(positionAt(track, track.to)?.lat).toBeCloseTo(north(600), 12);
  });

  it('holds still through a stay', () => {
    const early = positionAt(track, T0 + MINUTE);
    const late = positionAt(track, T0 + 29 * MINUTE);
    expect(early?.lat).toBe(0);
    expect(late?.lat).toBe(0);
    expect(early?.kind).toBe('stay');
    expect(early?.speedMps).toBe(0);
  });

  it('interpolates linearly inside a move', () => {
    // Half way through the first five-minute leg of a 300 m climb.
    const halfway = positionAt(track, T0 + 32.5 * MINUTE + 0);
    expect(halfway?.lat).toBeCloseTo(north(150), 9);
    expect(halfway?.kind).toBe('move');
  });

  it('reports the speed of the step being taken, not a blend', () => {
    const path = [point(T0, 0, null), point(T0 + MINUTE, 60, 1), point(T0 + 2 * MINUTE, 300, 4)];
    const single = buildTrack([move(T0, path)]);
    expect(positionAt(single, T0 + 90_000)?.speedMps).toBe(4);
  });

  it('hands a transition instant to the segment that is starting', () => {
    const boundary = T0 + 30 * MINUTE;
    expect(positionAt(track, boundary)?.kind).toBe('move');
  });

  // A gap is a hole, never a straight line. This is the assertion that keeps a
  // two-hour stretch indoors from being replayed as a walk through the wall.
  it('returns null across a hole and picks up again after it', () => {
    const before = move(T0, [point(T0, 0, null), point(T0 + 5 * MINUTE, 300)]);
    const resumeAt = T0 + 125 * MINUTE;
    const after = move(resumeAt, [point(resumeAt, 4_000, null), point(resumeAt + 5 * MINUTE, 4_300)]);

    const gapped = buildTrack([before, after]);
    expect(positionAt(gapped, T0 + 60 * MINUTE)).toBeNull();
    expect(positionAt(gapped, T0 + 5 * MINUTE)?.lat).toBeCloseTo(north(300), 12);
    expect(positionAt(gapped, resumeAt)?.lat).toBeCloseTo(north(4_000), 12);
  });

  it('never invents a position for a day it has no points for', () => {
    const empty = buildTrack([move(T0, [])]);
    expect(positionAt(empty, T0)).toBeNull();
  });

  it('moves monotonically north along a day that only goes north', () => {
    fc.assert(
      fc.property(fc.integer({ min: 0, max: 60 * MINUTE }), fc.integer({ min: 0, max: 60 * MINUTE }), (a, b) => {
        const earlier = positionAt(track, T0 + Math.min(a, b));
        const later = positionAt(track, T0 + Math.max(a, b));
        if (!earlier || !later) return true;
        return later.lat >= earlier.lat - 1e-12;
      }),
    );
  });
});

describe('holesIn', () => {
  it('finds nothing in a contiguous day', () => {
    expect(holesIn(buildTrack(contiguousDay()))).toEqual([]);
  });

  it('reports the stretch the app knows nothing about', () => {
    const before = stay(T0, T0 + 10 * MINUTE, 0);
    const after = stay(T0 + 130 * MINUTE, T0 + 140 * MINUTE, 4_000);
    expect(holesIn(buildTrack([before, after]))).toEqual([{ from: T0 + 10 * MINUTE, to: T0 + 130 * MINUTE }]);
  });
});

describe('replaySpan', () => {
  it('is null for no segments', () => {
    expect(replaySpan([])).toBeNull();
  });

  it('covers the first start and the last end', () => {
    expect(replaySpan(contiguousDay())).toEqual({ from: T0, to: T0 + 60 * MINUTE });
  });

  // A segment that straddles midnight is filed under the day it started, whole,
  // so a day's span can legitimately run past its own last row's start.
  it('takes the latest end, not the last segment in the list', () => {
    const long = move(T0, [point(T0, 0, null), point(T0 + 200 * MINUTE, 600)]);
    const short = stay(T0 + 10 * MINUTE, T0 + 20 * MINUTE, 100);
    expect(replaySpan([long, short])?.to).toBe(T0 + 200 * MINUTE);
  });
});
