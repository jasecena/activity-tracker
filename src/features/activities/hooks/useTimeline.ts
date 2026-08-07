import { useCallback, useEffect, useState } from 'react';
import { AppState } from 'react-native';

import { groupByDay, type DayGroup } from '@/core/day';
import type { Fix, RejectionReason } from '@/core/geo';
import { applyJourneyLabels, segmentFixes, type JourneyLabel, type Segment } from '@/core/segments';
import { now as readNow, tzOffsetMinutes as readTzOffset } from '@/services/clock';
import { freezeFinishedDays } from '@/services/dayLog';
import { readBuffer } from '@/services/fixBuffer';
import type { Settings } from '@/services/settings';

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
   * what it is *not*: all of history. Once a day is frozen its raw fixes are
   * pruned and only the derived segments survive — see `services/dayLog.ts`.
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
export function useTimeline(settings: Settings, labels: readonly JourneyLabel[], settingsReady: boolean): Timeline {
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

      const buffered = await readBuffer();
      const { segments, rejected: dropped } = segmentFixes(buffered, settings.segmentation);

      // Freeze first: it writes finished days to the log and shrinks the
      // buffer, and returns the log we then read the past out of.
      const log = await freezeFinishedDays({
        derived: segments,
        now: at,
        tzOffsetMinutes: offset,
        retentionDays: settings.retentionDays,
      });

      if (!live) return;

      // What the buffer still holds after freezing is the live day, plus the
      // tail of a segment that straddled midnight. Every label is applied to
      // it; one whose journey is not in there covers nothing and emits nothing,
      // so there is no filtering to do and no day arithmetic to get wrong.
      const boundary = log.length > 0 ? (log[log.length - 1]?.endedAt ?? 0) : 0;
      const liveSegments = segments.filter((segment) => segment.endedAt > boundary);
      const labelled = applyJourneyLabels(liveSegments, labels);

      setNow(at);
      setTzOffset(offset);
      setRejected(dropped);
      setFixes(buffered);
      setToday(labelled);
      setHistory(groupByDay(log, offset));
      setReady(true);
    })();

    return () => {
      live = false;
    };
  }, [settings.segmentation, settings.retentionDays, labels, settingsReady, tick]);

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
