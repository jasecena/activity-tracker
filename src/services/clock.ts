/**
 * The only place in the app that asks what time it is.
 *
 * `src/core` never does — every function there takes "now" and the timezone
 * offset as parameters. That is what lets the whole engine be tested on a CI
 * runner in another hemisphere, and it means this file is the single point
 * where an ambient, untestable dependency enters.
 */

export function now(): number {
  return Date.now();
}

/**
 * Milliseconds from an arbitrary origin, on a clock that only moves forwards.
 *
 * **For measuring durations, never for stamping data.** `Date.now()` is the
 * wall clock, and the wall clock is corrected: iOS pulls it back into line with
 * the network, and a correction landing inside a measurement produces a
 * duration that is wrong by however far the clock moved — including a negative
 * one, which then sorts to the top of a list of "what was slow". An app that
 * runs all day in a pocket is exactly the one that sees this.
 *
 * The reverse is also true, which is why both live here: a *fix* must be
 * stamped with the wall clock, because the day it belongs to is a wall-clock
 * fact. Monotonic time has no answer to "which Tuesday".
 *
 * Feature-detected rather than assumed. Hermes provides `performance.now`, and
 * so does Node for the test run, but a missing global here should degrade to a
 * usable measurement rather than crash on first launch — the same reasoning as
 * hex over `btoa` in the vault.
 */
const hasPerformanceNow = typeof performance !== 'undefined' && typeof performance.now === 'function';

export function monotonicNow(): number {
  return hasPerformanceNow ? performance.now() : Date.now();
}

/**
 * Minutes to **add to UTC** to get local time. +600 in Sydney, -300 in New York.
 *
 * Note the sign flip. `Date.prototype.getTimezoneOffset()` returns the
 * opposite — minutes to add to *local* to get UTC — and it is the single most
 * reliable way to get timezone arithmetic backwards. The conversion happens
 * here, once, and `core/day` only ever sees the sane direction.
 *
 * Read fresh rather than cached: the offset changes under the app when the
 * clocks go back, and a cached one would file an evening's walk under
 * yesterday for the rest of the winter.
 */
export function tzOffsetMinutes(at: number = Date.now()): number {
  return -new Date(at).getTimezoneOffset();
}
