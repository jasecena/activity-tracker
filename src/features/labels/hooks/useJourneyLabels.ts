import { useCallback, useEffect, useRef, useState } from 'react';

import {
  journeyLabelId,
  overrideFor,
  saysSomething,
  type ActivityMode,
  type JourneyLabel,
  type Segment,
} from '@/core/segments';
import { dropRetiredKeys, readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

export interface UseJourneyLabels {
  ready: boolean;
  labels: readonly JourneyLabel[];
  /** Name a journey, or rename one already named. The mode is your answer, and it wins. */
  name: (segment: Segment, label: string, mode: ActivityMode) => void;
  /**
   * Say what a stretch really was, or pass null to stop saying it.
   *
   * Null is a genuine revert rather than a second opinion: the detected mode is
   * never stored, so taking the override away is enough to get it back.
   */
  setMode: (segment: Segment, mode: ActivityMode | null) => void;
  forget: (id: string) => void;
}

function isLabel(candidate: unknown): candidate is JourneyLabel {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { id, label, mode, startedAt, endedAt } = candidate as Partial<JourneyLabel>;
  if (typeof id !== 'string' || typeof label !== 'string') return false;
  // Null is a real value, not a missing one: a named journey whose mode
  // correction was taken back has no opinion of its own, and so did every label
  // the retired merge feature wrote. Both have to be recognised here — the
  // first to be kept, the second so `saysSomething` can drop it.
  if (mode !== null && typeof mode !== 'string') return false;
  if (typeof startedAt !== 'number' || !Number.isFinite(startedAt)) return false;
  return typeof endedAt === 'number' && Number.isFinite(endedAt) && endedAt > startedAt;
}

/**
 * The trust boundary for the labels.
 *
 * `endedAt` is required here, not merely typed. The store may still hold an
 * open-ended window written by a build that had a Record button, and one of
 * those is exactly what put a journey on the wrong day — so anything without a
 * real end is dropped rather than repaired.
 */
export function normalizeLabels(input: unknown): JourneyLabel[] {
  if (!Array.isArray(input)) return [];
  return input.filter(isLabel).sort((a, b) => a.startedAt - b.startedAt);
}

/**
 * The names you have given journeys.
 *
 * Naming is retrospective: you tap a journey the app already recorded and say
 * what it was. There is nothing to start and nothing to stop, so there is no
 * state that can be left running — see `core/segments/manual.ts` for why that
 * matters more than it sounds.
 */
export function useJourneyLabels(): UseJourneyLabels {
  const [labels, setLabels] = useState<readonly JourneyLabel[]>([]);
  const [ready, setReady] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      // Older builds stored open-ended recording windows under a key nothing
      // reads now. Dropped here rather than left as an encrypted blob nobody
      // can account for.
      await dropRetiredKeys();

      const stored = normalizeLabels(await readJson<unknown>(STORAGE_KEYS.journeyLabels));

      // Merging rows into one journey is gone, and the merges go with it. A
      // merge was stored as a label with no name over a span, so dropping the
      // ones that say nothing takes apart every row that was ever joined, in
      // one pass, with nothing left to interpret. Without this a build with no
      // merge button would go on applying every merge ever made, and offer no
      // way to undo any of them.
      //
      // "Says nothing" is nameless *and* modeless, which is narrower than the
      // rule this replaces. That rule asked only about the name, and it was
      // right for exactly as long as a mode could not arrive without one — a
      // mode correction is nameless by design, so the old test would have
      // deleted every correction on the next launch. Silently, and while the
      // app looked like it had saved them.
      //
      // Names survive, and so do corrections. Both are things nobody could
      // reconstruct; the detected mode underneath is re-derived from the fixes
      // every fold and cannot be lost.
      const meaningful = stored.filter(saysSomething);
      if (meaningful.length !== stored.length) await writeJson(STORAGE_KEYS.journeyLabels, meaningful);

      if (!live) return;
      if (!touched.current) setLabels(meaningful);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const persist = useCallback((next: readonly JourneyLabel[]) => {
    touched.current = true;
    setLabels(next);
    void writeJson(STORAGE_KEYS.journeyLabels, next);
  }, []);

  const name = useCallback(
    (segment: Segment, text: string, mode: ActivityMode) => {
      const trimmed = text.trim();
      if (trimmed.length === 0) return;

      const next: JourneyLabel = {
        // From the journey's own start, so naming the same one twice replaces
        // its label rather than stacking a second one over it.
        id: journeyLabelId(segment.startedAt),
        label: trimmed,
        mode,
        startedAt: segment.startedAt,
        endedAt: segment.endedAt,
      };

      persist(
        [...labels.filter((existing) => existing.id !== next.id), next].sort((a, b) => a.startedAt - b.startedAt),
      );
    },
    [labels, persist],
  );

  const setMode = useCallback(
    (segment: Segment, mode: ActivityMode | null) => {
      const id = journeyLabelId(segment.startedAt);
      const without = labels.filter((existing) => existing.id !== id);
      const next = overrideFor(
        segment,
        mode,
        labels.find((existing) => existing.id === id),
        journeyLabelId,
      );

      // Null means there is nothing left worth storing — no name and no
      // opinion — so the row goes rather than staying behind as an empty one.
      persist(next ? [...without, next].sort((a, b) => a.startedAt - b.startedAt) : without);
    },
    [labels, persist],
  );

  const forget = useCallback((id: string) => persist(labels.filter((label) => label.id !== id)), [labels, persist]);

  return { ready, labels, name, setMode, forget };
}
