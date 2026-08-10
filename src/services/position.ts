import { judgeFix, type Fix, type RejectionReason } from '@/core/geo';
import { DEFAULT_SEGMENT_CONFIG } from '@/core/segments';

import { readBuffer } from './fixBuffer';
import { currentFix, MAX_FIX_ACCURACY_M } from './location';

/**
 * "Where am I, right now" — asked deliberately, and checked against the day so
 * far before it is believed.
 *
 * `currentFix` can only judge a reading on its own terms: is it recent, is the
 * accuracy circle narrow enough to mean anything. Neither catches the failure
 * that matters most here, because in it Core Location is **confident and
 * wrong**: it positions from a Wi-Fi network whose entry in Apple's database
 * was recorded somewhere else, and reports the result with GPS-grade accuracy.
 * A router that has been carried between cities — a home router, a hotel access
 * point, a travel hotspot — produces a 25 m fix a thousand kilometres from
 * where the phone is. Nothing about the reading itself gives it away.
 *
 * What gives it away is the step. Comparing against the last fix on record
 * turns "confident and wrong" into "you cannot have travelled that far in that
 * long", which is `judgeFix`'s `teleport` rule — the same rule the fold already
 * applies, reused rather than reinvented so the timeline and a photo's pin can
 * never disagree about which readings are real.
 *
 * **This exists because the fold is not the only consumer.** A capture stores
 * its reading on the item and draws a pin straight off it, so nothing
 * downstream ever gets the chance to reject it. Before this, the one place the
 * app states a position with no hedging at all was the one place nothing
 * checked.
 *
 * Null when the reading cannot be trusted, which every caller already handles
 * as "we do not know". A photo with no location is a small loss; a photo
 * confidently placed on the wrong continent is the app lying about the one
 * thing it exists to record.
 */
export async function askPosition(): Promise<Fix | null> {
  const fix = await currentFix();
  if (!fix) return null;

  const previous = lastOf(await readBuffer());
  if (previous === null) return fix;

  const verdict = judgeFix(previous, fix, {
    // The capture threshold, not the segmenter's. The two are asked different
    // questions: 60 m decides whether you moved, and 150 m is still a street.
    maxAccuracyM: MAX_FIX_ACCURACY_M,
    maxSpeedMps: DEFAULT_SEGMENT_CONFIG.maxSpeedMps,
    // Zero, deliberately. `minIntervalMs` throttles a *stream* that would
    // otherwise wake the app constantly; this is someone pressing a shutter,
    // and rejecting it as `too-soon` because a fix arrived a moment ago would
    // mean a photo taken during a walk is the one photo with no location.
    minIntervalMs: 0,
  });

  if (verdict.ok) return fix;

  logRejection(verdict.reason);
  return null;
}

/**
 * The most recent fix, which is the last one — `normalizeFixes` sorts by time
 * on the way out, so this needs no scan of its own.
 */
function lastOf(fixes: readonly Fix[]): Fix | null {
  return fixes.length > 0 ? (fixes[fixes.length - 1] ?? null) : null;
}

function logRejection(reason: RejectionReason): void {
  // Worth a line in the log and nothing more. A rejected reading is the system
  // working, and there is no version of this the person holding the phone can
  // act on — the app simply does not know where they are.
  console.warn(`Ignoring an untrustworthy position: ${reason}`);
}
