import { AGENDA_VERSION, isStale, nextUp, readAgenda, type Agenda } from '../index';

/**
 * The first thing in this app that arrives from off the phone as a whole
 * document, so the tests are mostly about what it refuses.
 *
 * The rule differs from the diary's on purpose: `normalizeDayNotes` repairs,
 * because a note is unreconstructable. Nothing here is — the truth sits in
 * Postgres at home — so a bad item is dropped and the rest kept, and repairing
 * one would mean inventing a decision nobody made.
 */

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);
const HOUR = 3_600_000;

function item(over: Record<string, unknown> = {}) {
  return {
    id: 'abc123',
    title: 'Fix the garden',
    detail: '',
    shape: 'once',
    urgency: 'whenever',
    deadline: null,
    effortMinutes: null,
    context: null,
    energy: 'low',
    suggestedAt: null,
    why: '',
    quote: 'I need to fix the garden',
    saidAt: T0,
    ...over,
  };
}

function agenda(items: unknown[] = [item()], over: Record<string, unknown> = {}) {
  return { version: AGENDA_VERSION, generatedAt: T0, items, ...over };
}

describe('reading one', () => {
  it('keeps everything a row is drawn from', () => {
    const read = readAgenda(
      agenda([item({ detail: 'the back one', effortMinutes: 90, context: 'backyard', energy: 'high' })]),
    );

    expect(read?.items[0]).toMatchObject({
      id: 'abc123',
      title: 'Fix the garden',
      detail: 'the back one',
      effortMinutes: 90,
      context: 'backyard',
      energy: 'high',
    });
  });

  it('keeps why it is there, which is what makes the list worth opening', () => {
    const read = readAgenda(agenda([item({ suggestedAt: T0 + HOUR, why: 'Saturday, while there is light' })]));

    expect(read?.items[0]?.suggestedAt).toBe(T0 + HOUR);
    expect(read?.items[0]?.why).toBe('Saturday, while there is light');
  });

  it('keeps Persian intact', () => {
    const read = readAgenda(agenda([item({ title: 'باغچه پشتی را درست کن' })]));

    expect(read?.items[0]?.title).toBe('باغچه پشتی را درست کن');
  });

  /**
   * A day is a wall-clock fact, and turning it into a millisecond here would
   * mean choosing a time of day and a zone nobody said.
   */
  it('keeps a deadline as the day it was sent as', () => {
    expect(readAgenda(agenda([item({ deadline: '2026-03-01' })]))?.items[0]?.deadline).toBe('2026-03-01');
  });

  it('refuses a deadline that is not a day', () => {
    expect(readAgenda(agenda([item({ deadline: 'next March' })]))?.items[0]?.deadline).toBeNull();
  });

  it('reads an absent time as no time rather than as zero', () => {
    expect(readAgenda(agenda())?.items[0]?.suggestedAt).toBeNull();
  });
});

describe('what it drops rather than draws', () => {
  it('drops a row with no title, which would say nothing on a screen', () => {
    expect(readAgenda(agenda([item({ title: '   ' })]))?.items).toEqual([]);
  });

  it('drops a row with no id, which nothing could be done about', () => {
    expect(readAgenda(agenda([item({ id: '' })]))?.items).toEqual([]);
  });

  it.each(['shape', 'urgency', 'energy'])('drops a row whose %s this build has no words for', (field) => {
    expect(readAgenda(agenda([item({ [field]: 'something-new' })]))?.items).toEqual([]);
  });

  it('keeps the rest of the list when one row is unreadable', () => {
    const read = readAgenda(agenda([item({ id: 'good' }), item({ id: 'bad', shape: 'invented' })]));

    expect(read?.items.map((one) => one.id)).toEqual(['good']);
  });

  it('drops an effort that is not a duration', () => {
    expect(readAgenda(agenda([item({ effortMinutes: -5 })]))?.items[0]?.effortMinutes).toBeNull();
  });
});

describe('refusing the whole document', () => {
  /**
   * Half-reading a newer agenda would put a screen in front of somebody that is
   * confidently missing whatever the new version added. Keeping the last one
   * this build understood is the honest answer.
   */
  it('refuses a version it does not know, whole', () => {
    expect(readAgenda(agenda([item()], { version: 2 }))).toBeNull();
  });

  it('refuses anything that is not an object', () => {
    expect(readAgenda(null)).toBeNull();
    expect(readAgenda([])).toBeNull();
    expect(readAgenda('{}')).toBeNull();
  });

  it('refuses one with no instant on it', () => {
    expect(readAgenda(agenda([item()], { generatedAt: 0 }))).toBeNull();
  });

  it('refuses one whose items are not a list', () => {
    expect(readAgenda(agenda([], { items: 'none' }))).toBeNull();
  });

  it('reads an empty agenda as empty rather than refusing it', () => {
    expect(readAgenda(agenda([]))?.items).toEqual([]);
  });
});

describe('what to show', () => {
  const many: Agenda = {
    version: AGENDA_VERSION,
    generatedAt: T0,
    items: ['a', 'b', 'c', 'd'].map((id) => readAgenda(agenda([item({ id })]))!.items[0]!),
  };

  /** The machine has more to sort by than this screen can see. */
  it('keeps the order it was sent in', () => {
    expect(nextUp(many, 3).map((one) => one.id)).toEqual(['a', 'b', 'c']);
  });

  it('asks for none and gets none', () => {
    expect(nextUp(many, 0)).toEqual([]);
    expect(nextUp(many, -1)).toEqual([]);
  });

  it('asks for more than there are and gets what there is', () => {
    expect(nextUp(many, 99)).toHaveLength(4);
  });
});

/**
 * The machine at home sleeps. A phone showing four-day-old suggestions as though
 * they were this morning's is the app being confidently wrong.
 */
describe('how old it is', () => {
  const one = readAgenda(agenda())!;

  it('is not stale while it is fresh', () => {
    expect(isStale(one, T0 + HOUR, 24 * HOUR)).toBe(false);
  });

  it('is stale once it is older than the window', () => {
    expect(isStale(one, T0 + 25 * HOUR, 24 * HOUR)).toBe(true);
  });

  it('says nothing about an agenda that was never read', () => {
    expect(isStale({ version: AGENDA_VERSION, generatedAt: 0, items: [] }, T0, 1)).toBe(false);
  });
});
