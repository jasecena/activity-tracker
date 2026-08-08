import { useCallback, useEffect, useRef, useState } from 'react';

import { capturedAtFromMediaId, mediaIdFor, normalizeMedia, type MediaItem, type MediaKind } from '@/core/media';
import { now as readNow } from '@/services/clock';
import {
  deleteMedia as deleteBytes,
  discardPending,
  listPending,
  stageCapture,
  sweepOrphans,
  writeMedia,
  writeThumbnail,
} from '@/services/mediaStore';
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

      // Anything still staged was interrupted between the camera handing it
      // over and the seal finishing — iOS suspending the app mid-write, most
      // likely, which is not an exception and so runs no cleanup at all.
      // Finish the job rather than losing the capture.
      const recovered: MediaItem[] = [];
      for (const pending of listPending()) {
        const capturedAt = capturedAtFromMediaId(pending.id);
        if (capturedAt === null) {
          discardPending(pending);
          continue;
        }

        try {
          const thumbFileName = await writeThumbnail(pending.uri, pending.id, pending.kind);
          const { fileName, byteLength } = await writeMedia(pending.uri, pending.id, pending.kind);
          // `durationMs` is not recoverable from the name and is only ever set
          // for a voice note. A clip with no length beats a clip that is gone.
          recovered.push({
            id: pending.id,
            kind: pending.kind,
            capturedAt,
            durationMs: null,
            fileName,
            thumbFileName,
            byteLength,
            note: '',
          });
        } catch (error) {
          // Given up on rather than retried on every launch for the life of
          // the install: whatever stopped it is unlikely to stop being true.
          console.warn('Could not finish an interrupted capture', error);
          discardPending(pending);
        }
      }

      const known = new Set(recovered.map((item) => item.id));
      const all = normalizeMedia([...stored.filter((item) => !known.has(item.id)), ...recovered]);

      // Only once the index is settled, or this would delete what was just
      // recovered.
      sweepOrphans(all.map((item) => item.fileName));
      if (recovered.length > 0) void writeJson(STORAGE_KEYS.media, all);

      if (!live) return;
      if (!touched.current) setItems(all);
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

  const keep = useCallback(
    async (
      sourceUri: string,
      kind: MediaKind,
      durationMs: number | null = null,
      onProgress?: (fraction: number) => void,
    ) => {
      const capturedAt = readNow();
      const id = mediaIdFor(capturedAt);

      try {
        // Ours before it is sealed. A rename, so it costs nothing however large
        // the clip — and it means an interruption leaves behind a file that
        // says what it was, rather than an OS temp file nobody will look for.
        const staged = stageCapture(sourceUri, id, kind);
        // Before `writeMedia`, which deletes the staged file: a thumbnail made
        // afterwards would have to decrypt the whole capture to get a picture
        // of it, which is the cost thumbnails exist to avoid.
        const thumbFileName = await writeThumbnail(staged.uri, id, kind);
        const { fileName, byteLength } = await writeMedia(staged.uri, id, kind, onProgress);
        const item: MediaItem = { id, kind, capturedAt, durationMs, fileName, thumbFileName, byteLength, note: '' };
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
    },
    [],
  );

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
