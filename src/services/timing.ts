import { now } from './clock';

/**
 * Where the launch went, measured rather than guessed.
 *
 * The first tab takes a moment to appear and nothing said why — so the slow
 * paths record how long they took, and the Data screen prints the list. This
 * is the instrumentation half of the performance audit on the backlog: the
 * audit ranks by measurement, and these are the measurements.
 *
 * In memory only, this session only. Persisting timings would be the app
 * surveilling itself into the vault for no reader; nothing here leaves the
 * device or survives a relaunch, and the list is capped so a long session
 * cannot grow it without bound.
 */

export interface Span {
  readonly name: string;
  readonly ms: number;
  /** Ms since this module loaded, which is as close to launch as JS can see. */
  readonly at: number;
}

const CAP = 120;

const startedAt = now();
let spans: Span[] = [];

/** Time one piece of work, under the name the Data screen will print. */
export async function timed<T>(name: string, work: () => Promise<T>): Promise<T> {
  const began = now();
  try {
    return await work();
  } finally {
    record(name, now() - began);
  }
}

/** Record a duration measured elsewhere. */
export function record(name: string, ms: number): void {
  if (spans.length >= CAP) return;
  spans = [...spans, { name, ms: Math.round(ms), at: Math.round(now() - startedAt) }];
}

/** Everything measured this session, slowest first — the only order that answers "what was slow". */
export function measuredSpans(): readonly Span[] {
  return [...spans].sort((a, b) => b.ms - a.ms);
}

export function __resetTimings(): void {
  spans = [];
}
