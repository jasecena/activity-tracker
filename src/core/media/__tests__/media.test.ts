import { EARTH_RADIUS_M, type PathPoint } from '../../geo';
import { buildTrack } from '../../replay';
import type { MoveSegment, Segment, StaySegment } from '../../segments';
import {
  attachToSegments,
  capturedAtFromMediaId,
  mediaForDay,
  mediaIdFor,
  normalizeMedia,
  placeMedia,
  totalBytes,
  type MediaItem,
} from '../index';

/** Equator, longitude 0 — see `segments/__tests__/fixtures.ts` for why. */
const DEG_PER_METRE_LAT = 1 / ((EARTH_RADIUS_M * Math.PI) / 180);

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const MINUTE = 60_000;

function item(capturedAt: number, overrides: Partial<MediaItem> = {}): MediaItem {
  return {
    id: mediaIdFor(capturedAt),
    kind: 'photo',
    capturedAt,
    durationMs: null,
    fileName: `${mediaIdFor(capturedAt)}.bin`,
    thumbFileName: null,
    at: null,
    byteLength: 1_024,
    note: '',
    ...overrides,
  };
}

function point(at: number, northM: number): PathPoint {
  return { lat: northM * DEG_PER_METRE_LAT, lon: 0, at, speedMps: 1 };
}

function move(startedAt: number, endedAt: number): MoveSegment {
  return {
    kind: 'move',
    id: `m-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 2,
    distanceM: 600,
    mode: 'walk',
    label: null,
    modeIsManual: false,
    path: [point(startedAt, 0), point(endedAt, 600)],
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
    center: { lat: northM * DEG_PER_METRE_LAT, lon: 0 },
    radiusM: 5,
  };
}

describe('mediaIdFor', () => {
  // Derived, never generated: re-reading an index, or merging one a crashed
  // write left behind, must update the same row rather than accumulate two.
  it('is a function of the instant alone', () => {
    expect(mediaIdFor(T0)).toBe(mediaIdFor(T0));
    expect(mediaIdFor(T0)).not.toBe(mediaIdFor(T0 + 1));
  });
});

describe('capturedAtFromMediaId', () => {
  // A capture interrupted mid-seal is recovered from a file named after its id
  // and nothing else — there is no index entry yet, by definition.
  it('recovers the instant an id was made from', () => {
    expect(capturedAtFromMediaId(mediaIdFor(T0))).toBe(T0);
  });

  it('refuses anything that is not one of ours', () => {
    expect(capturedAtFromMediaId('1767600000000')).toBeNull();
    expect(capturedAtFromMediaId('m-lunchtime')).toBeNull();
    expect(capturedAtFromMediaId('m-')).toBeNull();
    expect(capturedAtFromMediaId('m--1')).toBeNull();
  });
});

describe('normalizeMedia', () => {
  it('drops a position that is not a pair of finite numbers', () => {
    const [result] = normalizeMedia([{ ...item(T0), at: { lat: 'north', lon: 0 } }]);
    expect(result?.at).toBeNull();
    const [alsoNull] = normalizeMedia([{ ...item(T0), at: { lat: Number.NaN, lon: 0 } }]);
    expect(alsoNull?.at).toBeNull();
  });

  it('keeps a position that is', () => {
    const [result] = normalizeMedia([{ ...item(T0), at: { lat: 1.5, lon: -2.5 } }]);
    expect(result?.at).toEqual({ lat: 1.5, lon: -2.5 });
  });

  it('is empty for anything that is not a list', () => {
    expect(normalizeMedia(null)).toEqual([]);
    expect(normalizeMedia('nope')).toEqual([]);
    expect(normalizeMedia({ 0: item(T0) })).toEqual([]);
  });

  it('drops entries it does not recognise rather than repairing them', () => {
    const kept = item(T0);
    const result = normalizeMedia([
      kept,
      { ...item(T0 + 1), kind: 'hologram' },
      { ...item(T0 + 2), capturedAt: 'lunchtime' },
      { ...item(T0 + 3), fileName: '' },
      null,
      42,
    ]);
    expect(result).toEqual([kept]);
  });

  it('fills the soft fields rather than dropping the row over them', () => {
    const [result] = normalizeMedia([{ ...item(T0), durationMs: 'long', byteLength: -1, note: undefined }]);
    expect(result?.durationMs).toBeNull();
    expect(result?.byteLength).toBe(0);
    expect(result?.note).toBe('');
  });

  it('sorts by capture time', () => {
    const result = normalizeMedia([item(T0 + 2 * MINUTE), item(T0), item(T0 + MINUTE)]);
    expect(result.map((entry) => entry.capturedAt)).toEqual([T0, T0 + MINUTE, T0 + 2 * MINUTE]);
  });
});

describe('mediaForDay', () => {
  // A "day" is a wall-clock concept, so the offset decides which one an
  // instant near midnight lands in — the same sign convention as `core/day`.
  it('files an instant under the local day, not the UTC one', () => {
    const lateEvening = Date.UTC(2026, 0, 5, 23, 30, 0);
    const items = [item(lateEvening)];
    expect(mediaForDay(items, '2026-01-05', 0)).toHaveLength(1);
    expect(mediaForDay(items, '2026-01-06', 600)).toHaveLength(1);
    expect(mediaForDay(items, '2026-01-05', 600)).toHaveLength(0);
  });
});

describe('attachToSegments', () => {
  const walk = move(T0, T0 + 10 * MINUTE);
  const café = stay(T0 + 10 * MINUTE, T0 + 40 * MINUTE, 600);

  it('puts an item on the segment containing its instant', () => {
    const buckets = attachToSegments([walk, café], [item(T0 + 5 * MINUTE), item(T0 + 20 * MINUTE)]);
    expect(buckets.get(walk.id)?.map((entry) => entry.capturedAt)).toEqual([T0 + 5 * MINUTE]);
    expect(buckets.get(café.id)?.map((entry) => entry.capturedAt)).toEqual([T0 + 20 * MINUTE]);
  });

  it('leaves an item captured in a hole attached to nothing', () => {
    const later = stay(T0 + 130 * MINUTE, T0 + 140 * MINUTE, 4_000);
    const buckets = attachToSegments([walk, later], [item(T0 + 60 * MINUTE)]);
    expect(buckets.size).toBe(0);
  });

  it('sorts each bucket by time', () => {
    const buckets = attachToSegments([café], [item(T0 + 30 * MINUTE), item(T0 + 15 * MINUTE)]);
    expect(buckets.get(café.id)?.map((entry) => entry.capturedAt)).toEqual([T0 + 15 * MINUTE, T0 + 30 * MINUTE]);
  });

  // Segments are re-derived from the fix buffer every time they are needed, and
  // their ids come out identical. That is what lets the link live here, on read,
  // instead of being written onto a segment that will be rebuilt tomorrow.
  it('survives the day being re-derived', () => {
    const media = [item(T0 + 5 * MINUTE)];
    const first = attachToSegments([walk, café], media);
    const rederived: Segment[] = [move(T0, T0 + 10 * MINUTE), stay(T0 + 10 * MINUTE, T0 + 40 * MINUTE, 600)];
    expect(attachToSegments(rederived, media)).toEqual(first);
  });
});

describe('placeMedia', () => {
  // The reading taken at the shutter beats anything worked out afterwards: it
  // is the most direct answer there is, and it survives the fixes being pruned,
  // the day being re-derived, and tracking having been off entirely.
  it('prefers the position stored with the capture', () => {
    const track = buildTrack([move(T0, T0 + 10 * MINUTE)]);
    const shutter = { lat: 42 * DEG_PER_METRE_LAT, lon: 0 };
    const [placed] = placeMedia(track, [item(T0 + 5 * MINUTE, { at: shutter })]);

    expect(placed?.at?.lat).toBe(shutter.lat);
  });

  it('falls back to the day for a capture taken before positions were stored', () => {
    const track = buildTrack([move(T0, T0 + 10 * MINUTE)]);
    const [placed] = placeMedia(track, [item(T0 + 5 * MINUTE, { at: null })]);

    expect(placed?.at?.lat).toBeCloseTo(300 * DEG_PER_METRE_LAT, 9);
  });

  it('places one the day knows nothing about, if the capture knew', () => {
    const track = buildTrack([move(T0, T0 + 10 * MINUTE), move(T0 + 130 * MINUTE, T0 + 140 * MINUTE)]);
    const shutter = { lat: 7 * DEG_PER_METRE_LAT, lon: 0 };
    const [placed] = placeMedia(track, [item(T0 + 60 * MINUTE, { at: shutter })]);

    // In a hole as far as the timeline is concerned, and still placed.
    expect(placed?.at?.lat).toBe(shutter.lat);
  });

  it('gives an item the position the day was in at that instant', () => {
    const track = buildTrack([move(T0, T0 + 10 * MINUTE)]);
    const [placed] = placeMedia(track, [item(T0 + 5 * MINUTE)]);
    expect(placed?.at?.lat).toBeCloseTo(300 * DEG_PER_METRE_LAT, 9);
  });

  it('gives an item captured in a hole no position at all', () => {
    const track = buildTrack([move(T0, T0 + 10 * MINUTE), move(T0 + 130 * MINUTE, T0 + 140 * MINUTE)]);
    const [placed] = placeMedia(track, [item(T0 + 60 * MINUTE)]);
    expect(placed?.at).toBeNull();
    // Still listed. A photo with no pin is a photo, not a missing photo.
    expect(placed?.item.capturedAt).toBe(T0 + 60 * MINUTE);
  });
});

describe('totalBytes', () => {
  it('is zero for nothing', () => {
    expect(totalBytes([])).toBe(0);
  });

  it('sums what is on disk', () => {
    expect(totalBytes([item(T0), item(T0 + 1, { byteLength: 2_048 })])).toBe(3_072);
  });
});
