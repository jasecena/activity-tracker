import { distanceM, type Fix } from '../geo';
import type { SegmentConfig } from '../segments';

/**
 * Throwing away readings that say nothing the readings beside them do not.
 *
 * An afternoon at a desk is hundreds of fixes at one spot at zero speed, and
 * between them they say one thing: _here, from then until then_. The arrival and
 * the departure say it just as well, and the rest is exactly the non-necessary
 * data this app should not be hoarding — the fix archive is otherwise the one
 * store with no bound on it at all, growing for as long as the phone is on.
 *
 * **The trap this is built around.** The timeline is re-derived from the fix
 * buffer, and _a gap is a hole, never a straight line_: no fix for `gapMs`
 * closes whatever is open and the day simply stops. Delete the middle of a
 * three-hour stay and the fold sees two lonely readings an hour apart — the stay
 * becomes a hole, and the cleanup has eaten an afternoon. Naive deletion is not
 * a smaller buffer, it is a different day.
 *
 * So there are two shapes, by where the fixes live, and the difference between
 * them is entirely `holdMs`:
 *
 * - **The archive** (`archiveCompaction`): endpoints only. Nothing re-folds
 *   archived fixes — a frozen day's segments are its record — so there is
 *   nobody downstream to disturb.
 * - **The live buffer** (`liveCompaction`): a skeleton, one reading every
 *   `holdMs`, which is comfortably inside `gapMs`. Today is still re-folded, so
 *   the run has to stay unbroken.
 *
 * Pure, like the rest of `core`: no clock, no storage, and the thresholds are
 * parameters. Nothing here invents a reading — compaction only ever removes,
 * which is what keeps the raw export honest about being raw.
 */

export interface CompactionConfig {
  /**
   * How far a reading may sit from the first of a run and still be the same
   * spot.
   *
   * Measured from the run's first fix rather than from the previous one, which
   * is the whole reason a slow amble cannot be swallowed: drifting a few metres
   * at a time leaves the circle after a few readings and ends the run, where a
   * previous-fix test would follow the drift across a car park.
   *
   * **The two callers pass different radii, and the asymmetry is the point.**
   *
   * The archive gets `minMoveDistanceM` — 60 m. It has to be wider than the
   * tracking preset's distance filter, and that is not a tuning preference: iOS
   * delivers a location update only once the phone has moved further than the
   * filter from the last one it delivered, so consecutive readings are already
   * that far apart by construction. A radius at or under the filter means every
   * reading starts a new run, no run ever holds a third, and compaction is
   * arithmetically incapable of dropping anything. Both halves used
   * `pathResolutionM` — 25 m, which is exactly the default preset's filter — and
   * the feature did nothing whatsoever on a real phone while every test passed.
   * 60 m clears the default's 25 m and the detailed preset's 10 m. The
   * battery-saver preset filters at 100 m and stays out of reach, which is the
   * right answer: a stream sampled every 100 m has nothing redundant in it.
   *
   * The live buffer keeps the tighter `pathResolutionM`, deliberately, because
   * it is the half that gets folded again. A wide circle absorbs the first
   * readings of a departure and the first metres of the journey with them — and
   * worse, movement *confined* to the circle, pacing a garden or a shop floor,
   * comes out with less distance than it had. Neither matters where nothing
   * folds again and the segments are already the record; both matter for today.
   * The two halves have different risk, so they get different numbers, the same
   * way they already get different holds.
   */
  readonly stillRadiusM: number;
  /**
   * Never leave more than this between two kept readings inside a run — or
   * `null` to keep nothing but the two ends.
   *
   * `null` is for the archive alone. Anything that will be folded again needs a
   * number well inside `gapMs`, or compaction manufactures the hole it exists to
   * avoid.
   */
  readonly holdMs: number | null;
  /** A run shorter than this is left exactly as it is. */
  readonly minRunMs: number;
}

/**
 * Endpoint-only compaction, for fixes on their way into the archive.
 *
 * Safe there and nowhere else: the guarantee it leans on is that nothing reads
 * the archive to build a timeline. Adding a caller that does would break this
 * as well as the reason freezing exists.
 *
 * This is the half that does the work. It is where the growth term actually is —
 * retention reaches the archive only at its far end, so without this a phone
 * fills it for as long as it is switched on — and it is the half that can afford
 * the wide radius, because nothing downstream is going to fold what it leaves.
 */
export function archiveCompaction(config: SegmentConfig): CompactionConfig {
  return { stillRadiusM: config.minMoveDistanceM, holdMs: null, minRunMs: config.minStayMs };
}

/**
 * Skeleton compaction, for fixes still in the buffer that today is folded from.
 *
 * `gapMs / 3` rather than something just under `gapMs`: the fold must see an
 * unbroken run, and leaving a third of the tolerance spare means a coarser
 * preset, a delayed reading or a rounded interval cannot eat the margin.
 *
 * **The timid half, and it is meant to be.** Its radius is the tight one, so on
 * the default preset — whose distance filter is that same 25 m — it will often
 * find no run at all and drop nothing. That is the correct trade rather than a
 * shortfall: what it is bounding is a single day's buffer, which midnight bounds
 * anyway, and the cost of being wrong here is a wrong timeline today. The
 * archive is where the unbounded growth lives and where the wide radius belongs.
 * On the detailed preset, which samples every 10 m, this one earns its keep.
 */
export function liveCompaction(config: SegmentConfig): CompactionConfig {
  return { stillRadiusM: config.pathResolutionM, holdMs: config.gapMs / 3, minRunMs: config.minStayMs };
}

/** A stretch of readings within `stillRadiusM` of the first of them. Never empty. */
type Run = [Fix, ...Fix[]];

/**
 * Cut the stream into runs.
 *
 * Every reading belongs to exactly one, so a walk becomes a great many runs of
 * one or two and an afternoon at a desk becomes a single long one. The
 * comparison is always against the run's own first reading, never the previous
 * one — see `stillRadiusM`.
 */
function runsOf(fixes: readonly Fix[], radiusM: number): Run[] {
  const runs: Run[] = [];
  let current: Run | null = null;
  for (const fix of fixes) {
    if (current && distanceM(current[0], fix) <= radiusM) current.push(fix);
    else {
      current = [fix];
      runs.push(current);
    }
  }
  return runs;
}

/**
 * Drop the readings inside each stationary run, keeping its two ends.
 *
 * `fixes` must be in time order, which is what `normalizeFixes` guarantees for
 * everything read back from storage.
 *
 * Two properties hold whatever the input, and they are what make this safe to
 * run over a buffer that will be folded again:
 *
 * - **Every reading outside a run survives**, along with the first and last of
 *   every run. So the step across a run's boundary — the arrival, the departure,
 *   and every step of an actual journey — is byte-for-byte what it was.
 * - **No spacing is created that was not already there.** A reading is kept as
 *   soon as the _next_ one would put the gap past `holdMs`, so consecutive kept
 *   readings are at most `holdMs` apart unless the raw stream was already
 *   quieter than that, in which case the hole is the phone's and not ours.
 *
 * What it does **not** promise is a byte-identical fold. Jitter inside the
 * radius can accumulate enough path length to have been emitted as a phantom
 * move — 60 m of wandering inside a 25 m circle is a desk, and the timeline is
 * better off without it — so segments can come out slightly cleaner than they
 * did. Stays keep their ids, because a run's first reading is always kept and
 * an id is derived from `startedAt`.
 *
 * Returns the input array itself when nothing was dropped, so a caller can skip
 * a write by identity rather than by comparing a few thousand readings.
 */
export function compactFixes(fixes: readonly Fix[], config: CompactionConfig): readonly Fix[] {
  const kept: Fix[] = [];
  const hold = config.holdMs;
  let dropped = false;

  for (const run of runsOf(fixes, config.stillRadiusM)) {
    const [arrival, ...rest] = run;
    const departure = rest[rest.length - 1];

    // Nothing to thin: a run of one or two readings already *is* its own two
    // ends, which is the common case out on a walk. Nor is a run shorter than
    // the shortest stay the timeline will draw worth touching.
    if (departure === undefined || rest.length < 2 || departure.at - arrival.at < config.minRunMs) {
      kept.push(...run);
      continue;
    }

    kept.push(arrival);

    // One reading behind, so the decision about `candidate` can be made with
    // the reading that follows it in hand. Keeping a reading because the *next*
    // one would break the hold — rather than keeping whatever first lands past
    // it — is what bounds the spacing at `holdMs` instead of at twice it.
    let lastKeptAt = arrival.at;
    let candidate: Fix | null = null;
    for (const current of rest) {
      if (candidate !== null) {
        if (hold !== null && current.at - lastKeptAt > hold) {
          kept.push(candidate);
          lastKeptAt = candidate.at;
        } else {
          dropped = true;
        }
      }
      candidate = current;
    }
    kept.push(departure);
  }

  return dropped ? kept : fixes;
}
