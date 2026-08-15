import { useCallback, useEffect, useRef, useState } from 'react';

import { purposeFrom, purposesForStay, type StaySegment, type VisitPurpose } from '@/core/segments';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

export interface UseVisitPurposes {
  ready: boolean;
  purposes: readonly VisitPurpose[];
  /**
   * Say why you were at a stop, or pass an empty string to stop saying it.
   *
   * Empty is a real instruction rather than a no-op: clearing the field is how a
   * purpose is deleted, so there is no separate button for it and no dialog —
   * see below on why that does not need a confirmation.
   */
  set: (stay: StaySegment, purpose: string) => void;
  forget: (id: string) => void;
}

function isPurpose(candidate: unknown): candidate is VisitPurpose {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { id, purpose, startedAt, endedAt } = candidate as Partial<VisitPurpose>;
  if (typeof id !== 'string' || typeof purpose !== 'string' || purpose.trim().length === 0) return false;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return false;
  return typeof endedAt === 'number' && Number.isFinite(endedAt) && endedAt > startedAt;
}

/**
 * The trust boundary for the purposes.
 *
 * Both ends required and `endedAt > startedAt`, exactly as `normalizeLabels`
 * requires them, and for a reason this store has not had to learn for itself: a
 * range with no real end is what let a journey label claim time that had not
 * happened. A purpose is matched by its **midpoint**, which an open-ended range
 * has no honest answer for.
 *
 * An empty purpose is dropped rather than kept. It is the same call `noteAt`
 * makes about a blank diary entry — a row holding nothing is a thing you cannot
 * see, cannot tap and cannot explain.
 */
export function normalizePurposes(input: unknown): VisitPurpose[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isPurpose).sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * Why you were where you stopped.
 *
 * Structurally the same hook as `useJourneyLabels`, and the same kind of thing:
 * something you told the app, kept as its own record and applied over a
 * re-derived timeline rather than written into it. The engine can say you were
 * at a coordinate for fifty minutes and the place list can say the coordinate is
 * called the shopping centre; only you can say it was for groceries.
 *
 * **No confirmation on clearing one, unlike a note or a recording.** The bar
 * `confirmDestructive` draws is data its owner made that nothing can
 * reconstruct — and a purpose is one line, in a field, that is deleted by
 * emptying the field you are already looking at. The undo is retyping it, in
 * the place you are already standing. A dialog there would be a dialog in front
 * of the thing the field is for.
 */
export function useVisitPurposes(): UseVisitPurposes {
  const [purposes, setPurposes] = useState<readonly VisitPurpose[]>([]);
  const [ready, setReady] = useState(false);
  // Set the moment anything is written, so a slow first read cannot land on top
  // of a purpose written while it was still going.
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = normalizePurposes(await readJson<unknown>(STORAGE_KEYS.visitPurposes));
      if (!live) return;
      if (!touched.current) setPurposes(stored);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const persist = useCallback((next: readonly VisitPurpose[]) => {
    touched.current = true;
    const sorted = [...next].sort((a, b) => a.startedAt - b.startedAt);
    setPurposes(sorted);
    void writeJson(STORAGE_KEYS.visitPurposes, sorted);
  }, []);

  const set = useCallback(
    (stay: StaySegment, purpose: string) => {
      /**
       * **Everything this stop already covers is replaced, not just the record
       * with the matching id.**
       *
       * One stop, one reason for being there. The id comes from the stay's own
       * start, so the ordinary edit replaces itself — but a stationary claim can
       * merge three stops that each had a purpose into one stay, and then all
       * three match it. Removing only the id would leave the other two behind,
       * so the row would go on reading as the new text *and* the two old ones
       * joined onto it, and typing again would never make it go away.
       *
       * So writing a purpose is writing the purpose of this visit, whatever the
       * visit turned out to be made of. What the merge joined, an edit collapses.
       */
      const covered = new Set(purposesForStay(purposes, stay).map((one) => one.id));
      const without = purposes.filter((existing) => !covered.has(existing.id));

      const next = purposeFrom(stay, purpose);
      // Null means nothing was said, which is how emptying the field deletes it.
      persist(next ? [...without, next] : without);
    },
    [purposes, persist],
  );

  const forget = useCallback(
    (id: string) => persist(purposes.filter((purpose) => purpose.id !== id)),
    [purposes, persist],
  );

  return { ready, purposes, set, forget };
}
