/**
 * What the machine at home decided, as this phone reads it.
 *
 * **The format is documented once, in `server/planner/agenda.py`, and this
 * parses exactly that.** A format described in two places is a format that
 * drifts — so the shape lives there with the code that writes it, and this file
 * is only the trust boundary around it.
 *
 * That boundary is the point. Everything here arrives from off the phone, which
 * makes it the first thing in the app that is genuinely *not* ours: the backup
 * is written by this phone and read by nothing, the transcription comes back
 * into one field, and a fix is judged before it is believed. An agenda is a
 * whole document somebody else built, and the app draws a screen from it.
 *
 * **So a bad item is dropped and the rest is kept.** Not the diary's rule —
 * `normalizeDayNotes` repairs, because a note is unreconstructable and dropping
 * one loses it for ever. Nothing here is unreconstructable: the truth is in
 * Postgres at home, and an item this build cannot read is one row missing from a
 * screen until the next publish. Repairing it would mean inventing a decision
 * nobody made, which is the one thing this must never do.
 */

/** Bumped by the writer when the shape changes. See `AGENDA_VERSION` there. */
export const AGENDA_VERSION = 1;

export type Shape = 'once' | 'recurring' | 'series' | 'habit';
export type Urgency = 'whenever' | 'soon' | 'deadline';
export type Energy = 'low' | 'medium' | 'high';

const SHAPES: readonly Shape[] = ['once', 'recurring', 'series', 'habit'];
const URGENCIES: readonly Urgency[] = ['whenever', 'soon', 'deadline'];
const ENERGIES: readonly Energy[] = ['low', 'medium', 'high'];

export interface AgendaItem {
  /** The commitment id, derived at the other end from the plan and the title. */
  readonly id: string;
  readonly title: string;
  readonly detail: string;
  readonly shape: Shape;
  readonly urgency: Urgency;
  /** `YYYY-MM-DD`, or null. Kept as the string it was sent as — see below. */
  readonly deadline: string | null;
  readonly effortMinutes: number | null;
  readonly context: string | null;
  readonly energy: Energy;
  /** When it is suggested for, or null when it is only on the list. */
  readonly suggestedAt: number | null;
  /** Why then, in the model's own words. Empty when there is no time. */
  readonly why: string;
  /** The words in your plan this came out of. What lets a row say why it exists. */
  readonly quote: string;
  /** When the plan behind it was said. */
  readonly saidAt: number;
}

export interface Agenda {
  readonly version: number;
  readonly generatedAt: number;
  readonly items: readonly AgendaItem[];
}

/** Nothing has been read yet, or there was nothing in it. */
export const EMPTY_AGENDA: Agenda = { version: AGENDA_VERSION, generatedAt: 0, items: [] };

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function instant(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : null;
}

function oneOf<T extends string>(value: unknown, allowed: readonly T[]): T | null {
  return typeof value === 'string' && (allowed as readonly string[]).includes(value) ? (value as T) : null;
}

/**
 * A deadline is kept as the string it arrived as, never parsed into an instant.
 *
 * "By the first of March" is a wall-clock fact about a day, and turning it into
 * a millisecond here would mean choosing a time of day and a zone that nobody
 * said — the same reason a note's instant is chosen rather than derived. The
 * screen prints it; nothing computes with it.
 */
function isoDate(value: unknown): string | null {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : null;
}

function readItem(candidate: unknown): AgendaItem | null {
  if (typeof candidate !== 'object' || candidate === null) return null;
  const row = candidate as Record<string, unknown>;

  const id = text(row.id);
  const title = text(row.title);
  const saidAt = instant(row.saidAt);
  const shape = oneOf(row.shape, SHAPES);
  const urgency = oneOf(row.urgency, URGENCIES);
  const energy = oneOf(row.energy, ENERGIES);

  // **A row with no title says nothing on a screen**, and an unknown shape or
  // urgency would be drawn as a state this build has no words for. Both are a
  // newer writer rather than corruption, and both are one missing row until the
  // next publish.
  if (!id || !title || saidAt === null || !shape || !urgency || !energy) return null;

  const effort = row.effortMinutes;
  return {
    id,
    title,
    detail: text(row.detail),
    shape,
    urgency,
    deadline: isoDate(row.deadline),
    effortMinutes: typeof effort === 'number' && Number.isFinite(effort) && effort > 0 ? Math.round(effort) : null,
    context: text(row.context) || null,
    energy,
    suggestedAt: instant(row.suggestedAt),
    why: text(row.why),
    quote: text(row.quote),
    saidAt,
  };
}

/**
 * One downloaded agenda, checked.
 *
 * **A newer version is refused whole rather than read as far as it goes.** The
 * items are the part most likely to have changed shape, and half-reading them
 * would put a screen in front of somebody that is confidently missing whatever
 * the new version added. Keeping the last agenda this build understood is the
 * honest answer, and the caller says so.
 */
export function readAgenda(input: unknown): Agenda | null {
  if (typeof input !== 'object' || input === null) return null;
  const body = input as Record<string, unknown>;

  if (body.version !== AGENDA_VERSION) return null;
  const generatedAt = instant(body.generatedAt);
  if (generatedAt === null) return null;
  if (!Array.isArray(body.items)) return null;

  const items = body.items.flatMap((one) => {
    const read = readItem(one);
    return read ? [read] : [];
  });

  return { version: AGENDA_VERSION, generatedAt, items };
}

/**
 * What to show, in the order it was sent.
 *
 * **The phone does not re-sort.** The machine has more to sort by than this
 * screen can see — everything else competing for the same evening — and two
 * orderings would be two answers to one question. This only cuts the list at
 * what is worth a glance.
 */
export function nextUp(agenda: Agenda, count: number): readonly AgendaItem[] {
  return agenda.items.slice(0, Math.max(0, count));
}

/**
 * Whether an agenda is old enough to say so.
 *
 * The machine at home sleeps, and a phone showing four-day-old suggestions as
 * though they were this morning's is the app being confidently wrong. Nothing
 * hides — the screen adds a line saying when it was worked out.
 */
export function isStale(agenda: Agenda, now: number, afterMs: number): boolean {
  return agenda.generatedAt > 0 && now - agenda.generatedAt > afterMs;
}
