/**
 * Days.
 *
 * A day is a wall-clock idea, and this module is where the app's only
 * date arithmetic lives. It reads no clock and knows no timezone database: the
 * caller passes the offset, every time. That is what lets the suite run in UTC
 * on a CI runner and still assert what a phone in Sydney would show.
 */
export { dayKeyOf, groupByDay, startOfLocalDay, type DayGroup, type TzOffsetMinutes } from './day';
export { applyRetention, mergeIntoLog, planFreeze, type FreezePlan } from './freeze';
export { summarizeDay, EMPTY_MODE_TOTALS, type DaySummary, type ModeTotals } from './summary';
