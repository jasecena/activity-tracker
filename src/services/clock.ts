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
