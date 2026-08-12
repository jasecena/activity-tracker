import { DEFAULT_SEGMENT_CONFIG } from '@/core/segments';

import { allFixes, appendFixes, archivedCount, pruneBuffer, readArchive, readBuffer, trimArchive } from '../fixBuffer';
import { archiveKeyFor, archivedDayKeys, removeKeys, STORAGE_KEYS, writeJson } from '../storage';

/**
 * Freezing a day prunes its raw fixes out of the buffer, and what was pruned
 * used to be thrown away. That is why "export everything" produced a file with
 * today in it and nothing else — the readings behind every earlier day were
 * gone, not filtered.
 *
 * Nothing reads the archive to build a timeline. A frozen day's segments are
 * its record; this exists so the export can be honest.
 *
 * Freezing also compacts, which is why every fixture below is somewhere
 * different: what the arithmetic does to a stationary run belongs in
 * `core/compact`, and these tests are about the archive. The compaction that is
 * tested here is the wiring — that the two halves get the two configurations.
 */

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const HOUR = 3_600_000;
const CONFIG = DEFAULT_SEGMENT_CONFIG;

/**
 * A reading an hour of longitude away from the one before it — about 1.1 km at
 * the equator, so no two of these are ever the same spot and nothing here forms
 * a run to compact. The equator, and nowhere real: see
 * `core/segments/__tests__/fixtures.ts`.
 */
function fix(at: number) {
  return { lat: 0, lon: ((at - T0) / HOUR) * 0.01, at, accuracyM: 8, reportedSpeedMps: null, altitudeM: null };
}

/** A reading at one fixed spot, for the runs compaction is supposed to thin. */
function stillFix(at: number) {
  return { lat: 0, lon: 0, at, accuracyM: 8, reportedSpeedMps: null, altitudeM: null };
}

/** UTC, so a day key here is the calendar day the fixtures read as. */
const UTC = 0;

beforeEach(async () => {
  await writeJson(STORAGE_KEYS.fixBuffer, []);
  await eraseArchive();
});

/** Removed, not emptied: an empty day still shows up in `archivedDayKeys`. */
async function eraseArchive(): Promise<void> {
  await removeKeys((await archivedDayKeys()).map(archiveKeyFor));
}

it('keeps what it prunes instead of dropping it', async () => {
  await appendFixes([fix(T0), fix(T0 + HOUR), fix(T0 + 5 * HOUR)]);

  await pruneBuffer(T0 + 2 * HOUR, UTC, CONFIG);

  expect((await readBuffer()).map((one) => one.at)).toEqual([T0 + 5 * HOUR]);
  expect((await readArchive()).map((one) => one.at)).toEqual([T0, T0 + HOUR]);
});

it('offers every reading still on the phone, oldest first', async () => {
  await appendFixes([fix(T0), fix(T0 + HOUR), fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0 + 2 * HOUR, UTC, CONFIG);

  expect((await allFixes()).map((one) => one.at)).toEqual([T0, T0 + HOUR, T0 + 5 * HOUR]);
});

it('accumulates across several freezes rather than replacing', async () => {
  await appendFixes([fix(T0)]);
  await pruneBuffer(T0 + HOUR, UTC, CONFIG);
  await appendFixes([fix(T0 + 2 * HOUR)]);
  await pruneBuffer(T0 + 3 * HOUR, UTC, CONFIG);

  expect((await readArchive()).map((one) => one.at)).toEqual([T0, T0 + 2 * HOUR]);
});

it('does nothing when there is nothing old enough to prune', async () => {
  await appendFixes([fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0, UTC, CONFIG);

  expect(await readArchive()).toEqual([]);
  expect(await readBuffer()).toHaveLength(1);
});

// An archive outliving the days it describes would be a store of coordinates
// for a period the app says it has forgotten. "Keep 30 days" means one thing.
it('is trimmed by the same cutoff as the day log', async () => {
  await appendFixes([fix(T0), fix(T0 + HOUR), fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0 + 6 * HOUR, UTC, CONFIG);

  await trimArchive(T0 + 2 * HOUR, UTC);

  expect((await readArchive()).map((one) => one.at)).toEqual([T0 + 5 * HOUR]);
});

// The reason the archive is a key per day rather than one blob: freezing must
// write the day that just ended, not a year of them. A single entry meant
// 337 KB rewritten on day one and 120 MB a year later, sealed as hex, on the
// thread that draws the screen — the same shape as the failure that made the
// media gallery unusable.
it('writes one entry per day rather than one for everything', async () => {
  const DAY = 24 * HOUR;
  await appendFixes([fix(T0), fix(T0 + DAY), fix(T0 + 2 * DAY), fix(T0 + 3 * DAY)]);

  await pruneBuffer(T0 + 3 * DAY, UTC, CONFIG);

  expect(await archivedDayKeys()).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
});

it('counts what is archived without reading it all at once', async () => {
  await appendFixes([fix(T0), fix(T0 + HOUR), fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0 + 6 * HOUR, UTC, CONFIG);

  expect(await archivedCount()).toBe(3);
});

// Freezing can be interrupted and rerun, so appending the same day twice must
// not duplicate it — the timestamps are what tell one reading from another.
it('merges into a day it has already written rather than duplicating it', async () => {
  await appendFixes([fix(T0)]);
  await pruneBuffer(T0 + HOUR, UTC, CONFIG);
  await appendFixes([fix(T0), fix(T0 + 2 * HOUR)]);
  await pruneBuffer(T0 + 3 * HOUR, UTC, CONFIG);

  expect((await readArchive()).map((one) => one.at)).toEqual([T0, T0 + 2 * HOUR]);
});

/**
 * Compaction, wired up: the two halves of the prune get the two shapes.
 *
 * An hour on a sofa is hundreds of readings saying one thing between them, and
 * the archive is the store nothing else bounds — retention reaches it, but only
 * at the far end, and a phone that never moves still fills it.
 */
describe('standing still', () => {
  /** Two hours at one spot, sampled the way the tracker samples. */
  function sofa(from: number, durationMs: number) {
    const fixes = [];
    for (let elapsed = 0; elapsed <= durationMs; elapsed += 10_000) fixes.push(stillFix(from + elapsed));
    return fixes;
  }

  it('reaches the archive as an arrival and a departure', async () => {
    await appendFixes(sofa(T0, 2 * HOUR));

    await pruneBuffer(T0 + 3 * HOUR, UTC, CONFIG);

    expect(await archivedCount()).toBe(2);
    expect((await readArchive()).map((one) => one.at)).toEqual([T0, T0 + 2 * HOUR]);
  });

  /**
   * The buffer is thinned on a call that prunes nothing at all, which is the
   * point: a day spent at a desk with the app open fills the buffer whether or
   * not midnight has passed since the last freeze.
   */
  it('is thinned in the buffer to a skeleton the fold can still see', async () => {
    await appendFixes(sofa(T0, 2 * HOUR));

    await pruneBuffer(T0, UTC, CONFIG);

    const buffered = await readBuffer();
    expect(buffered.length).toBeLessThan(30);
    // Both ends, and never a hole `gapMs` would close the day at.
    expect(buffered[0]?.at).toBe(T0);
    expect(buffered.at(-1)?.at).toBe(T0 + 2 * HOUR);
    for (let at = 1; at < buffered.length; at += 1) {
      expect((buffered[at]?.at ?? 0) - (buffered[at - 1]?.at ?? 0)).toBeLessThan(CONFIG.gapMs);
    }
  });
});

// Whole days go by their key, which is why the key is a date: YYYY-MM-DD
// compares as a string exactly as it compares as a day.
it('drops whole days past the cutoff and keeps the rest', async () => {
  const DAY = 24 * HOUR;
  await appendFixes([fix(T0), fix(T0 + DAY), fix(T0 + 2 * DAY)]);
  await pruneBuffer(T0 + 3 * DAY, UTC, CONFIG);

  await trimArchive(T0 + DAY, UTC);

  expect(await archivedDayKeys()).toEqual(['2026-01-06', '2026-01-07']);
});
