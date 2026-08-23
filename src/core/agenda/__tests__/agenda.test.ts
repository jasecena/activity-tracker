import { AGENDA_VERSION, isStale, nextUp, notesBehind, readAgenda, type Agenda } from '../index';

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
    priority: 'normal',
    dependsOn: '',
    suggestedAt: null,
    why: '',
    quote: 'I need to fix the garden',
    saidAt: T0,
    mentions: ['note-1'],
    mentionCount: 1,
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

/**
 * The linkage back to what was actually said.
 *
 * One recording holds several items and one item is heard in several
 * recordings, and both directions have to survive the pipe. Nothing draws this
 * yet — it is carried so that the day something wants it, the link is there
 * rather than lost.
 */
describe('wiring an item back to its recordings', () => {
  it('keeps every recording it was heard in', () => {
    const read = readAgenda(agenda([item({ mentions: ['note-1', 'note-2'], mentionCount: 2 })]));

    expect(read?.items[0]?.mentions).toEqual(['note-1', 'note-2']);
    expect(read?.items[0]?.mentionCount).toBe(2);
  });

  it('never carries a file name, only an id', () => {
    const read = readAgenda(agenda([item({ mentions: ['note-1'] })]));

    expect(JSON.stringify(read)).not.toContain('.m4a');
  });

  it('drops a link that is not an id rather than pointing at nothing', () => {
    const read = readAgenda(agenda([item({ mentions: ['note-1', '', 42, null] })]));

    expect(read?.items[0]?.mentions).toEqual(['note-1']);
  });

  /** A row exists because something was said, so zero is a writer being wrong. */
  it('never counts a mention below one', () => {
    expect(readAgenda(agenda([item({ mentions: [], mentionCount: 0 })]))?.items[0]?.mentionCount).toBe(1);
  });

  it('trusts a count higher than the ids it was sent', () => {
    const read = readAgenda(agenda([item({ mentions: ['note-1'], mentionCount: 3 })]));

    expect(read?.items[0]?.mentionCount).toBe(3);
  });

  it('reads an agenda written before mentions existed', () => {
    const { mentions, mentionCount, ...older } = item();
    void mentions;
    void mentionCount;

    expect(readAgenda(agenda([older]))?.items[0]?.mentions).toEqual([]);
  });

  /**
   * **A plan id is a `DayNote` id**, which is the whole of the linkage: the
   * phone named the object after its own note when it sent it, so this walk
   * needs nothing from the network and no file name ever left the device.
   */
  describe('resolving one back to the notes on this phone', () => {
    const notes = [
      { id: 'note-1', voice: { fileName: 'voice-1.m4a' } },
      { id: 'note-2', voice: { fileName: 'voice-2.m4a' } },
      { id: 'note-3', voice: null },
    ];

    it('finds every recording behind one item', () => {
      const one = readAgenda(agenda([item({ mentions: ['note-1', 'note-2'] })]))!.items[0]!;

      expect(notesBehind(one, notes).map((note) => note.voice?.fileName)).toEqual(['voice-1.m4a', 'voice-2.m4a']);
    });

    it('finds the several items that came out of one recording', () => {
      const read = readAgenda(
        agenda([
          item({ id: 'a', mentions: ['note-1'] }),
          item({ id: 'b', mentions: ['note-1'] }),
          item({ id: 'c', mentions: ['note-2'] }),
        ]),
      )!;
      const fromOne = read.items.filter((one) => one.mentions.includes('note-1'));

      expect(fromOne.map((one) => one.id)).toEqual(['a', 'b']);
    });

    /** The note may have been deleted since. Ordinary, not broken. */
    it('says nothing rather than inventing a note that has gone', () => {
      const one = readAgenda(agenda([item({ mentions: ['note-gone'] })]))!.items[0]!;

      expect(notesBehind(one, notes)).toEqual([]);
    });
  });
});

/**
 * **This is a list of a life, not a to-do list.** Dated tasks and hard deadlines
 * live in a different application; almost everything here is `whenever`, which
 * is why importance has to be its own field rather than being read off urgency.
 */
describe('how much a thing matters', () => {
  it('keeps what the machine decided', () => {
    expect(readAgenda(agenda([item({ priority: 'high' })]))?.items[0]?.priority).toBe('high');
  });

  it('is normal when nothing said otherwise', () => {
    expect(readAgenda(agenda([item({ priority: undefined })]))?.items[0]?.priority).toBe('normal');
  });

  /** An item whose importance cannot be read is still an item. */
  it('reads an unknown priority as normal rather than dropping the row', () => {
    const read = readAgenda(agenda([item({ priority: 'critical' })]));

    expect(read?.items).toHaveLength(1);
    expect(read?.items[0]?.priority).toBe('normal');
  });

  it('carries what has to happen first, in your own words', () => {
    expect(readAgenda(agenda([item({ dependsOn: 'once the fence is up' })]))?.items[0]?.dependsOn).toBe(
      'once the fence is up',
    );
  });

  it('is empty when nothing has to happen first', () => {
    expect(readAgenda(agenda([item()]))?.items[0]?.dependsOn).toBe('');
  });

  it('reads an agenda written before either existed', () => {
    const { priority, dependsOn, ...older } = item();
    void priority;
    void dependsOn;
    const read = readAgenda(agenda([older]));

    expect(read?.items[0]?.priority).toBe('normal');
    expect(read?.items[0]?.dependsOn).toBe('');
  });
});
