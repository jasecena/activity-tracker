import { EARTH_RADIUS_M, type LatLon } from '../../geo';
import {
  applyStationaryClaims,
  claimBehind,
  judgeStationaryClaim,
  stationaryCentre,
  stationaryClaimId,
  type StationaryClaim,
} from '../stationary';
import type { MoveSegment, Segment, StaySegment } from '../types';

import { ELSEWHERE, ORIGIN, T0 } from './fixtures';

/**
 * "I was here the whole time."
 *
 * Everything here is built from segments rather than fixes, because that is the
 * whole point of the design: a folded day and a frozen one are both a
 * `Segment[]`, so one implementation serves both and neither needs the archive.
 *
 * Distances are metres north of the origin, as everywhere else in this suite —
 * except where a test is about *where* something ended up, which goes near
 * `ELSEWHERE` instead, since a coordinate scaled by the wrong factor is still
 * exactly zero at (0, 0).
 */

const MINUTE = 60_000;
const DEG_PER_METRE_LAT = 1 / ((EARTH_RADIUS_M * Math.PI) / 180);

function north(metres: number, from: LatLon = ORIGIN): LatLon {
  return { lat: from.lat + metres * DEG_PER_METRE_LAT, lon: from.lon };
}

function stay(startedAt: number, endedAt: number, atM: number, radiusM = 5, from: LatLon = ORIGIN): StaySegment {
  return {
    kind: 'stay',
    id: `stay-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 10,
    center: north(atM, from),
    radiusM,
  };
}

function move(startedAt: number, endedAt: number, fromM: number, toM: number, from: LatLon = ORIGIN): MoveSegment {
  return {
    kind: 'move',
    id: `move-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 6,
    distanceM: Math.abs(toM - fromM),
    mode: 'walk',
    label: null,
    modeIsManual: false,
    path: [
      { ...north(fromM, from), at: startedAt, speedMps: null },
      { ...north(toM, from), at: endedAt, speedMps: 1 },
    ],
    topSpeedMps: 1,
  };
}

/** A desk afternoon as the fold reads it: sit, drift, sit. */
const DRIFTED: readonly Segment[] = [
  stay(T0, T0 + 30 * MINUTE, 0),
  move(T0 + 30 * MINUTE, T0 + 32 * MINUTE, 0, 20),
  stay(T0 + 32 * MINUTE, T0 + 90 * MINUTE, 20),
];

const QUESTION = { thresholdM: 60, readingErrorM: 10 };
const WHOLE = { startedAt: T0, endedAt: T0 + 90 * MINUTE };

describe('judging a claim', () => {
  it('allows a stretch that never left', () => {
    const verdict = judgeStationaryClaim({ segments: DRIFTED, ...WHOLE, ...QUESTION });

    expect(verdict.ok).toBe(true);
    expect(verdict.refusal).toBeNull();
  });

  /**
   * The case that decides the whole feature. A real drive between two stays at
   * home is a journey that happened, and flattening it would erase something
   * the app cannot get back.
   */
  it('refuses when there was a drive in the middle', () => {
    const segments = [
      stay(T0, T0 + 30 * MINUTE, 0),
      move(T0 + 30 * MINUTE, T0 + 50 * MINUTE, 0, 20_000),
      stay(T0 + 50 * MINUTE, T0 + 80 * MINUTE, 20_000),
      move(T0 + 80 * MINUTE, T0 + 100 * MINUTE, 20_000, 0),
      stay(T0 + 100 * MINUTE, T0 + 130 * MINUTE, 0),
    ];

    const verdict = judgeStationaryClaim({
      segments,
      startedAt: T0,
      endedAt: T0 + 130 * MINUTE,
      ...QUESTION,
    });

    expect(verdict.ok).toBe(false);
    expect(verdict.refusal).toBe('moved');
    // And it says how far, because a control that silently declines is the
    // failure the transcription button already taught this app.
    expect(verdict.excursionM).toBeGreaterThan(9_000);
  });

  /**
   * A walk that returns to where it started is still a walk. This is the case
   * that rules out measuring the straight line from the first point to the
   * last, which would call it zero.
   */
  it('refuses a walk round the block, which ends where it began', () => {
    const segments = [
      stay(T0, T0 + 10 * MINUTE, 0),
      move(T0 + 10 * MINUTE, T0 + 20 * MINUTE, 0, 600),
      move(T0 + 20 * MINUTE, T0 + 30 * MINUTE, 600, 0),
      stay(T0 + 30 * MINUTE, T0 + 40 * MINUTE, 0),
    ];

    const verdict = judgeStationaryClaim({ segments, startedAt: T0, endedAt: T0 + 40 * MINUTE, ...QUESTION });

    expect(verdict.ok).toBe(false);
    expect(verdict.refusal).toBe('moved');
  });

  /**
   * And this is the case that rules out total path length, which would call
   * pacing round a house hundreds of metres of travel. Ground distance is the
   * sum of the steps; the question being asked is how far *away* you got.
   */
  it('allows pacing about in one place, however far the steps add up to', () => {
    const segments = [
      stay(T0, T0 + 5 * MINUTE, 0),
      move(T0 + 5 * MINUTE, T0 + 10 * MINUTE, 0, 25),
      move(T0 + 10 * MINUTE, T0 + 15 * MINUTE, 25, 0),
      move(T0 + 15 * MINUTE, T0 + 20 * MINUTE, 0, 25),
      move(T0 + 20 * MINUTE, T0 + 25 * MINUTE, 25, 0),
      stay(T0 + 25 * MINUTE, T0 + 30 * MINUTE, 0),
    ];
    // Two hundred metres of walking, none of it further than 25 m away.
    expect(segments.reduce((total, s) => total + (s.kind === 'move' ? s.distanceM : 0), 0)).toBe(100);

    const verdict = judgeStationaryClaim({ segments, startedAt: T0, endedAt: T0 + 30 * MINUTE, ...QUESTION });

    expect(verdict.ok).toBe(true);
  });

  /**
   * The reading error comes off before the comparison. A fix seventy metres out
   * from a reading worth ±20 m is not evidence that anybody walked seventy
   * metres, and refusing on it would refuse exactly the drift this exists for.
   */
  it('takes the reading error off before it decides', () => {
    const segments = [stay(T0, T0 + 10 * MINUTE, 0), stay(T0 + 10 * MINUTE, T0 + 20 * MINUTE, 100, 50)];
    const span = { startedAt: T0, endedAt: T0 + 20 * MINUTE };

    // The centres are 100 m apart and the anchor sits between them, so the raw
    // separation is 50 m each way — under the threshold on its own.
    expect(judgeStationaryClaim({ segments, ...span, ...QUESTION }).ok).toBe(true);

    // Push them far enough apart that even the generous stay radius cannot
    // account for it, and it is movement again.
    const apart = [stay(T0, T0 + 10 * MINUTE, 0), stay(T0 + 10 * MINUTE, T0 + 20 * MINUTE, 400, 50)];
    expect(judgeStationaryClaim({ segments: apart, ...span, ...QUESTION }).refusal).toBe('moved');
  });

  it('refuses when a journey in the range has a name somebody typed', () => {
    const labels = [
      { id: 'l1', label: 'School run', mode: null, startedAt: T0 + 30 * MINUTE, endedAt: T0 + 32 * MINUTE },
    ];

    const verdict = judgeStationaryClaim({ segments: DRIFTED, ...WHOLE, ...QUESTION, labels });

    expect(verdict.refusal).toBe('named');
  });

  /** A nameless label is a mode correction, which says nothing about place. */
  it('allows one whose label is only a mode correction', () => {
    const labels = [
      { id: 'l1', label: '', mode: 'cycle' as const, startedAt: T0 + 30 * MINUTE, endedAt: T0 + 32 * MINUTE },
    ];

    expect(judgeStationaryClaim({ segments: DRIFTED, ...WHOLE, ...QUESTION, labels }).ok).toBe(true);
  });

  /**
   * A capture stores where it was taken, from a reading the fold never got to
   * reject — so a photograph three kilometres away contradicts the claim on its
   * own, whatever the segments say.
   */
  it('refuses when a photograph inside the range was taken somewhere else', () => {
    const verdict = judgeStationaryClaim({
      segments: DRIFTED,
      ...WHOLE,
      ...QUESTION,
      captures: [north(3_000)],
    });

    expect(verdict.refusal).toBe('capture-elsewhere');
  });

  it('allows one taken where you were standing', () => {
    expect(judgeStationaryClaim({ segments: DRIFTED, ...WHOLE, ...QUESTION, captures: [north(15)] }).ok).toBe(true);
  });

  it('refuses a range with nothing in it, and one that runs backwards', () => {
    expect(judgeStationaryClaim({ segments: DRIFTED, startedAt: T0, endedAt: T0, ...QUESTION }).refusal).toBe(
      'no-range',
    );
    expect(judgeStationaryClaim({ segments: DRIFTED, startedAt: T0 + MINUTE, endedAt: T0, ...QUESTION }).refusal).toBe(
      'no-range',
    );
  });

  /** One row is not a stretch: there is nothing to join it to. */
  it('refuses a range covering a single row', () => {
    expect(
      judgeStationaryClaim({ segments: DRIFTED, startedAt: T0, endedAt: T0 + 30 * MINUTE, ...QUESTION }).refusal,
    ).toBe('no-range');
  });
});

describe('where the claim says you were', () => {
  it('averages the stays and ignores the moving', () => {
    // Away from the origin, because a centre scaled by the wrong factor is
    // still exactly zero at (0, 0) — the bug that put a stay in the Tasman Sea.
    const segments = [
      stay(T0, T0 + 10 * MINUTE, 0, 5, ELSEWHERE),
      move(T0 + 10 * MINUTE, T0 + 12 * MINUTE, 0, 40, ELSEWHERE),
      stay(T0 + 12 * MINUTE, T0 + 30 * MINUTE, 40, 5, ELSEWHERE),
    ];

    const centre = stationaryCentre(segments);

    expect(centre?.lat).toBeCloseTo(north(20, ELSEWHERE).lat, 6);
    expect(centre?.lon).toBeCloseTo(ELSEWHERE.lon, 6);
  });

  it('has no answer when nothing in the range was a stay', () => {
    expect(stationaryCentre([move(T0, T0 + 10 * MINUTE, 0, 40)])).toBeNull();
  });
});

describe('applying a claim', () => {
  const claim: StationaryClaim = {
    id: stationaryClaimId(T0),
    startedAt: T0,
    endedAt: T0 + 90 * MINUTE,
    at: north(10),
  };

  it('collapses everything it covers into one stay', () => {
    const result = applyStationaryClaims(DRIFTED, [claim]);

    expect(result).toHaveLength(1);
    const merged = result[0] as StaySegment;
    expect(merged.kind).toBe('stay');
    expect(merged.startedAt).toBe(T0);
    expect(merged.endedAt).toBe(T0 + 90 * MINUTE);
    // Every reading that went into the rows is still accounted for.
    expect(merged.fixCount).toBe(26);
  });

  it('draws it where the claim says, not where the fold thought', () => {
    const merged = applyStationaryClaims(DRIFTED, [claim])[0] as StaySegment;

    expect(merged.center).toEqual(north(10));
  });

  /**
   * The radius stays truthful: the claim says you did not leave, not that the
   * readings agreed with each other.
   */
  it('keeps a radius covering how far the collapsed rows reached', () => {
    const merged = applyStationaryClaims(DRIFTED, [claim])[0] as StaySegment;

    expect(merged.radiusM).toBeGreaterThanOrEqual(10);
  });

  it('leaves everything outside the range alone', () => {
    const later = stay(T0 + 120 * MINUTE, T0 + 150 * MINUTE, 0);

    const result = applyStationaryClaims([...DRIFTED, later], [claim]);

    expect(result).toHaveLength(2);
    expect(result[1]).toEqual(later);
  });

  /**
   * The rule `applyJourneyLabels` learned the hard way: a claim that covers
   * nothing emits nothing. Inventing a row from the claim's own bounds is what
   * printed hollow journeys on days they had nothing to do with.
   */
  it('emits nothing at all when it covers nothing', () => {
    const elsewhere = [stay(T0 + 200 * MINUTE, T0 + 230 * MINUTE, 0)];

    expect(applyStationaryClaims(elsewhere, [claim])).toEqual(elsewhere);
  });

  it('cuts a row that straddles the start or the end', () => {
    const straddling = [stay(T0 - 30 * MINUTE, T0 + 45 * MINUTE, 0), stay(T0 + 45 * MINUTE, T0 + 120 * MINUTE, 0)];

    const result = applyStationaryClaims(straddling, [claim]);

    expect(result.map((s) => [s.startedAt, s.endedAt])).toEqual([
      [T0 - 30 * MINUTE, T0],
      [T0, T0 + 90 * MINUTE],
      [T0 + 90 * MINUTE, T0 + 120 * MINUTE],
    ]);
  });

  /** Re-deriving the same day twice must not stack a second row over the first. */
  it('is unchanged by being applied twice', () => {
    const once = applyStationaryClaims(DRIFTED, [claim]);

    expect(applyStationaryClaims(once, [claim])).toEqual(once);
  });

  it('applies several claims to one day without them interfering', () => {
    const second: StationaryClaim = {
      id: stationaryClaimId(T0 + 120 * MINUTE),
      startedAt: T0 + 120 * MINUTE,
      endedAt: T0 + 180 * MINUTE,
      at: north(500),
    };
    const day = [
      ...DRIFTED,
      stay(T0 + 120 * MINUTE, T0 + 150 * MINUTE, 500),
      move(T0 + 150 * MINUTE, T0 + 152 * MINUTE, 500, 520),
      stay(T0 + 152 * MINUTE, T0 + 180 * MINUTE, 520),
    ];

    const result = applyStationaryClaims(day, [claim, second]);

    expect(result.map((s) => s.id)).toEqual([claim.id, second.id]);
  });
});

describe('finding the claim behind a row', () => {
  /**
   * This is what makes undo a long press on the merged row. The withdrawn merge
   * feature's recorded objection was that undoing meant finding the label
   * behind a row by its id; here the row *is* the claim's id.
   */
  it('recognises a row it made', () => {
    const claim: StationaryClaim = {
      id: stationaryClaimId(T0),
      startedAt: T0,
      endedAt: T0 + 90 * MINUTE,
      at: north(10),
    };
    const merged = applyStationaryClaims(DRIFTED, [claim])[0] as Segment;

    expect(claimBehind(merged, [claim])).toEqual(claim);
  });

  it('says nothing about an ordinary row', () => {
    expect(claimBehind(DRIFTED[0] as Segment, [])).toBeNull();
  });
});
