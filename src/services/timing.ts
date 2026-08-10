import { monotonicNow } from './clock';

/**
 * Where the time went, measured rather than guessed.
 *
 * The first tab takes a moment to appear and nothing said why — so the slow
 * paths record how long they took, and the Data screen prints the list. This is
 * the instrumentation half of the performance audit on the backlog: the audit
 * ranks by measurement, and these are the measurements.
 *
 * **In memory only, this session only.** Persisting timings would be the app
 * surveilling itself into the vault for no reader; nothing here leaves the
 * device or survives a relaunch, and the list is capped so a long session
 * cannot grow it without bound. Nothing here is printed either — see below.
 *
 * ## The two rules, because this is the one subsystem whose job is to watch
 *
 * **A name says a shape, never a content.** A duration, a count and a byte size
 * are facts about the machine. A coordinate, a place name, a note or a capture's
 * file name are the diary itself. `fold 4200 fixes` is a measurement;
 * `stay at Home 2h` would be an entry. This is why a store read records the
 * family of the key rather than the key — `fix-archive/2026-08-09` names a date
 * its owner had data on, which is a small thing to leak into a label and an
 * easy pattern to stop copying.
 *
 * **Nothing is ever written to `console`.** That is the vector that actually
 * exists here, and it is not the network: device logs are readable through
 * Console.app and are swept into a sysdiagnose, which is a bundle a person
 * deliberately sends to Apple. A span held in this array has not left the
 * sandbox; the same span printed has. Keep it that way, and keep these out of
 * the CSV export too — that one goes through the share sheet.
 *
 * ## Why the shape is what it is
 *
 * All three of these were invisible at a launch path's dozen calls and become
 * real the moment anything measures per fix or per frame, which is what the
 * remaining audits will want:
 *
 * - **`push`, not a fresh array.** This built `spans = [...spans, span]`, which
 *   is O(n) per call and O(n²) over a session. The array is module-private and
 *   never handed out unsorted, so the immutability bought nothing.
 * - **The label is built when it is read, not when it is recorded.** The size
 *   and the count arrive as numbers and `labelOf` formats the handful actually
 *   drawn. Formatting at the call site meant every store read paid for a string
 *   — including after the cap, where `record` discards it, so the work was pure
 *   waste at exactly the point the cap exists to stop work.
 * - **A monotonic clock.** See `monotonicNow`: a wall-clock correction landing
 *   inside a span yields a duration that is wrong by however far the clock
 *   moved, and a negative one sorts straight to the top of "what was slow".
 */

/** What a count is counting. Deliberately a closed set: a free-form unit is a free-form label. */
export type SpanUnit = 'fixes' | 'kB' | 'items' | 'days';

export interface Span {
  /** The shape being measured. A constant where the call site can manage one. */
  readonly name: string;
  readonly ms: number;
  /** Ms since this module loaded, which is as close to launch as JS can see. */
  readonly at: number;
  /** How much of the thing, if the caller knew. Formatted lazily by `labelOf`. */
  readonly amount: number | null;
  readonly unit: SpanUnit | null;
}

const CAP = 120;

const startedAt = monotonicNow();
const spans: Span[] = [];

/** Time one piece of work, under the name the Data screen will print. */
export async function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
  const began = monotonicNow();
  try {
    return await work();
  } finally {
    record(name, monotonicNow() - began);
  }
}

/**
 * Record a duration measured elsewhere.
 *
 * `amount` and `unit` are two parameters rather than an object so that a hot
 * call site allocates nothing at all — not even the small record that would be
 * thrown away once the cap is reached.
 */
export function record(name: string, ms: number, amount?: number, unit?: SpanUnit): void {
  if (spans.length >= CAP) return;

  spans.push({
    name,
    ms: Math.round(ms),
    at: Math.round(monotonicNow() - startedAt),
    amount: amount ?? null,
    unit: unit ?? null,
  });
}

/** Everything measured this session, slowest first — the only order that answers "what was slow". */
export function measuredSpans(): readonly Span[] {
  return [...spans].sort((a, b) => b.ms - a.ms);
}

/**
 * What to print for one span.
 *
 * Called for the rows actually drawn rather than for everything recorded, which
 * is the whole point of storing the count as a number.
 */
export function labelOf(span: Span): string {
  if (span.amount === null || span.unit === null) return span.name;
  return `${span.name} (${span.amount} ${span.unit})`;
}

export function __resetTimings(): void {
  spans.length = 0;
}
