import { useCallback, useEffect, useRef, useState } from 'react';

import { freeInstant, normalizeDayNotes, noteAt, voiceFilesOf, type DayNote, type NoteVoice } from '@/core/day';
import { deleteNoteAudio, sweepNoteAudio } from '@/services/noteAudio';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

export interface UseDayNotes {
  ready: boolean;
  notes: readonly DayNote[];
  /**
   * Write a new note at a chosen instant.
   *
   * The instant is the caller's, not the clock's. `whereToWrite` supplies the
   * default — now, or the end of the day being looked back on — and the sheet
   * offers a date and a time over the top of it, because when something is
   * written down and when it happened are routinely different.
   *
   * The recording, when there is one, is already on disk: the sheet records
   * first and saves after, so this stores a name rather than bytes.
   */
  write: (at: number, title: string, text: string, voice?: NoteVoice | null, mediaId?: string | null) => void;
  /**
   * Change one already written: its words, its time, or both.
   *
   * Moving it is a real edit rather than a second note, and moving it to
   * another date moves it to another day — which is how a note written in the
   * wrong place gets put right. Emptying it entirely deletes it.
   */
  edit: (
    note: DayNote,
    at: number,
    title: string,
    text: string,
    voice?: NoteVoice | null,
    mediaId?: string | null,
  ) => void;
  forget: (id: string) => void;
}

/**
 * The diary.
 *
 * Structurally the same hook as `useJourneyLabels` and for the same reason:
 * these are the things you told the app, as opposed to the things it worked
 * out, and they are kept as their own records and applied over a re-derived
 * timeline rather than written into it.
 *
 * Two differences from every other store in the app, both of which come from
 * a note being unreconstructable:
 *
 * **Retention never reaches it.** `retentionDays` trims the day log and the fix
 * archive; nothing here is on that path, and nothing should be put on it. The
 * line is the one captures already draw — a fix is something the app collected
 * on its own and may discard on its own, a note is something you sat down and
 * wrote — and it means a day can outlive its own readings as a sentence about
 * what happened. That is the right way round.
 *
 * **The clock is read here rather than in `core`.** `whereToWrite` takes `now`
 * as a parameter, the same as every other date decision in this codebase, and
 * this is the layer allowed to answer it.
 */
export function useDayNotes(): UseDayNotes {
  const [notes, setNotes] = useState<readonly DayNote[]>([]);
  const [ready, setReady] = useState(false);
  // Set the moment anything is written, so a slow first read cannot land on top
  // of a note made while it was still going.
  const touched = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = normalizeDayNotes(await readJson<unknown>(STORAGE_KEYS.dayNotes));
      if (!live) return;
      if (!touched.current) setNotes(stored);

      // **Before `setReady`, and only against a diary nothing has touched.** A
      // recording is written the moment you stop talking and referenced only
      // when the note is saved, so a sheet closed without saving leaves bytes
      // nothing points at — invisible, undeletable, and permanent otherwise.
      // Sweeping against a stale list is the opposite failure and a much worse
      // one, which is what both guards are for: an empty list means "the diary
      // has not loaded", not "there are no notes".
      if (!touched.current) sweepNoteAudio(voiceFilesOf(stored));
      setReady(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  const persist = useCallback((next: readonly DayNote[]) => {
    touched.current = true;
    const sorted = [...next].sort((a, b) => a.at - b.at);
    setNotes(sorted);
    void writeJson(STORAGE_KEYS.dayNotes, sorted);
  }, []);

  const write = useCallback(
    (at: number, title: string, text: string, voice: NoteVoice | null = null, mediaId: string | null = null) => {
      // Every note added to a finished day wants the same default instant — the
      // end of its last segment — and an id is derived from that instant, so
      // without this the second note about a Tuesday would replace the first.
      // A minute chosen by hand collides just as easily.
      const next = noteAt(freeInstant(notes, at), title, text, voice, mediaId);
      if (next) persist([...notes, next]);
    },
    [notes, persist],
  );

  const edit = useCallback(
    (
      note: DayNote,
      at: number,
      title: string,
      text: string,
      voice: NoteVoice | null = null,
      mediaId: string | null = null,
    ) => {
      const without = notes.filter((existing) => existing.id !== note.id);
      // Against the others rather than against all of them: a note keeping its
      // own instant must not be nudged off it by its own reflection.
      const next = noteAt(freeInstant(without, at), title, text, voice, mediaId);
      // Emptying a note is how you delete one, so there is no separate confirm
      // for the case where somebody selected all and pressed backspace.
      persist(next ? [...without, next] : without);

      // A recording that has been replaced or deleted here. The sweep would
      // reach it on the next launch anyway; taking it now is what keeps the
      // Data screen's total honest and stops a deleted recording occupying the
      // phone until something restarts.
      const before = note.voice?.fileName;
      if (before && before !== next?.voice?.fileName) deleteNoteAudio(before);
    },
    [notes, persist],
  );

  const forget = useCallback(
    (id: string) => {
      const doomed = notes.find((note) => note.id === id);
      if (doomed?.voice) deleteNoteAudio(doomed.voice.fileName);
      persist(notes.filter((note) => note.id !== id));
    },
    [notes, persist],
  );

  return { ready, notes, write, edit, forget };
}
