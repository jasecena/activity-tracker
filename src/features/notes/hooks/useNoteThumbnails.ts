import { useCallback, useEffect, useMemo } from 'react';

import type { DayNote } from '@/core/day';
import type { MediaItem } from '@/core/media';
import { useSealedImages } from '@/features/media/hooks/useSealedImages';

export interface NoteThumbnails {
  /**
   * The capture a note names, or null.
   *
   * Null covers two different things on purpose — a note with no picture, and a
   * note whose picture has been forgotten — because every caller does the same
   * thing with both: draws no thumbnail. The one screen that needs to tell them
   * apart has the note in its hand and can read `mediaId` itself.
   */
  readonly itemFor: (mediaId: string | null) => MediaItem | null;
  /** Its thumbnail, once decrypted, or null until then. */
  readonly uriFor: (mediaId: string | null) => string | null;
}

/**
 * Thumbnails for the captures the diary points at.
 *
 * A thin arrangement over `useSealedImages` rather than a second cache: the
 * gallery's queue already does the hard part — one decrypt at a time, so the
 * one being looked at arrives while the rest fill in behind it — and a diary
 * asking for a dozen thumbnails at once has exactly the problem that queue was
 * written for.
 *
 * **Only the captures some note actually names.** A year of photographs is not
 * a year of thumbnails to decrypt on the Notes tab; the loop is over the notes,
 * and a diary with no pictures in it costs nothing at all.
 *
 * Held once, by the shell, and handed to both the list and the sheet. Two
 * instances would decrypt the same thumbnails twice and disagree about which of
 * them had arrived.
 */
export function useNoteThumbnails(notes: readonly DayNote[], captures: readonly MediaItem[]): NoteThumbnails {
  const images = useSealedImages();

  const byId = useMemo(() => new Map(captures.map((item) => [item.id, item])), [captures]);

  const linked = useMemo(() => {
    const wanted = new Set(notes.flatMap((note) => (note.mediaId ? [note.mediaId] : [])));
    return captures.filter((item) => wanted.has(item.id));
  }, [notes, captures]);

  useEffect(() => {
    images.load(linked);
  }, [images, linked]);

  const itemFor = useCallback((mediaId: string | null) => (mediaId ? (byId.get(mediaId) ?? null) : null), [byId]);

  const uriFor = useCallback(
    (mediaId: string | null) => {
      const item = itemFor(mediaId);
      return item ? images.uriFor(item) : null;
    },
    [itemFor, images],
  );

  return { itemFor, uriFor };
}
