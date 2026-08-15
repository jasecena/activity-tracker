import { act, renderHook, waitFor } from '@testing-library/react-native';

import type { StaySegment } from '@/core/segments';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

import { normalizePurposes, useVisitPurposes } from './useVisitPurposes';

jest.mock('@/services/storage', () => ({
  STORAGE_KEYS: { visitPurposes: 'visit-purposes' },
  readJson: jest.fn(async () => null),
  writeJson: jest.fn(async () => undefined),
}));

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const HOUR = 3_600_000;

function stay(startedAt: number, endedAt: number): StaySegment {
  return {
    kind: 'stay',
    id: `seg-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 20,
    center: { lat: 0, lon: 0 },
    radiusM: 8,
    purpose: null,
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  (readJson as jest.Mock).mockResolvedValue(null);
});

async function store() {
  const hook = await renderHook(() => useVisitPurposes());
  await waitFor(() => expect(hook.result.current.ready).toBe(true));
  return hook;
}

it('keeps why you were somewhere, against the stop it was about', async () => {
  const { result } = await store();

  await act(async () => result.current.set(stay(T0, T0 + HOUR), 'Groceries'));

  expect(result.current.purposes).toEqual([{ id: `v-${T0}`, purpose: 'Groceries', startedAt: T0, endedAt: T0 + HOUR }]);
  expect(writeJson).toHaveBeenLastCalledWith(STORAGE_KEYS.visitPurposes, result.current.purposes);
});

/** Clearing the field is how one is deleted — there is no separate button. */
it('removes it when the field is emptied', async () => {
  const { result } = await store();

  await act(async () => result.current.set(stay(T0, T0 + HOUR), 'Groceries'));
  await act(async () => result.current.set(stay(T0, T0 + HOUR), '   '));

  expect(result.current.purposes).toEqual([]);
});

/**
 * **An edit replaces everything the stop covers, not just the matching id.**
 *
 * A stationary claim can merge three stops that each had a purpose into one
 * stay, and then all three match it. Removing only the id would leave the other
 * two behind, so the row would go on reading as the new text *and* the two old
 * ones joined onto it — and typing again would never make it go away.
 */
it('collapses what a merge joined, rather than adding to it', async () => {
  const { result } = await store();

  await act(async () => result.current.set(stay(T0, T0 + HOUR), 'Groceries'));
  await act(async () => result.current.set(stay(T0 + HOUR, T0 + 2 * HOUR), 'Haircut'));
  expect(result.current.purposes).toHaveLength(2);

  // What the merged stay looks like, described in one go.
  await act(async () => result.current.set(stay(T0, T0 + 2 * HOUR), 'Errands'));

  expect(result.current.purposes).toEqual([
    { id: `v-${T0}`, purpose: 'Errands', startedAt: T0, endedAt: T0 + 2 * HOUR },
  ]);
});

it('forgets one by id', async () => {
  const { result } = await store();

  await act(async () => result.current.set(stay(T0, T0 + HOUR), 'Groceries'));
  await act(async () => result.current.forget(`v-${T0}`));

  expect(result.current.purposes).toEqual([]);
});

/**
 * Both ends required and `endedAt > startedAt`, exactly as `normalizeLabels`
 * requires them: a purpose is matched by its midpoint, which an open-ended range
 * has no honest answer for.
 */
describe('the trust boundary', () => {
  it('drops anything without a real range', () => {
    expect(
      normalizePurposes([
        { id: 'v-1', purpose: 'Groceries', startedAt: T0 },
        { id: 'v-2', purpose: 'Haircut', startedAt: T0, endedAt: T0 },
        { id: 'v-3', purpose: 'Met Sam', startedAt: T0, endedAt: Number.NaN },
      ]),
    ).toEqual([]);
  });

  it('drops one that says nothing', () => {
    expect(normalizePurposes([{ id: 'v-1', purpose: '  ', startedAt: T0, endedAt: T0 + HOUR }])).toEqual([]);
  });

  it('keeps a good one, oldest first', () => {
    const kept = normalizePurposes([
      { id: 'v-2', purpose: 'Haircut', startedAt: T0 + HOUR, endedAt: T0 + 2 * HOUR },
      { id: 'v-1', purpose: 'Groceries', startedAt: T0, endedAt: T0 + HOUR },
    ]);

    expect(kept.map((one) => one.purpose)).toEqual(['Groceries', 'Haircut']);
  });

  it('is empty for anything that is not a list', () => {
    expect(normalizePurposes(null)).toEqual([]);
    expect(normalizePurposes({ purposes: [] })).toEqual([]);
  });
});
