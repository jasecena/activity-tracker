import { act, renderHook, waitFor } from '@testing-library/react-native';

import { stationaryClaimId, type StationaryClaim } from '@/core/segments';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

import { normalizeClaims, useStationaryClaims } from './useStationaryClaims';

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const HOUR = 3_600_000;
const HERE = { lat: 0, lon: 0 };

function claim(startedAt: number): StationaryClaim {
  return { id: stationaryClaimId(startedAt), startedAt, endedAt: startedAt + HOUR, at: HERE };
}

beforeEach(async () => {
  await writeJson(STORAGE_KEYS.stationaryClaims, []);
});

/**
 * The trust boundary.
 *
 * Nothing here is repaired, which is a different judgement from the one the
 * diary makes — `normalizeDayNotes` rebuilds an id from an instant and keeps a
 * recording that lost its duration, because a note is unreconstructable. A
 * claim is a correction over readings that are still sitting underneath it:
 * losing one costs a gesture, and the day it described is entirely intact
 * without it. Guessing at a broken one risks collapsing a stretch that was
 * never claimed.
 */
describe('reading what was stored', () => {
  it('keeps a whole claim and puts them in time order', () => {
    const kept = normalizeClaims([claim(T0 + 5 * HOUR), claim(T0)]);

    expect(kept.map((one) => one.startedAt)).toEqual([T0, T0 + 5 * HOUR]);
  });

  it('drops one with no end, which is the open window that put a journey on the wrong day', () => {
    expect(normalizeClaims([{ ...claim(T0), endedAt: undefined }])).toEqual([]);
    expect(normalizeClaims([{ ...claim(T0), endedAt: T0 - HOUR }])).toEqual([]);
  });

  it('drops one with nowhere to be', () => {
    expect(normalizeClaims([{ ...claim(T0), at: null }])).toEqual([]);
    expect(normalizeClaims([{ ...claim(T0), at: { lat: 'north', lon: 0 } }])).toEqual([]);
  });

  it('survives a store holding something that is not a list at all', () => {
    expect(normalizeClaims(null)).toEqual([]);
    expect(normalizeClaims('claims')).toEqual([]);
  });
});

describe('claiming and taking it back', () => {
  it('writes one through, and reads it again next launch', async () => {
    const { result } = await renderHook(() => useStationaryClaims());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => result.current.claim(T0, T0 + HOUR, HERE));

    await waitFor(() => expect(result.current.claims).toHaveLength(1));
    expect(await readJson<StationaryClaim[]>(STORAGE_KEYS.stationaryClaims)).toHaveLength(1);
  });

  /**
   * The id comes from the instant, so claiming the same stretch twice replaces
   * the claim rather than stacking a second one over the first.
   */
  it('replaces a claim over the same stretch rather than adding another', async () => {
    const { result } = await renderHook(() => useStationaryClaims());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => result.current.claim(T0, T0 + HOUR, HERE));
    await act(async () => result.current.claim(T0, T0 + 2 * HOUR, HERE));

    await waitFor(() => expect(result.current.claims).toHaveLength(1));
    expect(result.current.claims[0]?.endedAt).toBe(T0 + 2 * HOUR);
  });

  it('refuses a range that runs backwards', async () => {
    const { result } = await renderHook(() => useStationaryClaims());
    await waitFor(() => expect(result.current.ready).toBe(true));

    await act(async () => result.current.claim(T0 + HOUR, T0, HERE));

    expect(result.current.claims).toHaveLength(0);
  });

  it('forgets one, and the store forgets it too', async () => {
    await writeJson(STORAGE_KEYS.stationaryClaims, [claim(T0)]);
    const { result } = await renderHook(() => useStationaryClaims());
    await waitFor(() => expect(result.current.claims).toHaveLength(1));

    await act(async () => result.current.forget(stationaryClaimId(T0)));

    await waitFor(() => expect(result.current.claims).toHaveLength(0));
    expect(await readJson<StationaryClaim[]>(STORAGE_KEYS.stationaryClaims)).toEqual([]);
  });
});
