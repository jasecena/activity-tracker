import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { groupByDay, type DayGroup } from '@/core/day';
import type { Fix, RejectionReason } from '@/core/geo';
import {
  applyJourneyLabels,
  applyStationaryClaims,
  segmentFixes,
  type JourneyLabel,
  type Segment,
  type StationaryClaim,
} from '@/core/segments';
import { monotonicNow, now as readNow, tzOffsetMinutes as readTzOffset } from '@/services/clock';
import { freezeFinishedDays } from '@/services/dayLog';
import { readBuffer } from '@/services/fixBuffer';
import type { Settings } from '@/services/settings';
import { record, timed } from '@/services/timing';

export interface Timeline {
  ready: boolean;
  /** Today, newest day first in `history`; this is the live one. */
  today: readonly Segment[];
  history: readonly DayGroup[];
  /** Why fixes were dropped while deriving the live day. Shown in Settings. */
  rejected: Readonly<Record<RejectionReason, number>> | null;
  /**
   * The raw fix buffer, as read this refresh.
   *
   * Held so the Data screen can show what actually exists and export it. Note
   * what it is *not*: all of history. Once a day is frozen its raw fixes leave
   * for the archive — see `services/dayLog.ts` — and what remains here has had
   * its stationary runs thinned to a skeleton, which is why a long afternoon at
   * a desk stops adding rows to it.
   */
  fixes: readonly Fix[];
  now: number;
  tzOffsetMinutes: number;
  refresh: () => void;
}

/**
 * Long enough that the live segment never looks frozen, short enough not to
 * matter. Nothing here polls Core Location — the fixes are already on disk;
 * this is only how often they are re-read.
 */
const REFRESH_MS = 20_000;

/**
 * The whole timeline, re-derived from the raw fix buffer.
 *
 * This hook is the payoff for the engine being a pure fold. It holds no derived
 * state that has to be kept in step with anything: every refresh reads the
 * buffer, folds it, applies the manual windows, and that is the answer. A fix
 * that arrived in the background while the app was closed for a week is
 * incorporated by the same code path as one that arrived a second ago, and
 * there is no "catch up" branch that only runs on Tuesdays.
 *
 * It refreshes on a timer and whenever the app comes back to the foreground.
 * The second matters more: coming back is exactly when the buffer has grown by
 * everything that happened while you were out.
 */
export function useTimeline(
  settings: Settings,
  labels: readonly JourneyLabel[],
  claims: readonly StationaryClaim[],
  settingsReady: boolean,
): Timeline {
  const [today, setToday] = useState<readonly Segment[]>([]);
  const [history, setHistory] = useState<readonly DayGroup[]>([]);
  const [rejected, setRejected] = useState<Timeline['rejected']>(null);
  const [fixes, setFixes] = useState<readonly Fix[]>([]);
  const [ready, setReady] = useState(false);
  const [now, setNow] = useState(readNow);
  const [tzOffsetMinutes, setTzOffset] = useState(readTzOffset);
  const [tick, setTick] = useState(0);

  const refresh = useCallback(() => setTick((value) => value + 1), []);

  useEffect(() => {
    // Settings carry the segmentation thresholds and the retention limit;
    // folding before they are read would use defaults and then redo the work.
    if (!settingsReady) return;

    let live = true;

    void (async () => {
      const at = readNow();
      const offset = readTzOffset(at);

      const buffered = await timed('read fix buffer', () => readBuffer());
      // The fold is synchronous, so it is timed by hand rather than wrapped.
      // `monotonicNow` and not `readNow`: this measures a duration, and the wall
      // clock is corrected under a phone that has been running all day.
      const foldBegan = monotonicNow();
      const { segments, rejected: dropped } = segmentFixes(buffered, settings.segmentation);
      record('fold', monotonicNow() - foldBegan, buffered.length, 'fixes');

      // Freeze first: it writes finished days to the log and shrinks the
      // buffer, and returns the log we then read the past out of.
      const log = await timed('freeze finished days', () =>
        freezeFinishedDays({
          derived: segments,
          now: at,
          tzOffsetMinutes: offset,
          retentionDays: settings.retentionDays,
          segmentation: settings.segmentation,
        }),
      );

      if (!live) return;

      // What the buffer still holds after freezing is the live day, plus the
      // tail of a segment that straddled midnight.
      const boundary = log.length > 0 ? (log[log.length - 1]?.endedAt ?? 0) : 0;
      const liveSegments = segments.filter((segment) => segment.endedAt > boundary);

      // **Both halves, and this was a bug.** Labels used to be applied to the
      // live day alone, on the reasoning that a label covering nothing emits
      // nothing so no filtering was needed. True, and beside the point: it
      // meant naming or merging a journey on any day already frozen was stored
      // faithfully and then never shown. The row came back unchanged and the
      // merge looked broken, because from where you were sitting it was.
      //
      // The two sets are disjoint — `boundary` is exactly where the log ends —
      // so each is labelled on its own and a label reaches whichever contains
      // its range. Frozen days keep their `path`, so a split still apportions
      // distance rather than recomputing it.
      const labelled = applyJourneyLabels(liveSegments, labels);
      const labelledLog = applyJourneyLabels(log, labels);

      // **Claims last, and over the labelled timeline rather than the raw one.**
      // Naming a journey and saying you never left are two different sentences,
      // and the order matters in one direction only: a claim collapses rows,
      // so applying it first would leave a label re-cutting a stay that no
      // longer has the journey it was about inside it. Both halves for the same
      // reason the labels take both — a merge on a frozen day that was stored
      // faithfully and never shown is a merge that looks broken.
      const merged = applyStationaryClaims(labelled, claims);
      const mergedLog = applyStationaryClaims(labelledLog, claims);

      setNow(at);
      setTzOffset(offset);
      setRejected(dropped);
      setFixes(buffered);
      setToday(merged);
      setHistory(groupByDay(mergedLog, offset));
      setReady(true);
    })();

    return () => {
      live = false;
    };
  }, [settings.segmentation, settings.retentionDays, labels, claims, settingsReady, tick]);

  useEffect(() => {
    const timer = setInterval(refresh, REFRESH_MS);
    // Coming back to the foreground is when the buffer has grown by everything
    // that happened while you were out, so it is the refresh that matters most.
    const subscription = AppState.addEventListener('change', (state) => {
      if (state === 'active') refresh();
    });
    return () => {
      clearInterval(timer);
      subscription.remove();
    };
  }, [refresh]);

  return { ready, today, history, rejected, fixes, now, tzOffsetMinutes, refresh };
}
