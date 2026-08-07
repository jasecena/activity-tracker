import { useCallback, useEffect, useRef, useState } from 'react';

import { mediaIdFor, normalizeMedia, type MediaItem, type MediaKind } from '@/core/media';
import { now as readNow } from '@/services/clock';
import { deleteMedia as deleteBytes, writeMedia } from '@/services/mediaStore';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

export interface UseMedia {
  ready: boolean;
  items: readonly MediaItem[];
  /**
   * Seal a file the camera or recorder just produced and add it to the index.
   *
   * Resolves to the stored item, or null if sealing failed — in which case
   * nothing is added, because an index entry pointing at bytes that are not
   * there is worse than no entry at all.
   */
  keep: (
    sourceUri: string,
    kind: MediaKind,
    durationMs?: number | null,
    /** Fraction sealed so far, 0 to 1 — a video takes long enough to be worth showing. */
    onProgress?: (fraction: number) => void,
  ) => Promise<MediaItem | null>;
  annotate: (id: string, note: string) => void;
  forget: (id: string) => void;
}

/**
 * Captured photos, video and voice notes.
 *
 * The index lives in the same encrypted store as everything else; the bytes
 * live in `services/mediaStore.ts`, sealed under the same key. Both halves are
 * written here so they cannot drift: the file is sealed **first**, and the
 * index entry is only added once there is something for it to point at.
 *
 * A capture records a time and nothing about where it happened. Where is
 * derived later from the fix buffer — `core/media`'s `placeMedia` — for the
 * same reason manual recording does not open its own location subscription:
 * one fix stream, one answer to "where was I".
 */
export function useMedia(): UseMedia {
  const [items, setItems] = useState<readonly MediaItem[]>([]);
  const [ready, setReady] = useState(false);
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = normalizeMedia(await readJson<unknown>(STORAGE_KEYS.media));
      if (!live) return;
      if (!touched.current) setItems(stored);
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const persist = useCallback((next: readonly MediaItem[]) => {
    touched.current = true;
    setItems(next);
    void writeJson(STORAGE_KEYS.media, next);
  }, []);

  const keep = useCallback(async (sourceUri: string, kind: MediaKind, durationMs: number | null = null) => {
    const capturedAt = readNow();
    const id = mediaIdFor(capturedAt);

    try {
      const { fileName, byteLength } = await writeMedia(sourceUri, id, kind);
      const item: MediaItem = { id, kind, capturedAt, durationMs, fileName, byteLength, note: '' };
      // Read from state at the moment of the write rather than from a
      // dependency: sealing a video takes long enough for a second capture to
      // start, and a stale closure here would drop one of them.
      setItems((current) => {
        const next = [...current.filter((existing) => existing.id !== id), item].sort(
          (a, b) => a.capturedAt - b.capturedAt,
        );
        touched.current = true;
        void writeJson(STORAGE_KEYS.media, next);
        return next;
      });
      return item;
    } catch (error) {
      console.warn('Could not store the capture', error);
      return null;
    }
  }, []);

  const annotate = useCallback(
    (id: string, note: string) => persist(items.map((item) => (item.id === id ? { ...item, note } : item))),
    [items, persist],
  );

  const forget = useCallback(
    (id: string) => {
      const doomed = items.find((item) => item.id === id);
      if (doomed) deleteBytes(doomed);
      persist(items.filter((item) => item.id !== id));
    },
    [items, persist],
  );

  return { ready, items, keep, annotate, forget };
}
