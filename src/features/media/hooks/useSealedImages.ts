import { useCallback, useEffect, useRef, useState } from 'react';

import type { MediaItem } from '@/core/media';
import { openThumbnail } from '@/services/mediaStore';

export interface SealedImages {
  /** A decrypted thumbnail URI, or null if it has not been opened yet. */
  readonly uriFor: (item: MediaItem) => string | null;
  /** Ask for these thumbnails. Cheap to call repeatedly with the same items. */
  readonly load: (items: readonly MediaItem[]) => void;
}

/**
 * Decrypted thumbnails, kept for as long as the gallery is on screen.
 *
 * Thumbnails are the reason a gallery of hour-long videos opens instantly: a
 * few kilobytes each, so holding a screenful costs less than holding one
 * capture. They are never released item by item — the whole point is that
 * scrolling back to something you passed a second ago is free.
 *
 * `inFlight` is a ref rather than state because it is bookkeeping, not
 * something anything renders, and because a second `load` for the same item
 * must be dropped *now* rather than after a re-render — otherwise a fast scroll
 * queues the same decrypt a dozen times.
 *
 * **One at a time, through a queue.** Firing a screenful of decrypts together
 * does not make them arrive sooner — they contend for the same single JS thread
 * — and it does make the first one arrive much later, because it now finishes
 * twelfth instead of first. Chaining them means the thumbnail you are actually
 * looking at appears while the rest of the strip is still filling in behind it,
 * which is the difference between a gallery that opens and one that hangs.
 */
export function useSealedImages(): SealedImages {
  const [uris, setUris] = useState<Readonly<Record<string, string>>>({});
  const inFlight = useRef<Set<string>>(new Set());
  const queue = useRef<Promise<unknown>>(Promise.resolve());
  const live = useRef(true);

  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);

  const load = useCallback((items: readonly MediaItem[]) => {
    for (const item of items) {
      const fileName = item.thumbFileName;
      // Audio has no thumbnail and never will; asking again every scroll would
      // be a decrypt of nothing, forever.
      if (!fileName || inFlight.current.has(item.id)) continue;
      inFlight.current.add(item.id);

      // Appended to the chain rather than started now. `catch` on the queue
      // only, so one unreadable thumbnail does not stop every one behind it.
      queue.current = queue.current
        .then(() => (live.current ? openThumbnail(fileName) : null))
        .then((uri) => {
          if (!uri || !live.current) return;
          setUris((existing) => ({ ...existing, [item.id]: uri }));
        })
        .catch(() => undefined);
    }
  }, []);

  const uriFor = useCallback((item: MediaItem) => uris[item.id] ?? null, [uris]);

  return { uriFor, load };
}
