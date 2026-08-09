import { act, renderHook, waitFor } from '@testing-library/react-native';

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

/**
 * Correcting what a journey was.
 *
 * Mode is inferred from speed alone, so the app gets a slow cycle and a fast
 * walk mixed up sometimes. A correction is a label carrying a mode and no name
 * — which is why the sweep above had to learn the difference between "says
 * nothing" and "has no name".
 */
describe('correcting an activity type', () => {
  const journey = { startedAt: T0, endedAt: T0 + 30 * 60_000 } as never;

  it('stores the correction as a label over the journey it covers', async () => {
    const { result } = await renderHook(() => useJourneyLabels());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => result.current.setMode(journey, 'cycle'));

    expect(result.current.labels).toEqual([
      expect.objectContaining({ mode: 'cycle', label: '', startedAt: T0, endedAt: T0 + 30 * 60_000 }),
    ]);
  });

  /**
   * The bug this feature would otherwise have shipped with. The launch sweep
   * dropped every nameless label, and a correction is nameless by design — so
   * it would have vanished on the next launch, silently, while the app looked
   * like it had saved it.
   */
  it('survives the launch sweep that takes apart old merges', async () => {
    const { result } = await renderHook(() => useJourneyLabels());
    await waitFor(() => expect(result.current.ready).toBe(true));
    await act(async () => result.current.setMode(journey, 'cycle'));

    // A second launch, reading what the first one wrote.
    const relaunched = await renderHook(() => useJourneyLabels());
    await waitFor(() => expect(relaunched.result.current.ready).toBe(true));

    expect(relaunched.result.current.labels).toEqual([expect.objectContaining({ mode: 'cycle' })]);
  });

  it('replaces the correction rather than stacking a second one', async () => {
    const { result } = await renderHook(() => useJourneyLabels());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => result.current.setMode(journey, 'cycle'));
    await act(async () => result.current.setMode(journey, 'drive'));

    expect(result.current.labels).toEqual([expect.objectContaining({ mode: 'drive' })]);
  });

  // Reverting is the absence of the override, not another one: the detected
  // mode is re-derived from the fixes every fold, so there is nothing to keep a
  // copy of and nothing to restore.
  it('leaves nothing behind when the correction is taken back', async () => {
    const { result } = await renderHook(() => useJourneyLabels());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => result.current.setMode(journey, 'cycle'));
    await act(async () => result.current.setMode(journey, null));

    expect(result.current.labels).toEqual([]);
    await waitFor(async () => expect(await readJson(STORAGE_KEYS.journeyLabels)).toEqual([]));
  });

  it('keeps a name that was given, when the correction is taken back', async () => {
    await writeJson(STORAGE_KEYS.journeyLabels, [{ ...label(T0, 'The commute'), mode: 'drive' }]);

    const { result } = await renderHook(() => useJourneyLabels());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => result.current.setMode(journey, null));

    expect(result.current.labels).toEqual([expect.objectContaining({ label: 'The commute', mode: null })]);
  });
});
