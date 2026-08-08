import { renderHook, waitFor } from '@testing-library/react-native';

import { journeyLabelId, type JourneyLabel } from '@/core/segments';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

import { useJourneyLabels } from './useJourneyLabels';

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

function label(startedAt: number, name: string): JourneyLabel {
  return { id: journeyLabelId(startedAt), label: name, mode: null, startedAt, endedAt: startedAt + 30 * 60_000 };
}

beforeEach(async () => {
  await writeJson(STORAGE_KEYS.journeyLabels, []);
});

/**
 * Merging rows into one journey was built and then taken out again: joining two
 * rows and taking them apart is not the shape of the problem, and half a
 * feature is worse than none.
 *
 * Taking it out has to take the merges with it. A merge was stored as a label
 * with no name over a span, so a build without the feature would have gone on
 * applying every merge ever made with no way to undo any of them — rows joined
 * together for good, by a button that no longer exists.
 */
describe('merges made by an earlier build', () => {
  it('are dropped on the first launch without the feature', async () => {
    const merge: JourneyLabel = { ...label(T0, ''), mode: null };
    await writeJson(STORAGE_KEYS.journeyLabels, [merge]);

    const { result } = await renderHook(() => useJourneyLabels());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.labels).toEqual([]);
  });

  it('are gone from the store too, not merely hidden', async () => {
    await writeJson(STORAGE_KEYS.journeyLabels, [label(T0, '')]);

    const { result } = await renderHook(() => useJourneyLabels());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await waitFor(async () => expect(await readJson(STORAGE_KEYS.journeyLabels)).toEqual([]));
  });

  // Naming a journey was never the part that did not work, and a name is the
  // one thing here nobody could reconstruct.
  it('leave the names alone', async () => {
    await writeJson(STORAGE_KEYS.journeyLabels, [label(T0, ''), label(T0 + 60 * 60_000, 'The school run')]);

    const { result } = await renderHook(() => useJourneyLabels());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.labels.map((one) => one.label)).toEqual(['The school run']);
  });

  it('leaves a store of names untouched', async () => {
    const names = [label(T0, 'Commute'), label(T0 + 60 * 60_000, 'The school run')];
    await writeJson(STORAGE_KEYS.journeyLabels, names);

    const { result } = await renderHook(() => useJourneyLabels());
    await waitFor(() => expect(result.current.ready).toBe(true));

    expect(result.current.labels).toHaveLength(2);
  });
});
