import { archiveCompaction, compactFixes, liveCompaction, type CompactionConfig } from '..';
import { distanceM, type Fix } from '../../geo';
import { DEFAULT_SEGMENT_CONFIG, segmentFixes } from '../../segments';
import { chain, ELSEWHERE, fix, leg, legEndM, shifted, T0 } from '../../segments/__tests__/fixtures';

/**
 * Compaction has to be judged against the fold, not against itself: the
 * question is never "did it delete a lot" — it is "does the day still come out
 * of what is left". So most of what follows folds the compacted stream and
 * compares the timeline, which is the only thing that actually matters.
 *
 * The fixtures are the segmenter's own, on the equator at longitude 0, for the
 * reason spelled out in `segments/__tests__/fixtures.ts`.
 */

const MINUTE = 60_000;
const ARCHIVE = archiveCompaction(DEFAULT_SEGMENT_CONFIG);
const LIVE = liveCompaction(DEFAULT_SEGMENT_CONFIG);

/** A phone sitting on a desk: one spot, sampled every ten seconds. */
function still(atM: number, startAt: number, durationMs: number, intervalMs = 10_000): Fix[] {
  return leg({ fromM: atM, startAt, durationMs, speedMps: 0, intervalMs });
}

function times(fixes: readonly Fix[]): number[] {
  return fixes.map((one) => one.at - T0);
}

/** The largest hole between consecutive readings. The number `gapMs` cares about. */
function widestGapMs(fixes: readonly Fix[]): number {
  let widest = 0;
  for (let at = 1; at < fixes.length; at += 1) {
    const previous = fixes[at - 1];
    const current = fixes[at];
    if (previous && current) widest = Math.max(widest, current.at - previous.at);
  }
  return widest;
}

/**
 * What a timeline is, for the purpose of "the same day came out".
 *
 * The centre is rounded to nine decimals — a tenth of a millimetre — because a
 * mean over thirteen readings and a mean over seven hundred of the *same* point
 * differ in the last bit of a double. Rounding here rather than loosening the
 * comparison keeps every other field exact, which is where a real difference
 * would show up.
 */
function shapeOf(fixes: readonly Fix[]) {
  const round = (degrees: number) => Number(degrees.toFixed(9));
  return segmentFixes(fixes, DEFAULT_SEGMENT_CONFIG).segments.map((segment) => ({
    id: segment.id,
    kind: segment.kind,
    startedAt: segment.startedAt,
    endedAt: segment.endedAt,
    where: segment.kind === 'stay' ? { lat: round(segment.center.lat), lon: round(segment.center.lon) } : null,
    distanceM: segment.kind === 'move' ? Math.round(segment.distanceM) : null,
  }));
}

describe('an afternoon at a desk', () => {
  it('keeps the arrival and the departure and nothing in between, in the archive', () => {
    const fixes = still(0, T0, 60 * MINUTE);

    const compacted = compactFixes(fixes, ARCHIVE);

    expect(fixes).toHaveLength(361);
    expect(times(compacted)).toEqual([0, 60 * MINUTE]);
  });

  it('keeps a skeleton in the live buffer, because today is folded again', () => {
    const fixes = still(0, T0, 60 * MINUTE);

    const compacted = compactFixes(fixes, LIVE);

    // One every five minutes rather than one every ten seconds: a reduction of
    // ~96%, and the run is still a run.
    expect(compacted.length).toBeLessThan(20);
    expect(times(compacted)[0]).toBe(0);
    expect(times(compacted).at(-1)).toBe(60 * MINUTE);
  });

  /**
   * The property the whole feature stands on. `gapMs` closes whatever is open,
   * and the day then stops until the next reading — so a compaction that leaves
   * a hole wider than the tolerance does not shrink an afternoon, it deletes
   * one.
   */
  it('never leaves a hole the fold would read as a gap', () => {
    const fixes = still(0, T0, 8 * 60 * MINUTE);

    const compacted = compactFixes(fixes, LIVE);

    expect(widestGapMs(compacted)).toBeLessThanOrEqual(LIVE.holdMs ?? Infinity);
    expect(widestGapMs(compacted)).toBeLessThan(DEFAULT_SEGMENT_CONFIG.gapMs);
  });

  it('leaves a hole the phone made, rather than closing it', () => {
    // Two hours of desk, then nothing for half an hour, then more desk. The
    // silence is the phone's; compaction must not report readings across it and
    // must not be blamed for it either.
    const fixes = [...still(0, T0, 120 * MINUTE), ...still(0, T0 + 150 * MINUTE, 120 * MINUTE)];

    const compacted = compactFixes(fixes, LIVE);

    expect(widestGapMs(compacted)).toBe(30 * MINUTE);
    expect(times(compacted)).toContain(120 * MINUTE);
    expect(times(compacted)).toContain(150 * MINUTE);
  });
});

describe('what it refuses to touch', () => {
  it('leaves a journey exactly as it was', () => {
    const walk = leg({ fromM: 0, startAt: T0, durationMs: 20 * MINUTE, speedMps: 1.4 });

    // Identity, not a copy: nothing was dropped, so a caller can skip its write
    // without comparing a few thousand readings.
    expect(compactFixes(walk, ARCHIVE)).toBe(walk);
  });

  it('leaves a pause too short to be a stay', () => {
    // Ninety seconds at a crossing is below `minStayMs`, so the timeline will
    // never draw it as a stop and there is nothing here worth thinning.
    const pause = still(0, T0, 90_000);

    expect(compactFixes(pause, ARCHIVE)).toBe(pause);
  });

  it('leaves a run with nothing inside it', () => {
    const both = [fix(T0, 0), fix(T0 + 60 * MINUTE, 0)];

    expect(compactFixes(both, ARCHIVE)).toBe(both);
  });

  it('leaves a drive, where every reading is a run of its own', () => {
    // 15 m/s sampled every ten seconds is 150 m a step: no two readings are
    // ever the same spot, so there is no run to be inside of.
    const drive = leg({ fromM: 0, startAt: T0, durationMs: 20 * MINUTE, speedMps: 15 });

    expect(compactFixes(drive, ARCHIVE)).toBe(drive);
  });

  it('has nothing to do with an empty buffer', () => {
    expect(compactFixes([], ARCHIVE)).toEqual([]);
  });

  /**
   * The radius is measured from the run's first reading rather than from the
   * previous one, and this is why: metre-at-a-time drift would otherwise be
   * followed across a car park, and a slow amble would compact to its endpoints
   * as though it had never happened.
   *
   * 0.6 m/s is just above `stillSpeedMps`, so this is the slowest thing the fold
   * will still call moving — it leaves a 60 m circle in a hundred seconds, well
   * inside `minRunMs`, and so is never a run worth thinning.
   */
  it('does not follow a drift out of the circle', () => {
    const amble = leg({ fromM: 0, startAt: T0, durationMs: 20 * MINUTE, speedMps: 0.6 });

    expect(compactFixes(amble, ARCHIVE)).toBe(amble);
  });

  it('breaks a run at an excursion and keeps every reading of it', () => {
    const excursion = chain(
      still(0, T0, 30 * MINUTE),
      leg({ fromM: 0, startAt: T0 + 30 * MINUTE, durationMs: 5 * MINUTE, speedMps: 1.4 }),
      still(420, T0 + 35 * MINUTE, 30 * MINUTE),
    );

    const compacted = compactFixes(excursion, ARCHIVE);
    const beyond = (fixes: readonly Fix[], radiusM: number) =>
      fixes.filter((one) => distanceM(one, excursion[0] as Fix) > radiusM && one.at < T0 + 35 * MINUTE);

    // Every reading of the walk that is actually clear of the desk survives.
    expect(beyond(compacted, ARCHIVE.stillRadiusM)).toEqual(beyond(excursion, ARCHIVE.stillRadiusM));
    // The desk is down to its two ends, and the second desk is a run of its own
    // rather than a continuation of the first.
    expect(compacted.filter((one) => distanceM(one, excursion[0] as Fix) <= ARCHIVE.stillRadiusM)).toHaveLength(2);
    expect(compacted.at(-1)).toEqual(excursion.at(-1));
  });

  /**
   * The archive's wide radius absorbs the first readings of a departure — they
   * are inside the circle, so they are inside the run. That is why the buffer
   * gets the tight one: what the archive can afford to lose, because a frozen
   * day's segments are already its record, today cannot.
   */
  it('keeps the start of a journey in the buffer that the archive lets go', () => {
    const leaving = chain(
      still(0, T0, 30 * MINUTE),
      leg({ fromM: 0, startAt: T0 + 30 * MINUTE, durationMs: 5 * MINUTE, speedMps: 1.4 }),
    );
    const firstMetres = (fixes: readonly Fix[]) =>
      fixes.filter((one) => one.at > T0 + 30 * MINUTE && one.at <= T0 + 30 * MINUTE + 40_000).length;

    expect(firstMetres(compactFixes(leaving, LIVE))).toBe(firstMetres(leaving));
    expect(firstMetres(compactFixes(leaving, ARCHIVE))).toBeLessThan(firstMetres(leaving));
  });

  /**
   * The last reading inside the circle is the departure, even when the walk has
   * already begun by the time it was taken. It is the last moment the phone is
   * known to have been there, which is exactly what a departure is — so a run
   * can end a sample interval into the journey, and that is the honest answer
   * rather than an off-by-one.
   */
  it('ends a run at the last reading still inside the circle', () => {
    const leaving = chain(
      still(0, T0, 30 * MINUTE),
      leg({ fromM: 0, startAt: T0 + 30 * MINUTE, durationMs: 60_000, speedMps: 1.4 }),
    );

    const compacted = compactFixes(leaving, LIVE);
    const inCircle = compacted.filter((one) => distanceM(one, leaving[0] as Fix) <= LIVE.stillRadiusM);

    // 14 m along, at ten seconds past the half hour: still within the buffer's
    // 25 m, so still the reading that ends the run. The next one is 28 m out and
    // begins a run of its own.
    expect(inCircle.at(-1)?.at).toBe(T0 + 30 * MINUTE + 10_000);
  });
});

describe('the day it leaves behind', () => {
  /** Walk somewhere, sit for two hours, walk home. The ordinary shape of one. */
  const errand = chain(
    leg({ fromM: 0, startAt: T0, durationMs: 10 * MINUTE, speedMps: 1.4 }),
    still(legEndM({ fromM: 0, durationMs: 10 * MINUTE, speedMps: 1.4 }), T0 + 10 * MINUTE, 120 * MINUTE),
    leg({
      fromM: legEndM({ fromM: 0, durationMs: 10 * MINUTE, speedMps: 1.4 }),
      startAt: T0 + 130 * MINUTE,
      durationMs: 10 * MINUTE,
      speedMps: 1.4,
    }),
  );

  it('folds to the same timeline it did before', () => {
    const compacted = compactFixes(errand, LIVE);

    expect(compacted.length).toBeLessThan(errand.length / 4);
    expect(shapeOf(compacted)).toEqual(shapeOf(errand));
  });

  it('folds to the same timeline away from the origin, where a scaled coordinate would show', () => {
    const elsewhere = shifted(errand, ELSEWHERE);

    expect(shapeOf(compactFixes(elsewhere, LIVE))).toEqual(shapeOf(elsewhere));
  });

  it('settles: compacting what was compacted changes nothing', () => {
    const once = compactFixes(errand, LIVE);

    expect(compactFixes(once, LIVE)).toBe(once);
  });

  /**
   * The export's honesty. A compacted archive is a smaller CSV *by design*, and
   * the difference between "smaller because the readings were redundant" and
   * "smaller because a bug ate them" has to be something a test can see.
   */
  it('still covers the same span, and invents nothing', () => {
    const compacted = compactFixes(errand, ARCHIVE);

    expect(compacted[0]).toEqual(errand[0]);
    expect(compacted.at(-1)).toEqual(errand.at(-1));
    for (const one of compacted) expect(errand).toContain(one);
  });
});

describe('the two configurations', () => {
  it('are the segmenter thresholds, not numbers of their own', () => {
    expect(ARCHIVE).toEqual<CompactionConfig>({
      stillRadiusM: DEFAULT_SEGMENT_CONFIG.minMoveDistanceM,
      holdMs: null,
      minRunMs: DEFAULT_SEGMENT_CONFIG.minStayMs,
    });
    expect(LIVE).toEqual<CompactionConfig>({
      stillRadiusM: DEFAULT_SEGMENT_CONFIG.pathResolutionM,
      // Comfortably inside `gapMs`, which is the only thing the number has to be.
      holdMs: DEFAULT_SEGMENT_CONFIG.gapMs / 3,
      minRunMs: DEFAULT_SEGMENT_CONFIG.minStayMs,
    });
  });

  /**
   * The archive's radius has to clear the tracking preset's distance filter or
   * no run can ever hold a third reading — iOS only delivers an update once the
   * phone has moved further than the filter from the last one, so consecutive
   * readings are already that far apart. Both halves used `pathResolutionM`,
   * which is 25 m, which is exactly the default preset's filter: every reading
   * its own run, nothing ever dropped, and every test in this file passing.
   */
  it('clears the distance filter of every preset that samples densely', () => {
    // `TRACKING_PRESETS` lives in `services` and `core` may not import it, so
    // the numbers are restated: balanced 25 m, detailed 10 m, saver 100 m.
    expect(ARCHIVE.stillRadiusM).toBeGreaterThan(25);
    expect(ARCHIVE.stillRadiusM).toBeGreaterThan(10);

    // A stream sampled every 25 m — the default preset standing still while GPS
    // wanders — forms a run instead of a sequence of singletons.
    const wander = [fix(T0, 0), fix(T0 + 5 * MINUTE, 26), fix(T0 + 10 * MINUTE, 4), fix(T0 + 15 * MINUTE, 30)];

    expect(compactFixes(wander, ARCHIVE)).toHaveLength(2);
    // ...and the buffer, whose circle is the filter itself, leaves it alone.
    expect(compactFixes(wander, LIVE)).toBe(wander);
  });
});
