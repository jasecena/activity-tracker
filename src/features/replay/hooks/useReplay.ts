import { useCallback, useEffect, useMemo, useState } from 'react';

import { buildTrack, holesIn, positionAt, type Position, type Track } from '@/core/replay';
import type { Segment } from '@/core/segments';
import { now as readNow } from '@/services/clock';

/** How much faster than life. 1× is a day taking a day, which nobody wants. */
export const SPEEDS: readonly number[] = [10, 60, 300, 1200];

export interface UseReplay {
  readonly track: Track;
  readonly holes: readonly { readonly from: number; readonly to: number }[];
  /** The instant being shown. */
  readonly playhead: number;
  readonly position: Position | null;
  readonly playing: boolean;
  readonly speed: number;
  readonly setPlayhead: (at: number) => void;
  readonly setSpeed: (speed: number) => void;
  readonly toggle: () => void;
}

/** How often the playhead advances. 20 Hz is smooth and costs nothing. */
const FRAME_MS = 50;

/**
 * The player.
 *
 * Everything it shows is derived: the track from the segments, the position
 * from the track and the playhead. Nothing is precomputed into state that would
 * then need keeping in step — the same reason `useTimeline` holds no derived
 * timeline.
 *
 * The playhead lives in `useState` and is read during render, which is why it
 * cannot be a ref: `react-hooks/refs` is an error in this codebase, and a value
 * the render depends on belongs in state.
 */
export function useReplay(segments: readonly Segment[]): UseReplay {
  const track = useMemo(() => buildTrack(segments), [segments]);
  const holes = useMemo(() => holesIn(track), [track]);

  const [playhead, setPlayheadState] = useState(track.from);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState<number>(SPEEDS[1] ?? 60);
  const [shown, setShown] = useState(track);

  // A new day starts at its beginning and paused. Carrying yesterday's playhead
  // into today would put it somewhere outside the new span.
  //
  // Adjusted during render rather than in an effect. React re-runs this
  // component before touching the screen, so the new day is never painted with
  // the old playhead — an effect would render the wrong frame first and then
  // correct it, which `react-hooks/set-state-in-effect` exists to prevent.
  if (shown !== track) {
    setShown(track);
    setPlayheadState(track.from);
    setPlaying(false);
  }

  const setPlayhead = useCallback(
    (at: number) => setPlayheadState(Math.min(track.to, Math.max(track.from, at))),
    [track.from, track.to],
  );

  useEffect(() => {
    if (!playing) return;

    // Wall-clock elapsed rather than a fixed increment per frame, so a dropped
    // frame slows the animation rather than the day.
    let last = readNow();
    const timer = setInterval(() => {
      const at = readNow();
      const elapsed = at - last;
      last = at;

      setPlayheadState((current) => {
        const next = current + elapsed * speed;
        if (next >= track.to) {
          setPlaying(false);
          return track.to;
        }
        return next;
      });
    }, FRAME_MS);

    return () => clearInterval(timer);
  }, [playing, speed, track.to]);

  const toggle = useCallback(() => {
    setPlaying((current) => {
      // Pressing play at the end starts again rather than doing nothing, which
      // is what every other player does.
      if (!current && playhead >= track.to) setPlayheadState(track.from);
      return !current;
    });
  }, [playhead, track.from, track.to]);

  const position = useMemo(() => positionAt(track, playhead), [track, playhead]);

  return { track, holes, playhead, position, playing, speed, setPlayhead, setSpeed, toggle };
}
