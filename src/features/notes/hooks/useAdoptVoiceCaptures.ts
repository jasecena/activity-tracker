import { useEffect, useRef } from 'react';

import type { UseMedia } from '@/features/capture/hooks/useMedia';
import { adoptFromMedia } from '@/services/noteAudio';

import type { UseDayNotes } from './useDayNotes';

/**
 * Voice notes recorded while a voice note was still a capture, moved into the
 * diary where they belong.
 *
 * **It exists so that hiding them is not the same as losing them.** The Media
 * tab no longer shows a recording — a gallery is for looking at pictures — and
 * without this, every voice note made before that change would be a row nothing
 * renders: still in the index, still on disk, and unreachable from anywhere in
 * the app. That is the same failure the retired `live` kind was written up to
 * avoid, one level higher: the feature moved, so the rows move with it.
 *
 * It runs at most once per capture per session, and it is deliberately **one at
 * a time**. Both stores read their list out of the closure they were built in,
 * so adopting five in a loop would write five notes over the same snapshot and
 * keep the last. Each pass takes the first stray, hands it over, and lets the
 * two state updates re-run the effect for the next one.
 *
 * A capture whose file has already gone still becomes a note if anything was
 * typed on it, and is dropped from the index otherwise: an audio row with no
 * bytes is an entry pointing at nothing, which is exactly what the sweep exists
 * to remove.
 */
export function useAdoptVoiceCaptures(media: UseMedia, notes: UseDayNotes): void {
  /** Ids already handed over, so a capture that refuses to go cannot loop. */
  const handled = useRef(new Set<string>());

  useEffect(() => {
    if (!media.ready || !notes.ready) return;

    const stray = media.items.find((item) => item.kind === 'audio' && !handled.current.has(item.id));
    if (!stray) return;

    handled.current.add(stray.id);

    const kept = adoptFromMedia(stray.fileName, stray.capturedAt);
    notes.write(
      stray.capturedAt,
      '',
      // Whatever was typed on the capture. It was the only place a voice note
      // could hold words, so it is the note's body now.
      stray.note,
      // Unlocked, like every recording arrives: adopting one from an older
      // build is not the moment to decide its owner wanted it kept.
      kept ? { ...kept, durationMs: stray.durationMs ?? 0, at: stray.at, locked: false } : null,
    );
    media.forget(stray.id);
  }, [media, notes]);
}
