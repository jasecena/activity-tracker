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
export {
  appendTranscript,
  dayNoteId,
  daysWorthOpening,
  freeInstant,
  groupNotesByDay,
  normalizeDayNotes,
  noteAt,
  notesForDay,
  splitAtNow,
  TRANSCRIPT_SEPARATOR,
  voiceFilesOf,
  whereToWrite,
  type DayNote,
  type NoteDay,
  type NoteOrder,
  type NoteVoice,
} from './notes';
export { summarizeDay, type DaySummary } from './summary';
