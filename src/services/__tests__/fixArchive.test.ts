import { allFixes, appendFixes, pruneBuffer, readArchive, readBuffer, trimArchive } from '../fixBuffer';
import { STORAGE_KEYS, writeJson } from '../storage';

/**
 * Freezing a day prunes its raw fixes out of the buffer, and what was pruned
 * used to be thrown away. That is why "export everything" produced a file with
 * today in it and nothing else — the readings behind every earlier day were
 * gone, not filtered.
 *
 * Nothing reads the archive to build a timeline. A frozen day's segments are
 * its record; this exists so the export can be honest.
 */

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const HOUR = 3_600_000;

function fix(at: number) {
  return { lat: 0, lon: 0, at, accuracyM: 8, reportedSpeedMps: null, altitudeM: null };
}

beforeEach(async () => {
  await writeJson(STORAGE_KEYS.fixBuffer, []);
  await writeJson(STORAGE_KEYS.fixArchive, []);
});

it('keeps what it prunes instead of dropping it', async () => {
  await appendFixes([fix(T0), fix(T0 + HOUR), fix(T0 + 5 * HOUR)]);

  await pruneBuffer(T0 + 2 * HOUR);

  expect((await readBuffer()).map((one) => one.at)).toEqual([T0 + 5 * HOUR]);
  expect((await readArchive()).map((one) => one.at)).toEqual([T0, T0 + HOUR]);
});

it('offers every reading still on the phone, oldest first', async () => {
  await appendFixes([fix(T0), fix(T0 + HOUR), fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0 + 2 * HOUR);

  expect((await allFixes()).map((one) => one.at)).toEqual([T0, T0 + HOUR, T0 + 5 * HOUR]);
});

it('accumulates across several freezes rather than replacing', async () => {
  await appendFixes([fix(T0)]);
  await pruneBuffer(T0 + HOUR);
  await appendFixes([fix(T0 + 2 * HOUR)]);
  await pruneBuffer(T0 + 3 * HOUR);

  expect((await readArchive()).map((one) => one.at)).toEqual([T0, T0 + 2 * HOUR]);
});

it('does nothing when there is nothing old enough to prune', async () => {
  await appendFixes([fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0);

  expect(await readArchive()).toEqual([]);
  expect(await readBuffer()).toHaveLength(1);
});

// An archive outliving the days it describes would be a store of coordinates
// for a period the app says it has forgotten. "Keep 30 days" means one thing.
it('is trimmed by the same cutoff as the day log', async () => {
  await appendFixes([fix(T0), fix(T0 + HOUR), fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0 + 6 * HOUR);

  await trimArchive(T0 + 2 * HOUR);

  expect((await readArchive()).map((one) => one.at)).toEqual([T0 + 5 * HOUR]);
});
