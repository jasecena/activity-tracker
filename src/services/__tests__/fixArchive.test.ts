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
 */

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const HOUR = 3_600_000;

function fix(at: number) {
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

  await pruneBuffer(T0 + 2 * HOUR, UTC);

  expect((await readBuffer()).map((one) => one.at)).toEqual([T0 + 5 * HOUR]);
  expect((await readArchive()).map((one) => one.at)).toEqual([T0, T0 + HOUR]);
});

it('offers every reading still on the phone, oldest first', async () => {
  await appendFixes([fix(T0), fix(T0 + HOUR), fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0 + 2 * HOUR, UTC);

  expect((await allFixes()).map((one) => one.at)).toEqual([T0, T0 + HOUR, T0 + 5 * HOUR]);
});

it('accumulates across several freezes rather than replacing', async () => {
  await appendFixes([fix(T0)]);
  await pruneBuffer(T0 + HOUR, UTC);
  await appendFixes([fix(T0 + 2 * HOUR)]);
  await pruneBuffer(T0 + 3 * HOUR, UTC);

  expect((await readArchive()).map((one) => one.at)).toEqual([T0, T0 + 2 * HOUR]);
});

it('does nothing when there is nothing old enough to prune', async () => {
  await appendFixes([fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0, UTC);

  expect(await readArchive()).toEqual([]);
  expect(await readBuffer()).toHaveLength(1);
});

// An archive outliving the days it describes would be a store of coordinates
// for a period the app says it has forgotten. "Keep 30 days" means one thing.
it('is trimmed by the same cutoff as the day log', async () => {
  await appendFixes([fix(T0), fix(T0 + HOUR), fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0 + 6 * HOUR, UTC);

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

  await pruneBuffer(T0 + 3 * DAY, UTC);

  expect(await archivedDayKeys()).toEqual(['2026-01-05', '2026-01-06', '2026-01-07']);
});

it('counts what is archived without reading it all at once', async () => {
  await appendFixes([fix(T0), fix(T0 + HOUR), fix(T0 + 5 * HOUR)]);
  await pruneBuffer(T0 + 6 * HOUR, UTC);

  expect(await archivedCount()).toBe(3);
});

// Freezing can be interrupted and rerun, so appending the same day twice must
// not duplicate it — the timestamps are what tell one reading from another.
it('merges into a day it has already written rather than duplicating it', async () => {
  await appendFixes([fix(T0)]);
  await pruneBuffer(T0 + HOUR, UTC);
  await appendFixes([fix(T0), fix(T0 + 2 * HOUR)]);
  await pruneBuffer(T0 + 3 * HOUR, UTC);

  expect((await readArchive()).map((one) => one.at)).toEqual([T0, T0 + 2 * HOUR]);
});

// Whole days go by their key, which is why the key is a date: YYYY-MM-DD
// compares as a string exactly as it compares as a day.
it('drops whole days past the cutoff and keeps the rest', async () => {
  const DAY = 24 * HOUR;
  await appendFixes([fix(T0), fix(T0 + DAY), fix(T0 + 2 * DAY)]);
  await pruneBuffer(T0 + 3 * DAY, UTC);

  await trimArchive(T0 + DAY, UTC);

  expect(await archivedDayKeys()).toEqual(['2026-01-06', '2026-01-07']);
});
