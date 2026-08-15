import { act, renderHook, waitFor } from '@testing-library/react-native';

import { dayNoteId, type DayNote, type NoteVoice } from '@/core/day';
import { deleteNoteAudio, sweepNoteAudio } from '@/services/noteAudio';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

import { useDayNotes } from './useDayNotes';

jest.mock('@/services/noteAudio', () => ({
  deleteNoteAudio: jest.fn(),
  sweepNoteAudio: jest.fn(() => 0),
}));

/**
 * The diary is the one store in this app that nothing can rebuild, so what is
 * asserted here is mostly about not losing one — to a second note wanting the
 * same instant, to a slow first read, or to the store being written by a build
 * that shaped a note differently.
 *
 * The suite runs in UTC, so a day key here reads as the calendar day it looks
 * like.
 */

const HOUR = 3_600_000;
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
/** What `whereToWrite` hands back for a day already over: its last segment's end. */
const END_OF_DAY = T0 + 9 * HOUR;

// The hook reads no clock — the instant is chosen in the sheet and passed in —
// so there is nothing here to freeze.
function voice(startedAt: number): NoteVoice {
  return { fileName: `voice-${startedAt}.m4a`, durationMs: 30_000, byteLength: 48_000, at: null, locked: false };
}

beforeEach(async () => {
  jest.clearAllMocks();
  await writeJson(STORAGE_KEYS.dayNotes, []);
});

async function openDiary() {
  const { result } = await renderHook(() => useDayNotes());
  await waitFor(() => expect(result.current.ready).toBe(true));
  return result;
}

it('writes one about today and keeps it', async () => {
  const result = await openDiary();

  await act(async () => {
    result.current.write(T0, '', 'Walked to the market with Sam');
  });

  expect(result.current.notes.map((one) => one.text)).toEqual(['Walked to the market with Sam']);
  await waitFor(async () => expect(await readJson(STORAGE_KEYS.dayNotes)).toHaveLength(1));
});

it('refuses to write a blank one', async () => {
  const result = await openDiary();

  await act(async () => {
    result.current.write(T0, '', '   ');
  });

  expect(result.current.notes).toEqual([]);
});

/**
 * Every note added to a finished day wants the same instant — the end of its
 * last segment — and an id is derived from that instant. Without a nudge the
 * second note about a Tuesday would quietly replace the first.
 */
it('keeps both notes when two are written about the same finished day', async () => {
  const result = await openDiary();

  await act(async () => {
    result.current.write(END_OF_DAY, '', 'first thing');
  });
  await act(async () => {
    result.current.write(END_OF_DAY, '', 'second thing');
  });

  expect(result.current.notes.map((one) => one.text)).toEqual(['first thing', 'second thing']);
  expect(new Set(result.current.notes.map((one) => one.id)).size).toBe(2);
});

it('changes the words without moving the note', async () => {
  const result = await openDiary();
  await act(async () => {
    result.current.write(T0, '', 'rain all day');
  });
  const written = result.current.notes[0] as DayNote;

  await act(async () => {
    result.current.edit(written, written.at, '', 'rain all morning, then sun');
  });

  expect(result.current.notes).toHaveLength(1);
  expect(result.current.notes[0]?.at).toBe(written.at);
  expect(result.current.notes[0]?.text).toBe('rain all morning, then sun');
});

// Emptying the field is how you delete one, so there is no state where a note
// exists holding nothing.
it('deletes a note emptied to nothing', async () => {
  const result = await openDiary();
  await act(async () => {
    result.current.write(T0, '', 'never mind');
  });

  await act(async () => {
    result.current.edit(result.current.notes[0] as DayNote, T0, '', '');
  });

  expect(result.current.notes).toEqual([]);
});

it('forgets one by id', async () => {
  await writeJson(STORAGE_KEYS.dayNotes, [{ id: dayNoteId(T0), at: T0, text: 'gone soon' }]);
  const result = await openDiary();

  await act(async () => {
    result.current.forget(dayNoteId(T0));
  });

  expect(result.current.notes).toEqual([]);
  await waitFor(async () => expect(await readJson(STORAGE_KEYS.dayNotes)).toEqual([]));
});

/**
 * A note is unreconstructable, so the trust boundary repairs where it can
 * rather than dropping. An id no build ever wrote is rebuilt from the instant.
 */
it('reads back a note whose id is not one this build would write', async () => {
  await writeJson(STORAGE_KEYS.dayNotes, [{ id: 'something-else', at: T0, text: 'still here' }]);

  const result = await openDiary();

  expect(result.current.notes.map((one) => one.text)).toEqual(['still here']);
  expect(result.current.notes[0]?.id).toBe(dayNoteId(T0));
});

/**
 * The pickers can move a note, and moving it across midnight moves it to
 * another day. It has to be one note afterwards, at the new instant, rather
 * than the old one left behind under an id nothing points at any more.
 */
it('moves a note to another day when the date is changed', async () => {
  const result = await openDiary();
  await act(async () => {
    result.current.write(T0, '', 'this was actually yesterday');
  });

  const moved = T0 - 24 * HOUR;
  await act(async () => {
    result.current.edit(result.current.notes[0] as DayNote, moved, '', 'this was actually yesterday');
  });

  expect(result.current.notes).toHaveLength(1);
  expect(result.current.notes[0]?.at).toBe(moved);
  expect(result.current.notes[0]?.id).toBe(dayNoteId(moved));
});

// Its own instant is not a collision with itself: re-saving a note without
// touching the pickers must leave it exactly where it was.
it('does not nudge a note off its own instant when only the words change', async () => {
  const result = await openDiary();
  await act(async () => {
    result.current.write(T0, '', 'first words');
  });

  await act(async () => {
    result.current.edit(result.current.notes[0] as DayNote, T0, '', 'second words');
  });

  expect(result.current.notes[0]?.at).toBe(T0);
});

it('keeps them in time order however they arrive', async () => {
  await writeJson(STORAGE_KEYS.dayNotes, [
    { id: dayNoteId(T0 + HOUR), at: T0 + HOUR, text: 'second' },
    { id: dayNoteId(T0), at: T0, text: 'first' },
  ]);

  const result = await openDiary();

  expect(result.current.notes.map((one) => one.text)).toEqual(['first', 'second']);
});

/**
 * A recording is a note, which is what these are about: it saves with the
 * words, it survives without them, and its bytes go when the note that owns
 * them does.
 */
describe('a note that was spoken', () => {
  it('writes one with a recording and nothing typed', async () => {
    const result = await openDiary();

    await act(async () => {
      result.current.write(T0, '', '', voice(T0));
    });

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0]?.voice?.fileName).toBe(`voice-${T0}.m4a`);
  });

  it('keeps the recording when words are typed under it afterwards', async () => {
    const result = await openDiary();
    await act(async () => {
      result.current.write(T0, '', '', voice(T0));
    });
    const spoken = result.current.notes[0] as DayNote;

    await act(async () => {
      result.current.edit(spoken, spoken.at, 'Market day', 'and what I said', spoken.voice);
    });

    expect(result.current.notes).toHaveLength(1);
    expect(result.current.notes[0]?.voice?.fileName).toBe(`voice-${T0}.m4a`);
    expect(result.current.notes[0]?.title).toBe('Market day');
  });

  /**
   * The bytes are on disk the moment you stop talking, so deleting a recording
   * here has to take the file too — otherwise a deleted recording occupies the
   * phone until something restarts and the sweep notices.
   */
  it('deletes the bytes when the recording is removed from the note', async () => {
    const result = await openDiary();
    await act(async () => {
      result.current.write(T0, 'Market day', '', voice(T0));
    });
    const spoken = result.current.notes[0] as DayNote;

    await act(async () => {
      result.current.edit(spoken, spoken.at, 'Market day', '', null);
    });

    expect(deleteNoteAudio).toHaveBeenCalledWith(`voice-${T0}.m4a`);
    expect(result.current.notes[0]?.voice).toBeNull();
  });

  it('deletes the bytes when the note itself is forgotten', async () => {
    const result = await openDiary();
    await act(async () => {
      result.current.write(T0, '', '', voice(T0));
    });

    await act(async () => {
      result.current.forget(result.current.notes[0]!.id);
    });

    expect(deleteNoteAudio).toHaveBeenCalledWith(`voice-${T0}.m4a`);
    expect(result.current.notes).toEqual([]);
  });

  it('leaves the bytes alone when only the words are edited', async () => {
    const result = await openDiary();
    await act(async () => {
      result.current.write(T0, '', 'first words', voice(T0));
    });
    const spoken = result.current.notes[0] as DayNote;

    await act(async () => {
      result.current.edit(spoken, spoken.at, '', 'second words', spoken.voice);
    });

    expect(deleteNoteAudio).not.toHaveBeenCalled();
  });

  /**
   * A recording is written when you stop talking and referenced when the note
   * is saved, so a sheet closed in between leaves bytes nothing points at.
   * Sweeping against a *loaded* diary is the whole safety of this: an empty
   * list means "not loaded yet", not "no notes".
   */
  it('sweeps recordings no note refers to, against what was actually loaded', async () => {
    await writeJson(STORAGE_KEYS.dayNotes, [{ id: dayNoteId(T0), at: T0, title: '', text: '', voice: voice(T0) }]);

    await openDiary();

    expect(sweepNoteAudio).toHaveBeenCalledWith([`voice-${T0}.m4a`]);
  });
});
