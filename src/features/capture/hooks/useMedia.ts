import { useCallback, useEffect, useRef, useState } from 'react';

import { capturedAtFromMediaId, mediaIdFor, normalizeMedia, type MediaItem, type MediaKind } from '@/core/media';
import type { Fix } from '@/core/geo';
import { now as readNow } from '@/services/clock';
import { appendFixes } from '@/services/fixBuffer';
import {
  backfillThumbnail,
  deleteMedia as deleteBytes,
  discardPending,
  filesOf,
  isSealed,
  listPending,
  stageCapture,
  sweepOrphans,
  unsealInPlace,
  writeMedia,
  writeThumbnail,
} from '@/services/mediaStore';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

export interface KeepOptions {
  readonly durationMs?: number | null;
  /**
   * Where it was taken, read by the caller at the moment that matters.
   *
   * Passed in rather than read here, because "the moment that matters" differs:
   * the shutter for a photo, but the *start* for a video or a voice note — by
   * the time either finishes you may be somewhere else entirely.
   */
  readonly at?: Fix | null;
  /** Fraction sealed so far, 0 to 1 — a video takes long enough to be worth showing. */
  readonly onProgress?: (fraction: number) => void;
}

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
  keep: (sourceUri: string, kind: MediaKind, options?: KeepOptions) => Promise<MediaItem | null>;
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
 * A capture stores where it was taken in two places from one reading — on the
 * item and in the fix buffer — so the pin on the photo and the route drawn
 * under it can never be two different answers. The reading itself is taken by
 * the caller, at the moment that matters for that kind of capture.
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
            // Not recoverable from a staged file's name. The capture survives;
            // only where it was taken is lost.
            at: null,
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
      // recovered. Every file an item owns, thumbnails included — handing it
      // only the captures deleted every thumbnail on the following launch.
      sweepOrphans(filesOf(all));
      if (recovered.length > 0) void writeJson(STORAGE_KEYS.media, all);

      if (!live) return;
      if (!touched.current) setItems(all);
      setReady(true);

      // Bringing the old library up to date, after `setReady` so the gallery
      // is usable — drawing what it can — while it runs. One capture at a time,
      // and never retried within a session: whatever stopped a file being read
      // will not stop being true on the second attempt.
      //
      // **One awaited write per capture, never two in flight.** This used to
      // emit a patch as each step finished and fire `writeJson` without waiting
      // — two unordered writes per item, so the second could land first and the
      // index would keep the new file name and lose the thumbnail beside it.
      // That is exactly what "some of the old ones still have no thumbnail"
      // looks like: not a thumbnail that failed to be made, but one that was
      // made and then written out of existence.
      let working = all;
      for (const item of working) {
        if (!live) return;
        // Somebody captured or deleted something while this was running. The
        // snapshot is stale, and the rest is picked up on the next launch —
        // finishing the pass over a list that has moved would undo their edit.
        if (touched.current) return;

        const patch = await bringUpToDate(item);
        if (!patch || !live) continue;

        working = working.map((existing) => (existing.id === item.id ? { ...existing, ...patch } : existing));
        if (touched.current) return;

        setItems(working);
        await writeJson(STORAGE_KEYS.media, working);
      }
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

  const keep = useCallback(async (sourceUri: string, kind: MediaKind, options: KeepOptions = {}) => {
    const { durationMs = null, at = null, onProgress } = options;
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
      // The same reading in both places. On the item it survives the day
      // being re-derived, the fixes being pruned, and tracking having been
      // off; in the stream it puts you on the timeline at that moment, so a
      // photo taken while sitting still leaves a mark on the day.
      if (at) await appendFixes([at]);

      const item: MediaItem = {
        id,
        kind,
        capturedAt,
        durationMs,
        fileName,
        thumbFileName,
        byteLength,
        at: at ? { lat: at.lat, lon: at.lon } : null,
        note: '',
      };
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

/**
 * Whatever this capture still needs, done once.
 *
 * Two migrations, in order, because the second depends on the first:
 *
 * **Unsealing.** Media used to be encrypted at rest in its own container. It is
 * not any more — iOS already encrypts the app's files with a key derived from
 * the passcode, so a second pass in JavaScript bought little against a stolen
 * phone and cost every single read. But a library sealed by an earlier build is
 * unreadable to a build that no longer decrypts, and quietly losing every photo
 * somebody took is not something an app gets to do because its storage decision
 * changed. Each file is unsealed in place, once.
 *
 * **Thumbnails**, for anything captured before they existed *or* whose
 * thumbnail is still sealed. Cheap now: there is nothing to decrypt before
 * there is a frame to scale.
 *
 * Reports each step as it lands rather than at the end, so the strip fills in
 * while the rest of the library is still being worked through.
 */
async function bringUpToDate(item: MediaItem): Promise<Partial<MediaItem> | null> {
  const patch: { fileName?: string; thumbFileName?: string } = {};
  let current = item;

  if (isSealed(current.fileName)) {
    const fileName = await unsealInPlace(current.fileName);
    // Null means it would not open — a file from a restored backup, most
    // likely. Left sealed rather than deleted: it may still open on a device
    // that has its key.
    if (!fileName) return null;

    current = { ...current, fileName };
    patch.fileName = fileName;
  }

  // A *sealed* thumbnail counts as missing. It is ciphertext, and an `<Image>`
  // handed ciphertext draws nothing — so an old capture would sit in the
  // filmstrip as a blank square forever, with a `thumbFileName` that looked
  // perfectly fine. The sealed one becomes an orphan and the next sweep takes
  // it.
  const hasThumb = current.thumbFileName !== null && !isSealed(current.thumbFileName);
  if (current.kind !== 'audio' && !hasThumb) {
    const thumbFileName = await backfillThumbnail(current);
    if (thumbFileName) patch.thumbFileName = thumbFileName;
  }

  // One patch for the whole capture, so the caller writes the index once.
  return Object.keys(patch).length > 0 ? patch : null;
}
