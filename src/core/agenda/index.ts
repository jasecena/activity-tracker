/**
 * What the machine at home decided, as this phone reads it.
 *
 * **The format is documented once, in the server’s own `agenda.py`, and this
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
export type Priority = 'low' | 'normal' | 'high';

const SHAPES: readonly Shape[] = ['once', 'recurring', 'series', 'habit'];
const URGENCIES: readonly Urgency[] = ['whenever', 'soon', 'deadline'];
const ENERGIES: readonly Energy[] = ['low', 'medium', 'high'];
const PRIORITIES: readonly Priority[] = ['low', 'normal', 'high'];

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
  /**
   * How much it matters, which is a different question from when it must happen.
   *
   * **This is a list of a life, not a to-do list** — dated tasks and hard
   * deadlines live in a different app entirely — so almost everything here is
   * `whenever`, and urgency alone would sort the whole list into one heap. This
   * is what actually separates them. Defaults to `normal`, which is also what
   * most things are.
   */
  readonly priority: Priority;
  /**
   * What has to happen first, in your own words, or empty.
   *
   * Free text and deliberately not a link: the model reads one plan at a time
   * and cannot know another commitment's id. Turning these into real edges is a
   * later step, and a field that looked like a reference and was not would be
   * worse than one that admits what it is.
   */
  readonly dependsOn: string;
  /** When it is suggested for, or null when it is only on the list. */
  readonly suggestedAt: number | null;
  /** Why then, in the model's own words. Empty when there is no time. */
  readonly why: string;
  /** The words in your plan this came out of. What lets a row say why it exists. */
  readonly quote: string;
  /** When the plan behind it was said. */
  readonly saidAt: number;
  /**
   * Every recording this came out of, by plan id — oldest first.
   *
   * **A plan id is a `DayNote` id**, which is what makes this linkage free and
   * what keeps the promise Settings makes. The phone named the object
   * `plans/<note-id>.json` when it sent it, so the machine can hand the same id
   * back and this phone looks up its own note and, through it, the recording on
   * disk. **No file name ever leaves the device**, and none is needed.
   *
   * **Both directions live here.** One recording holds several items — several
   * agenda items naming the same plan id. One item is heard in several
   * recordings — several plan ids on one item, which is what happens when you
   * say the same thing again a fortnight later.
   *
   * Nothing draws this yet. It is carried, validated and kept so that the day
   * something wants it, the link is already there rather than lost.
   */
  readonly mentions: readonly string[];
  /**
   * How many recordings mentioned it.
   *
   * Not `mentions.length` — the writer decides it, and the two could differ if
   * a mention were ever recorded without its plan surviving. Trusting the count
   * the sender computed is the same discipline as not re-sorting the list.
   *
   * Repetition is emphasis: something raised three times over a fortnight is on
   * somebody's mind in a way something said once is not. The machine already
   * uses it to order the list; this phone only carries it.
   */
  readonly mentionCount: number;
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

  // Ids only, and only ones shaped like ids. A malformed entry here would be a
  // link to nothing rather than a link to the wrong thing, but dropping it is
  // still cheaper than carrying it.
  const mentions = Array.isArray(row.mentions)
    ? row.mentions
        .filter((one): one is string => typeof one === 'string' && one.trim().length > 0)
        .map((one) => one.trim())
    : [];

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
    // Anything unrecognised reads as `normal` rather than dropping the row: an
    // item whose importance cannot be read is still an item.
    priority: oneOf(row.priority, PRIORITIES) ?? 'normal',
    dependsOn: text(row.dependsOn),
    suggestedAt: instant(row.suggestedAt),
    why: text(row.why),
    quote: text(row.quote),
    saidAt,
    mentions,
    // Never below one: a row exists because something was said, so a count of
    // zero is a writer being wrong rather than a fact about the world.
    mentionCount: Math.max(
      typeof row.mentionCount === 'number' && Number.isFinite(row.mentionCount) ? Math.round(row.mentionCount) : 0,
      mentions.length,
      1,
    ),
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

/**
 * The recordings behind one agenda item, as this phone's own notes.
 *
 * **The whole linkage, and it costs one lookup.** A plan id *is* a `DayNote`
 * id — the phone named the object after its own note when it sent it — so
 * resolving what the machine decided back to what you actually said needs
 * nothing from the network and nothing stored on either side beyond the id.
 *
 * A miss is ordinary rather than broken, and every caller has to expect it: the
 * note may have been deleted since it was sent, and the agenda would not know.
 * The same shape as a `DayNote.mediaId` pointing at a forgotten capture.
 *
 * Nothing calls this yet. It is here so the link is provable rather than
 * merely intended — a test walks it end to end, from an agenda item to the
 * recording on disk.
 */
export function notesBehind<T extends { readonly id: string }>(
  item: Pick<AgendaItem, 'mentions'>,
  notes: readonly T[],
): readonly T[] {
  const wanted = new Set(item.mentions);
  return notes.filter((note) => wanted.has(note.id));
}
