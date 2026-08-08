import { useEffect, useState } from 'react';

import type { MediaItem } from '@/core/media';
import { openForPlayback, releasePlayback } from '@/services/mediaStore';

export interface SealedFile {
  /** A URI something can show or play, or null while it is still being opened. */
  readonly uri: string | null;
  readonly failed: boolean;
  /** How much of it is open, 0 to 1. A minute of video is worth a progress bar. */
  readonly progress: number;
}

/**
 * The one capture currently being looked at, decrypted.
 *
 * **Only one.** A gallery that decrypted every item it rendered would undo the
 * point of thumbnails — a paging list keeps several pages alive, and each one
 * is a whole photo or a whole video. The neighbours show their thumbnails
 * instead, which is what makes swiping cost nothing until you stop.
 *
 * The plaintext is released as soon as the item changes, so at most one
 * decrypted capture exists at a time.
 *
 * The stale result is cleared **during render**, not in the effect. An effect
 * runs after the render that changed the item, so for one frame the new page
 * would be handed the previous capture's URI — which is a photo of somewhere
 * else, briefly, on someone's screen. Clearing it as the item changes means
 * that frame never exists.
 */
export function useSealedFile(item: MediaItem | null): SealedFile {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [progress, setProgress] = useState(0);
  const [openedId, setOpenedId] = useState<string | null>(item?.id ?? null);

  if (openedId !== (item?.id ?? null)) {
    setOpenedId(item?.id ?? null);
    setUri(null);
    setFailed(false);
    setProgress(0);
  }

  useEffect(() => {
    if (!item) return;

    let live = true;
    void openForPlayback(item, (fraction) => {
      if (live) setProgress(fraction);
    }).then((opened) => {
      if (!live) {
        // Arrived after the item changed: clean up rather than leak a
        // decrypted capture nobody is looking at.
        if (opened) releasePlayback(item);
        return;
      }
      setUri(opened);
      setFailed(opened === null);
    });

    return () => {
      live = false;
      releasePlayback(item);
    };
  }, [item]);

  // Only ever the current item's result: the id check above has already cleared
  // anything belonging to the page you just left.
  return { uri, failed, progress };
}
