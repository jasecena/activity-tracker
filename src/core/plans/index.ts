import type { DayNote } from '../day';

/**
 * What a plan looks like in the bucket, and what decides one is ready to go.
 *
 * **Only the words leave.** A plan's recording stays on this phone: it is
 * already swept, already spared by retention and already in the ordinary
 * backup, and the thing on the other end reads text. So what goes up is the
 * transcript and whatever was typed beside it — small, boring, and openable by
 * the same Python script the backup already needs.
 *
 * Everything here is pure and none of it knows about a bucket, a key or a
 * request. The service that sends one decides the bytes; this decides which
 * ones there are, what is in them and when there is nothing to do.
 */

/**
 * The format version, in every object.
 *
 * The reader is a script on somebody's laptop rather than a build of this app,
 * so it cannot be assumed to be in step. A version is what lets it say "this is
 * newer than I know how to read" instead of quietly misreading a field.
 */
export const PLAN_FORMAT_VERSION = 1;

/** One plan, as the bucket holds it. Plain JSON on purpose — see `core/backup`. */
export interface PlanPayload {
  readonly version: number;
  readonly id: string;
  /** The instant the plan is about, in epoch milliseconds. */
  readonly at: number;
  readonly title: string;
  /** What was typed, and what was said once it has been transcribed. */
  readonly text: string;
  /** How long the recording ran, or null where there was none. */
  readonly spokenMs: number | null;
}

/**
 * Where a plan lives in the bucket.
 *
 * **Derived from the note's id, which is derived from its instant**, so sending
 * the same plan twice overwrites one object rather than making a second. The
 * same discipline as a segment id and as the backup's own object naming, and it
 * is what makes a retry after a failed upload cost nothing.
 */
export function planKey(id: string): string {
  return `plans/${id}.json`;
}

/** What a plan says, once. Empty means there is nothing worth sending yet. */
function words(note: DayNote): string {
  return `${note.title.trim()} ${note.text.trim()}`.trim();
}

/**
 * A plan with a recording whose words have not been fetched yet.
 *
 * The recording is the whole of the entry in the ordinary case — you said a
 * thing on the way somewhere and typed nothing — so until it has been
 * transcribed there is no text to send and the object would be a timestamp with
 * nothing attached.
 *
 * **Tracked by id rather than inferred from the text being empty.** A plan you
 * spoke and then typed a title on would otherwise look transcribed and never be,
 * and one whose transcript came back as silence would be retried for ever.
 */
export function planToTranscribe(
  notes: readonly DayNote[],
  transcribed: Readonly<Record<string, true>>,
): DayNote | null {
  // **One per pass, deliberately.** Transcribing writes the words back onto the
  // note, and every writer here reads the list out of the closure it was built
  // in — so a loop would write each result over the same snapshot and keep only
  // the last. The same reason `useAdoptVoiceCaptures` adopts one at a time.
  return notes.find((note) => note.kind === 'plan' && note.voice !== null && transcribed[note.id] !== true) ?? null;
}

/**
 * The plans that should be in the bucket and are not, oldest first.
 *
 * Two things have to be true. **It has to say something** — a plan with no words
 * is a recording still waiting on its transcript, and sending an empty one would
 * put a row on the other end that means nothing and would never be corrected.
 * And **it has to differ from what went last time**, by fingerprint rather than
 * by a flag: editing a plan has to send it again, and only its content knows
 * that. Comparing fingerprints is also what makes running this twice free.
 *
 * The fingerprint is a parameter because hashing bytes is not this layer's
 * business — the same split `useBackup` already uses.
 */
export function plansToSend(
  notes: readonly DayNote[],
  sent: Readonly<Record<string, string>>,
  fingerprintOf: (note: DayNote) => string,
): readonly DayNote[] {
  return notes
    .filter((note) => note.kind === 'plan' && words(note).length > 0)
    .filter((note) => sent[planKey(note.id)] !== fingerprintOf(note))
    .sort((a, b) => a.at - b.at);
}

/**
 * Plans that have been spoken and have no words yet, for the count on screen.
 *
 * **A queue nobody can see is a queue that fails silently**, which is the whole
 * complaint the transcription button's on-screen error already answered. A
 * phone with no key, no bucket or no signal holds plans indefinitely and must be
 * able to say how many.
 */
export function plansWaiting(
  notes: readonly DayNote[],
  sent: Readonly<Record<string, string>>,
  fingerprintOf: (note: DayNote) => string,
): number {
  const unsent = plansToSend(notes, sent, fingerprintOf).length;
  const unspoken = notes.filter(
    (note) => note.kind === 'plan' && note.voice !== null && words(note).length === 0,
  ).length;
  return unsent + unspoken;
}

/** One plan, ready to be serialised. Nothing here reads a clock or an id source. */
export function planPayload(note: DayNote): PlanPayload {
  return {
    version: PLAN_FORMAT_VERSION,
    id: note.id,
    at: note.at,
    title: note.title,
    text: note.text,
    spokenMs: note.voice ? note.voice.durationMs : null,
  };
}

/**
 * What the Plans list says about its own queue, or null when there is nothing
 * to say.
 *
 * **A queue nobody can see is a queue that fails silently.** That is the exact
 * complaint the transcription button's on-screen error answered, and it applies
 * harder here because nothing about this is a press: a phone with no bucket
 * configured would otherwise hold plans for ever while looking perfectly
 * healthy. So the count is on the screen the plans are on, and the two states
 * that are not failures — everything sent, nothing recorded yet — say nothing
 * at all rather than printing a reassurance nobody asked for.
 */
export function planQueueLine(waiting: number, configured: boolean): string | null {
  if (waiting === 0) return null;
  const count = waiting === 1 ? '1 plan' : `${waiting} plans`;
  return configured ? `${count} still to send.` : `${count} held on this phone. Add a bucket in Settings to send them.`;
}
