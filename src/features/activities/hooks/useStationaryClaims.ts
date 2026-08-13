import { useCallback, useEffect, useRef, useState } from 'react';

import { stationaryClaimId, type StationaryClaim } from '@/core/segments';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

export interface UseStationaryClaims {
  ready: boolean;
  claims: readonly StationaryClaim[];
  /** Say you did not move between two instants. */
  claim: (startedAt: number, endedAt: number, at: { readonly lat: number; readonly lon: number }) => void;
  /** Take it back. The rows underneath were never overwritten, so they return. */
  forget: (id: string) => void;
}

function isClaim(candidate: unknown): candidate is StationaryClaim {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { id, startedAt, endedAt, at } = candidate as Partial<StationaryClaim>;
  if (typeof id !== 'string') return false;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return false;
  if (typeof endedAt !== 'number' || !Number.isFinite(endedAt) || endedAt <= startedAt) return false;
  if (typeof at !== 'object' || at === null) return false;
  return Number.isFinite(at.lat) && Number.isFinite(at.lon);
}

/**
 * The trust boundary for the claims.
 *
 * Both ends are required and so is a position, and none of the three can be
 * repaired: a claim missing its end is the open-ended window that put a journey
 * on the wrong day, and a claim missing its centre has no answer to the only
 * question it exists to answer. Dropped rather than guessed at.
 *
 * That is a different judgement from `normalizeDayNotes`, which repairs
 * wherever it can — and the difference is what the record *is*. A note is
 * something somebody wrote and nothing can reconstruct. A claim is a correction
 * over readings that are still there underneath: losing one costs a gesture,
 * and the day it described is entirely intact without it.
 */
export function normalizeClaims(input: unknown): StationaryClaim[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isClaim).sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * The stretches you have said you were in one place for.
 *
 * Stored exactly like the journey names next door, and read by `useTimeline`
 * the same way — applied to the segments after the labels, so a day is folded,
 * named, then collapsed where you said it should be.
 */
export function useStationaryClaims(): UseStationaryClaims {
  const [claims, setClaims] = useState<readonly StationaryClaim[]>([]);
  const [ready, setReady] = useState(false);
  // A merge made while the store was still being read must not be thrown away
  // by the read landing second. Same guard as the labels.
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = normalizeClaims(await readJson<unknown>(STORAGE_KEYS.stationaryClaims));
      if (!live) return;
      if (!touched.current) setClaims(stored);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const persist = useCallback((next: readonly StationaryClaim[]) => {
    touched.current = true;
    setClaims(next);
    void writeJson(STORAGE_KEYS.stationaryClaims, next);
  }, []);

  const claim = useCallback<UseStationaryClaims['claim']>(
    (startedAt, endedAt, at) => {
      if (endedAt <= startedAt) return;

      const next: StationaryClaim = { id: stationaryClaimId(startedAt), startedAt, endedAt, at };
      persist(
        [...claims.filter((existing) => existing.id !== next.id), next].sort((a, b) => a.startedAt - b.startedAt),
      );
    },
    [claims, persist],
  );

  const forget = useCallback(
    (id: string) => persist(claims.filter((existing) => existing.id !== id)),
    [claims, persist],
  );

  return { ready, claims, claim, forget };
}
