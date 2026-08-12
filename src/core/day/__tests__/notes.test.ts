import {
  appendTranscript,
  dayNoteId,
  daysWorthOpening,
  freeInstant,
  normalizeDayNotes,
  noteAt,
  notesForDay,
  TRANSCRIPT_SEPARATOR,
  voiceFilesOf,
  whereToWrite,
  type DayNote,
  type NoteVoice,
} from '../notes';
import type { Segment } from '../../segments';

/**
 * A note is the one thing in the store that is not derived from anything, and
 * the one thing nothing can reconstruct. Most of what is asserted here is about
 * not losing one: not to a blank save, not to two notes wanting the same
 * instant, not to a stored row an older build wrote differently.
 *
 * UTC throughout — `jest.config.js` pins the suite to it, so a day key here
 * reads as the calendar day it looks like.
 */

const UTC = 0;
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const HOUR = 3_600_000;

function note(at: number, text = 'something', title = ''): DayNote {
  return { id: dayNoteId(at), at, title, text, voice: null };
}

function voice(startedAt: number): NoteVoice {
  return { fileName: `voice-${startedAt}.m4a`, durationMs: 42_000, byteLength: 96_000, at: null };
}

function stay(startedAt: number, endedAt: number): Segment {
  return {
    kind: 'stay',
    id: `seg-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 4,
    center: { lat: 0, lon: 0 },
    radiusM: 5,
  };
}

describe('writing one', () => {
  it('keeps the words and derives the id from the instant', () => {
    expect(noteAt(T0, 'Market day', 'Walked there with Sam')).toEqual({
      id: `note-${T0}`,
      at: T0,
      title: 'Market day',
      text: 'Walked there with Sam',
      voice: null,
    });
  });

  it('trims, because trailing space is not content', () => {
    const written = noteAt(T0, '  Market day  ', '  the long way home  ');

    expect(written?.title).toBe('Market day');
    expect(written?.text).toBe('the long way home');
  });

  /**
   * Blank is the absence of a note rather than an empty one. A row with nothing
   * in it cannot be read, cannot be tapped accurately and cannot be explained.
   */
  it('refuses to write nothing', () => {
    expect(noteAt(T0, '', '')).toBeNull();
    expect(noteAt(T0, '  ', '   \n  ')).toBeNull();
  });

  /**
   * Either field on its own is a real entry. "Moved house" says the day; so
   * does a paragraph nobody wanted to name. Requiring both would be the app
   * deciding how somebody keeps a diary.
   */
  it('accepts a title with no body, and a body with no title', () => {
    expect(noteAt(T0, 'Moved house', '')?.title).toBe('Moved house');
    expect(noteAt(T0, '', 'rain all day')?.text).toBe('rain all day');
  });

  /**
   * Talking is the third way of writing the same entry, not a different kind of
   * row. A recording with no words is an entry — it is how you write something
   * down while walking — and a recording you later typed under is still one
   * note rather than two.
   */
  it('accepts a recording with nothing typed', () => {
    const spoken = noteAt(T0, '', '', voice(T0));

    expect(spoken?.voice?.fileName).toBe(`voice-${T0}.m4a`);
    expect(spoken?.text).toBe('');
  });

  it('carries a recording and words together on one note', () => {
    const both = noteAt(T0, 'Market day', 'and what I said about it', voice(T0));

    expect(both?.voice).not.toBeNull();
    expect(both?.title).toBe('Market day');
  });

  it('keeps its id when rewritten at the same instant', () => {
    const first = note(T0, 'rain all day');

    const second = noteAt(first.at, '', 'rain all morning, then sun');

    expect(second?.id).toBe(first.id);
    expect(second?.text).toBe('rain all morning, then sun');
  });

  /**
   * The instant is choosable, so an edit can move a note — to another time, or
   * to another day entirely. The id moves with it, which is what makes the old
   * row go rather than the two of them coexisting.
   */
  it('takes a new id when moved to another instant', () => {
    const moved = noteAt(T0 + 3 * HOUR, '', 'rain all day');

    expect(moved?.id).toBe(dayNoteId(T0 + 3 * HOUR));
    expect(moved?.id).not.toBe(dayNoteId(T0));
  });
});

/**
 * Ids come from instants, so two notes on one instant would be one note that
 * had silently eaten the other. Reachable in practice: every note added to a
 * finished day wants the same instant, the end of its last segment.
 */
describe('two notes wanting the same instant', () => {
  it('moves the second along rather than overwriting the first', () => {
    const taken = [note(T0), note(T0 + 1)];

    expect(freeInstant(taken, T0)).toBe(T0 + 2);
  });

  it('leaves a free instant alone', () => {
    expect(freeInstant([note(T0)], T0 + HOUR)).toBe(T0 + HOUR);
  });

  it('has nothing to avoid on an empty diary', () => {
    expect(freeInstant([], T0)).toBe(T0);
  });
});

describe('where a new note goes', () => {
  const today = '2026-01-05';

  it('sits at now, when the day being written about is today', () => {
    const now = T0 + 5 * HOUR;

    expect(whereToWrite(today, [stay(T0, T0 + HOUR)], now, UTC)).toBe(now);
  });

  /**
   * A finished day is being looked back on, so the note goes after the last
   * thing that happened — where an evening's reflection belongs.
   */
  it('sits at the end of a day already over', () => {
    const now = Date.UTC(2026, 0, 9, 20, 0, 0);
    const segments = [stay(T0, T0 + HOUR), stay(T0 + 2 * HOUR, T0 + 3 * HOUR)];

    expect(whereToWrite(today, segments, now, UTC)).toBe(T0 + 3 * HOUR);
  });

  /**
   * Noon rather than the start of the day: midnight belongs to the day before
   * as far as anybody reading it is concerned, and a note is worth being
   * unambiguous about.
   */
  it('sits at noon on a past day that recorded nothing', () => {
    const now = Date.UTC(2026, 0, 9, 20, 0, 0);

    expect(whereToWrite(today, [], now, UTC)).toBe(Date.UTC(2026, 0, 9, 12, 0, 0));
  });
});

describe('reading a day back', () => {
  it('takes only the notes belonging to it, oldest first', () => {
    const notes = [note(T0 + 2 * HOUR, 'later'), note(T0, 'earlier'), note(T0 + 48 * HOUR, 'another day')];

    expect(notesForDay(notes, '2026-01-05', UTC).map((one) => one.text)).toEqual(['earlier', 'later']);
  });
});

/**
 * `groupByDay` builds its list out of segments, so a day the app recorded
 * nothing on does not exist as far as the Day screen is concerned. That was
 * fine while a day *was* its segments, and stops being fine the moment one can
 * hold a sentence instead.
 */
describe('the days you can open', () => {
  const recorded = { key: '2026-01-05', startedAt: Date.UTC(2026, 0, 5), segments: [stay(T0, T0 + HOUR)] };
  const now = Date.UTC(2026, 0, 9, 20, 0, 0);

  it('includes today even when nothing has ever been recorded', () => {
    const days = daysWorthOpening([], [], now, UTC);

    expect(days.map((day) => day.key)).toEqual(['2026-01-09']);
    expect(days[0]?.segments).toEqual([]);
  });

  // The day worth writing about rather than measuring: somewhere with no signal,
  // which is exactly the day the app has no segments for.
  it('includes a day that has only a note', () => {
    const days = daysWorthOpening([recorded], [note(Date.UTC(2026, 0, 7, 12, 0, 0))], now, UTC);

    expect(days.map((day) => day.key)).toEqual(['2026-01-09', '2026-01-07', '2026-01-05']);
  });

  it('does not duplicate a day that has both', () => {
    const days = daysWorthOpening([recorded], [note(T0 + 2 * HOUR)], now, UTC);

    expect(days.filter((day) => day.key === '2026-01-05')).toHaveLength(1);
    expect(days.find((day) => day.key === '2026-01-05')?.segments).toHaveLength(1);
  });

  it('keeps newest first, which is the order the arrows walk', () => {
    const days = daysWorthOpening([recorded], [note(Date.UTC(2026, 0, 7, 12, 0, 0))], now, UTC);

    expect(days.map((day) => day.startedAt)).toEqual([...days.map((day) => day.startedAt)].sort((a, b) => b - a));
  });
});

/**
 * The bar for "unrecognisable" is deliberately lower here than for a fix or a
 * segment. A malformed reading can go, because thousands more are coming; a
 * note is the one row nobody and nothing can reconstruct.
 */
describe('reading the store back', () => {
  it('keeps a note whose id no build ever wrote, rebuilding it from the instant', () => {
    expect(normalizeDayNotes([{ id: 'whatever-this-is', at: T0, text: 'kept' }])).toEqual([
      { id: dayNoteId(T0), at: T0, title: '', text: 'kept', voice: null },
    ]);
  });

  /**
   * Titles arrived after the first notes did, so an entry written by the build
   * before this one has no title at all. A missing field, not a broken row —
   * and the body is the part nothing could reconstruct.
   */
  it('reads a note written before titles existed', () => {
    const [migrated] = normalizeDayNotes([{ id: dayNoteId(T0), at: T0, text: 'written last week' }]);

    expect(migrated?.title).toBe('');
    expect(migrated?.text).toBe('written last week');
  });

  it('keeps a note that is a title and nothing else', () => {
    expect(normalizeDayNotes([{ id: dayNoteId(T0), at: T0, title: 'Moved house', text: '' }])).toHaveLength(1);
  });

  it('drops what is not a note at all rather than repairing it', () => {
    const stored = [
      { id: 'note-1', at: 'yesterday', text: 'no instant' },
      { id: 'note-2', at: T0, text: 42 },
      { id: 'note-3', at: Number.NaN, text: 'not a time' },
      null,
      'a string',
      note(T0, 'the only real one'),
    ];

    expect(normalizeDayNotes(stored).map((one) => one.text)).toEqual(['the only real one']);
  });

  it('drops a note that has been emptied to whitespace', () => {
    expect(normalizeDayNotes([{ id: dayNoteId(T0), at: T0, text: '   ' }])).toEqual([]);
  });

  /**
   * The recording is the third field to arrive, after the body and the title,
   * and it is the reason `normalizeDayNotes` stopped requiring any particular
   * one of them: insisting on the field that happened to come first would
   * discard every entry made of the ones that came later.
   */
  it('keeps a note that is a recording and nothing else', () => {
    const stored = [{ id: dayNoteId(T0), at: T0, title: '', text: '', voice: voice(T0) }];

    expect(normalizeDayNotes(stored)).toEqual([{ id: dayNoteId(T0), at: T0, title: '', text: '', voice: voice(T0) }]);
  });

  it('reads a note written before recordings existed as one without', () => {
    expect(normalizeDayNotes([{ id: dayNoteId(T0), at: T0, text: 'typed' }])[0]?.voice).toBeNull();
  });

  /**
   * The file name is the one field with no repair available: the service joins
   * it onto a directory, so a name that is not a name — `../` and what a decode
   * turns into one — points at something this app never wrote.
   */
  it('drops a recording whose file name is a path, keeping the words', () => {
    const stored = [
      {
        id: dayNoteId(T0),
        at: T0,
        title: '',
        text: 'the words survive',
        voice: { ...voice(T0), fileName: '../../vault/key' },
      },
    ];

    const [read] = normalizeDayNotes(stored);

    expect(read?.voice).toBeNull();
    expect(read?.text).toBe('the words survive');
  });

  /**
   * How long it runs and how large it is are facts *about* the recording. A
   * note whose recording lost its duration is still a recording you can play,
   * so those default rather than costing the entry.
   */
  it('repairs a recording missing everything but its name', () => {
    const stored = [{ id: dayNoteId(T0), at: T0, text: '', voice: { fileName: 'voice-1.m4a' } }];

    expect(normalizeDayNotes(stored)[0]?.voice).toEqual({
      fileName: 'voice-1.m4a',
      durationMs: 0,
      byteLength: 0,
      at: null,
    });
  });

  it('keeps where the recording was started when it is a real position', () => {
    const at = { lat: 0.01, lon: 0.02 };
    const stored = [{ id: dayNoteId(T0), at: T0, text: '', voice: { ...voice(T0), at } }];

    expect(normalizeDayNotes(stored)[0]?.voice?.at).toEqual(at);
  });

  it('sorts what it reads, so the order does not depend on how it was written', () => {
    const stored = [note(T0 + HOUR, 'second'), note(T0, 'first')];

    expect(normalizeDayNotes(stored).map((one) => one.text)).toEqual(['first', 'second']);
  });

  it('reads nothing out of anything that is not a list', () => {
    expect(normalizeDayNotes(undefined)).toEqual([]);
    expect(normalizeDayNotes({ notes: [] })).toEqual([]);
  });
});

/**
 * A recording made and then abandoned — the sheet closed without saving, a note
 * re-recorded before it was written — leaves a file nothing points at, and a
 * directory nobody sweeps only ever grows. The sweep is told what to keep from
 * here, so no caller has to remember what a note can own.
 */
describe('the files the diary owns', () => {
  it('names every recording and nothing else', () => {
    const notes = [note(T0, 'typed'), { ...note(T0 + HOUR), voice: voice(T0 + HOUR) }];

    expect(voiceFilesOf(notes)).toEqual([`voice-${T0 + HOUR}.m4a`]);
  });

  it('names nothing for a diary that has only ever been typed', () => {
    expect(voiceFilesOf([note(T0), note(T0 + HOUR)])).toEqual([]);
  });
});

/**
 * Transcription appends and never replaces, which is the entire reason a button
 * that sends your voice to a third party is safe to press twice. What is
 * asserted here is that no combination of note and transcript can destroy
 * something the author typed.
 */
describe('appending a transcript', () => {
  it('puts the transcript under what was already written, with a break between', () => {
    expect(appendTranscript('Market day.', 'Walked there with Sam.')).toBe(
      `Market day.${TRANSCRIPT_SEPARATOR}Walked there with Sam.`,
    );
  });

  /**
   * The ordinary case for this feature: you talked and never typed. A note
   * opening with a dash above its first line would be the app's punctuation
   * rather than the author's.
   */
  it('adds no separator to a note that was only a recording', () => {
    expect(appendTranscript('', 'What I said walking home.')).toBe('What I said walking home.');
    expect(appendTranscript('   \n  ', 'What I said walking home.')).toBe('What I said walking home.');
  });

  /**
   * Scribe answers an empty string for a recording with no speech in it, and a
   * dash floating under the text with nothing after it explains nothing.
   */
  it('adds nothing at all for a transcript of silence', () => {
    expect(appendTranscript('Market day.', '')).toBe('Market day.');
    expect(appendTranscript('Market day.', '   ')).toBe('Market day.');
  });

  it('leaves an empty note empty when there was nothing to hear', () => {
    expect(appendTranscript('', '')).toBe('');
  });

  /**
   * Transcribing twice appends twice, deliberately. A second attempt is a
   * normal thing to want — the first misheard a name — and the honest way to
   * offer it is to add the new one and let its owner delete the worse one.
   */
  it('appends again rather than replacing, so a second attempt keeps the first', () => {
    const once = appendTranscript('Market day.', 'first attempt');
    const twice = appendTranscript(once, 'second attempt');

    expect(twice).toContain('first attempt');
    expect(twice).toContain('second attempt');
    expect(twice.startsWith('Market day.')).toBe(true);
  });

  /**
   * The property that matters more than any single case: whatever the author
   * typed is still in the result, whatever the service sent back.
   */
  it('never loses the existing text', () => {
    const written = 'A paragraph I typed by hand, with a — dash in it.';

    for (const transcript of ['', '   ', 'ordinary text', TRANSCRIPT_SEPARATOR, 'a\n\nb']) {
      expect(appendTranscript(written, transcript)).toContain(written);
    }
  });

  it('trims the transcript, because leading whitespace is not content', () => {
    expect(appendTranscript('', '  spoken  ')).toBe('spoken');
  });
});
