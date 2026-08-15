import { renderHook, waitFor } from '@testing-library/react-native';

import { EARTH_RADIUS_M, type Fix } from '@/core/geo';
import { journeyLabelId, type JourneyLabel, type Segment } from '@/core/segments';
import { DEFAULT_SETTINGS } from '@/services/settings';
import { STORAGE_KEYS, writeJson } from '@/services/storage';

import { useTimeline } from './useTimeline';

/**
 * Pinned, for the reason `TabShell.test.tsx` gives: a day is a wall-clock idea,
 * and "three days ago" has to mean the same thing whenever the suite runs.
 */
jest.mock('@/services/clock', () => ({
  now: () => Date.UTC(2026, 7, 8, 12, 0, 0),
  tzOffsetMinutes: () => 0,
  // Durations, not instants. Pinning the wall clock above would otherwise pin
  // this too, and every measured span would come out as exactly zero.
  monotonicNow: () => performance.now(),
}));

const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);
const DAY = 24 * 60 * 60_000;
const DEG_PER_METRE_LAT = 1 / ((EARTH_RADIUS_M * Math.PI) / 180);

/** A stop then a walk, at the equator. See `fixtures.ts` for why not a real place. */
function aWalk(startingAt: number): Fix[] {
  const fixes: Fix[] = [];
  for (let elapsed = 0; elapsed <= 10 * 60_000; elapsed += 60_000) {
    fixes.push({ lat: 0, lon: 0, at: startingAt + elapsed, accuracyM: 8, reportedSpeedMps: null, altitudeM: null });
  }
  for (let elapsed = 0; elapsed <= 20 * 60_000; elapsed += 10_000) {
    fixes.push({
      lat: ((1.4 * elapsed) / 1000) * DEG_PER_METRE_LAT,
      lon: 0,
      at: startingAt + 10 * 60_000 + elapsed,
      accuracyM: 8,
      reportedSpeedMps: null,
      altitudeM: null,
    });
  }
  return fixes;
}

/**
 * Hoisted, never inline.
 *
 * `labels` is a dependency of the fold's effect, so a fresh array literal in
 * the render callback re-runs it on every render, which sets state, which
 * renders again. The app passes the array straight out of `useState`, so this
 * is a property of the test rather than of the hook — but it hangs just as
 * hard, and it hangs silently.
 */
const NO_PURPOSES: never[] = [];
const NO_CLAIMS: never[] = [];
const NO_LABELS: readonly [] = [];

/** Only a move carries a name — a stay is named by the place it is at. */
function namesOf(segments: readonly Segment[]): readonly string[] {
  return segments.flatMap((one) => (one.kind === 'move' && one.label ? [one.label] : []));
}

beforeEach(async () => {
  await writeJson(STORAGE_KEYS.fixBuffer, []);
  await writeJson(STORAGE_KEYS.dayLog, []);
});

/**
 * Naming and merging reach days that have already been frozen.
 *
 * They did not, and the failure was invisible in the worst way: the label was
 * stored perfectly, and the row came back exactly as it had been. Labels were
 * applied to the live day alone, on the reasoning that a label covering nothing
 * emits nothing — true, and beside the point, because history never had labels
 * applied to it at all.
 */
describe('a journey named on a day that is already frozen', () => {
  it('shows the name on the row in history', async () => {
    const threeDaysAgo = NOW - 3 * DAY;
    await writeJson(STORAGE_KEYS.fixBuffer, aWalk(threeDaysAgo));

    const label: JourneyLabel = {
      id: journeyLabelId(threeDaysAgo + 10 * 60_000),
      label: 'The school run',
      mode: null,
      startedAt: threeDaysAgo + 10 * 60_000,
      endedAt: threeDaysAgo + 30 * 60_000,
    };

    const labels = [label];
    const { result } = await renderHook(() => useTimeline(DEFAULT_SETTINGS, labels, NO_CLAIMS, NO_PURPOSES, true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await waitFor(() =>
      expect(namesOf(result.current.history.flatMap((day) => day.segments))).toContain('The school run'),
    );
  });

  // A label swallows the rows inside its span — the stays in the middle of a
  // journey are part of the journey. Same code path as the name above, and it
  // was broken in the same place, for the same reason.
  it('collapses the rows inside a labelled span', async () => {
    const threeDaysAgo = NOW - 3 * DAY;
    await writeJson(STORAGE_KEYS.fixBuffer, aWalk(threeDaysAgo));

    const unlabelled = await renderHook(() => useTimeline(DEFAULT_SETTINGS, NO_LABELS, NO_CLAIMS, NO_PURPOSES, true));
    await waitFor(() => expect(unlabelled.result.current.ready).toBe(true));
    const before = unlabelled.result.current.history.flatMap((day) => day.segments).length;
    expect(before).toBeGreaterThan(1);

    const span: JourneyLabel = {
      id: journeyLabelId(threeDaysAgo),
      label: 'The whole outing',
      mode: null,
      startedAt: threeDaysAgo,
      endedAt: threeDaysAgo + 30 * 60_000,
    };

    const labels = [span];
    const { result } = await renderHook(() => useTimeline(DEFAULT_SETTINGS, labels, NO_CLAIMS, NO_PURPOSES, true));
    await waitFor(() => expect(result.current.ready).toBe(true));

    await waitFor(() => expect(result.current.history.flatMap((day) => day.segments).length).toBeLessThan(before));
  });

  // The live day must keep working exactly as it did — the fix adds a second
  // application, it does not move the first one.
  it('still labels today', async () => {
    const startedAt = NOW - 40 * 60_000;
    await writeJson(STORAGE_KEYS.fixBuffer, aWalk(startedAt));

    const label: JourneyLabel = {
      id: journeyLabelId(startedAt + 10 * 60_000),
      label: 'This morning',
      mode: null,
      startedAt: startedAt + 10 * 60_000,
      endedAt: startedAt + 30 * 60_000,
    };

    const labels = [label];
    const { result } = await renderHook(() => useTimeline(DEFAULT_SETTINGS, labels, NO_CLAIMS, NO_PURPOSES, true));
    await waitFor(() => expect(namesOf(result.current.today)).toContain('This morning'));
  });
});
