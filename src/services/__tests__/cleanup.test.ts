import type { MoveSegment, Segment, StaySegment } from '@/core/segments';

import { isPlausible, removeImpossiblePositions } from '../cleanup';
import { archiveKeyFor, readJson, STORAGE_KEYS, writeJson } from '../storage';

/**
 * A one-off pass that deletes coordinates that cannot be real, put there by two
 * bugs that are now fixed at the source: a merged stay's centre came out scaled
 * by (n + merges) / n, and `currentFix` believed whatever it was handed.
 *
 * It deletes things, so the boundaries are worth pinning: what it takes, what
 * it leaves, and that it never runs twice.
 *
 * Coordinates here are round numbers on purpose. A plausible latitude in a
 * committed file is a record of where its author was — see `.gitleaks.toml`.
 */

/** Inside the radius by any measure; the same coarse centre the pass uses. */
const NEAR = { lat: -37.81, lon: 144.96 };
/** Nine degrees of longitude away — around 790 km at this latitude. */
const FAR = { lat: -37.81, lon: 153.96 };

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

function fix(at: number, where: { lat: number; lon: number }) {
  return { ...where, at, accuracyM: 8, reportedSpeedMps: null, altitudeM: null };
}

function point(at: number, where: { lat: number; lon: number }, speedMps: number | null = 1.4) {
  return { ...where, at, speedMps };
}

function stay(id: string, center: { lat: number; lon: number }): StaySegment {
  return {
    kind: 'stay',
    id,
    startedAt: T0,
    endedAt: T0 + 600_000,
    fixCount: 5,
    center,
    radiusM: 20,
  } as StaySegment;
}

function move(id: string, path: ReturnType<typeof point>[]): MoveSegment {
  return {
    kind: 'move',
    id,
    startedAt: T0,
    endedAt: T0 + 600_000,
    fixCount: path.length,
    distanceM: 999_999,
    mode: 'walk',
    label: null,
    modeIsManual: false,
    path,
    topSpeedMps: 400,
  } as MoveSegment;
}

beforeEach(async () => {
  for (const key of Object.values(STORAGE_KEYS)) await writeJson(key, null);
  await writeJson(STORAGE_KEYS.cleanedFarPositions, false);
});

describe('what counts as possible', () => {
  it('keeps what is close', () => {
    expect(isPlausible(NEAR)).toBe(true);
  });

  it('drops what is most of a thousand kilometres away', () => {
    expect(isPlausible(FAR)).toBe(false);
  });
});

it('takes the far readings out of the live buffer and leaves the rest', async () => {
  await writeJson(STORAGE_KEYS.fixBuffer, [fix(T0, NEAR), fix(T0 + 1_000, FAR), fix(T0 + 2_000, NEAR)]);

  const report = await removeImpossiblePositions();

  expect(report.fixes).toBe(1);
  expect(await readJson(STORAGE_KEYS.fixBuffer)).toHaveLength(2);
});

// Previous days keep their readings in the archive, a key per day, and they
// need the same pass — the bad ones did not all happen today.
it('takes them out of previous days too', async () => {
  await writeJson(archiveKeyFor('2026-01-05'), [fix(T0, NEAR), fix(T0 + 1_000, FAR)]);
  await writeJson(archiveKeyFor('2026-01-06'), [fix(T0, FAR)]);

  const report = await removeImpossiblePositions();

  expect(report.fixes).toBe(2);
  expect(await readJson(archiveKeyFor('2026-01-05'))).toHaveLength(1);
  // A day with nothing left goes, rather than sitting there as an empty entry.
  expect(await readJson(archiveKeyFor('2026-01-06'))).toBeNull();
});

// A frozen day keeps its segments and not its fixes, so there is nothing left
// to re-derive one from and it has to be repaired in place.
describe('a frozen day', () => {
  it('drops a stop whose only position is impossible', async () => {
    await writeJson(STORAGE_KEYS.dayLog, [stay('a', NEAR), stay('b', FAR)]);

    await removeImpossiblePositions();

    const kept = (await readJson<readonly Segment[]>(STORAGE_KEYS.dayLog)) ?? [];
    expect(kept.map((one) => one.id)).toEqual(['a']);
  });

  // Only the far points. A walk that acquired one impossible reading is still
  // a walk, and deleting the row would throw away an afternoon over a second.
  it('keeps a journey and trims the points that cannot be true', async () => {
    await writeJson(STORAGE_KEYS.dayLog, [
      move('m', [point(T0, NEAR), point(T0 + 10_000, FAR, 400), point(T0 + 20_000, NEAR)]),
    ]);

    await removeImpossiblePositions();

    const kept = (await readJson<readonly MoveSegment[]>(STORAGE_KEYS.dayLog)) ?? [];
    expect(kept).toHaveLength(1);
    expect(kept[0]?.path).toHaveLength(2);
    // Recomputed over what is left, so the leg out to sea and back stops being
    // most of the distance — and stops being the fastest thing you ever did.
    expect(kept[0]?.distanceM).toBeLessThan(1_000);
    expect(kept[0]?.topSpeedMps).toBeLessThan(10);
  });

  it('drops a journey with nothing left to draw', async () => {
    await writeJson(STORAGE_KEYS.dayLog, [move('m', [point(T0, FAR), point(T0 + 10_000, FAR)])]);

    await removeImpossiblePositions();

    expect(await readJson(STORAGE_KEYS.dayLog)).toEqual([]);
  });

  it('leaves a day that was always fine exactly as it was', async () => {
    const log = [stay('a', NEAR), move('m', [point(T0, NEAR), point(T0 + 10_000, NEAR)])];
    await writeJson(STORAGE_KEYS.dayLog, log);

    const report = await removeImpossiblePositions();

    expect(report.segments).toBe(0);
    expect(await readJson(STORAGE_KEYS.dayLog)).toEqual(log);
  });
});

it('forgets a place pinned to open water', async () => {
  await writeJson(STORAGE_KEYS.places, [
    { id: 'p1', name: 'Home', ...NEAR, radiusM: 80 },
    { id: 'p2', name: 'Nowhere', ...FAR, radiusM: 80 },
  ]);

  const report = await removeImpossiblePositions();

  expect(report.places).toBe(1);
  expect(await readJson<readonly { name: string }[]>(STORAGE_KEYS.places)).toEqual([
    expect.objectContaining({ name: 'Home' }),
  ]);
});

// A photograph is not wrong because the app was wrong about where it was taken.
it('clears a capture position without touching the capture', async () => {
  await writeJson(STORAGE_KEYS.media, [
    {
      id: 'm-1',
      kind: 'photo',
      capturedAt: T0,
      durationMs: null,
      fileName: 'a.jpg',
      thumbFileName: null,
      byteLength: 1,
      at: FAR,
      note: '',
    },
  ]);

  const report = await removeImpossiblePositions();

  const media = (await readJson<readonly { id: string; fileName: string; at: unknown }[]>(STORAGE_KEYS.media)) ?? [];
  expect(report.media).toBe(1);
  expect(media).toHaveLength(1);
  expect(media[0]?.fileName).toBe('a.jpg');
  expect(media[0]?.at).toBeNull();
});

// A marker, not an inspection. Re-running over clean data is harmless; a
// migration that runs on every launch is one nobody remembers to remove.
it('runs once and never again', async () => {
  await writeJson(STORAGE_KEYS.fixBuffer, [fix(T0, FAR)]);
  expect((await removeImpossiblePositions()).fixes).toBe(1);

  await writeJson(STORAGE_KEYS.fixBuffer, [fix(T0, FAR)]);
  expect((await removeImpossiblePositions()).fixes).toBe(0);
  expect(await readJson(STORAGE_KEYS.fixBuffer)).toHaveLength(1);
});
