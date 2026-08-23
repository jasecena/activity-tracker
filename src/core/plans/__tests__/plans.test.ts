import { dayNoteId, type DayNote, type NoteVoice } from '../../day';
import {
  planKey,
  planPayload,
  planQueueLine,
  plansToSend,
  plansWaiting,
  planToTranscribe,
  PLAN_FORMAT_VERSION,
} from '../index';

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);

function voice(durationMs = 90_000): NoteVoice {
  return { fileName: 'voice-1.m4a', durationMs, byteLength: 2048, at: null, locked: false };
}

function plan(at: number, text: string, over: Partial<DayNote> = {}): DayNote {
  return {
    id: dayNoteId(at),
    at,
    title: '',
    text,
    voice: null,
    mediaId: null,
    kind: 'plan',
    ...over,
  };
}

function note(at: number, text: string): DayNote {
  return { ...plan(at, text), kind: 'note' };
}

/** Nothing content-addressed here; the fingerprint is whatever the caller says. */
const byText = (one: DayNote) => `fp:${one.title}|${one.text}`;

describe('where a plan lives', () => {
  it('is named from the note id, so sending it twice overwrites one object', () => {
    expect(planKey(dayNoteId(T0))).toBe(`plans/note-${T0}.json`);
  });
});

describe('what goes in it', () => {
  it('carries the words, the instant and how long the recording ran', () => {
    const spoken = plan(T0, 'fix the backyard garden', { title: 'Garden', voice: voice(90_000) });

    expect(planPayload(spoken)).toEqual({
      version: PLAN_FORMAT_VERSION,
      id: dayNoteId(T0),
      at: T0,
      title: 'Garden',
      text: 'fix the backyard garden',
      spokenMs: 90_000,
    });
  });

  /** Only the words leave. The recording stays on the phone, where it already is. */
  it('does not carry the recording, only that there was one', () => {
    expect(JSON.stringify(planPayload(plan(T0, 'said aloud', { voice: voice() })))).not.toContain('voice-1.m4a');
  });

  it('says there was no recording rather than inventing a length', () => {
    expect(planPayload(plan(T0, 'typed')).spokenMs).toBeNull();
  });
});

describe('which plan needs its words fetched', () => {
  it('picks a spoken plan nothing has transcribed yet', () => {
    const notes = [plan(T0, '', { voice: voice() })];

    expect(planToTranscribe(notes, {})?.id).toBe(dayNoteId(T0));
  });

  it('leaves the diary alone', () => {
    const spokenDiaryEntry = { ...note(T0, ''), voice: voice() };

    expect(planToTranscribe([spokenDiaryEntry], {})).toBeNull();
  });

  it('leaves a typed plan alone — there is nothing to transcribe', () => {
    expect(planToTranscribe([plan(T0, 'fix the garden')], {})).toBeNull();
  });

  /**
   * Tracked by id rather than inferred from the text being empty. A transcript
   * that came back as silence leaves the note exactly as it was, and inferring
   * would ask for it again on every pass for ever.
   */
  it('does not ask twice for the same recording', () => {
    const notes = [plan(T0, '', { voice: voice() })];

    expect(planToTranscribe(notes, { [dayNoteId(T0)]: true })).toBeNull();
  });

  it('returns one at a time, because transcribing writes the note back', () => {
    const notes = [plan(T0, '', { voice: voice() }), plan(T0 + 1000, '', { voice: voice() })];

    expect(planToTranscribe(notes, {})?.id).toBe(dayNoteId(T0));
  });
});

describe('which plans should go up', () => {
  it('sends a plan that says something', () => {
    expect(plansToSend([plan(T0, 'fix the garden')], {}, byText).map((one) => one.id)).toEqual([dayNoteId(T0)]);
  });

  it('never sends a diary entry', () => {
    expect(plansToSend([note(T0, 'went to the beach')], {}, byText)).toEqual([]);
  });

  /**
   * A recording whose transcript has not arrived has no words, and an object
   * holding a timestamp and nothing else is a row on the other end that means
   * nothing and would never be corrected.
   */
  it('holds a spoken plan back until it has words', () => {
    expect(plansToSend([plan(T0, '', { voice: voice() })], {}, byText)).toEqual([]);
  });

  it('sends a plan that is only a title', () => {
    expect(plansToSend([plan(T0, '', { title: 'Affirmations' })], {}, byText)).toHaveLength(1);
  });

  it('costs nothing to run again over what already went', () => {
    const one = plan(T0, 'fix the garden');
    const sent = { [planKey(one.id)]: byText(one) };

    expect(plansToSend([one], sent, byText)).toEqual([]);
  });

  /** Editing has to send it again, and only the content knows that. */
  it('sends an edited plan again, over the same key', () => {
    const before = plan(T0, 'fix the garden');
    const sent = { [planKey(before.id)]: byText(before) };
    const after = plan(T0, 'fix the garden this weekend');

    expect(plansToSend([after], sent, byText).map((one) => planKey(one.id))).toEqual([planKey(before.id)]);
  });

  it('reads oldest first, so a backlog goes up in the order it was said', () => {
    const older = plan(T0, 'first');
    const newer = plan(T0 + 60_000, 'second');

    expect(plansToSend([newer, older], {}, byText).map((one) => one.text)).toEqual(['first', 'second']);
  });
});

/**
 * A queue nobody can see is a queue that fails silently — the complaint the
 * transcription button's on-screen error already answered. A phone with no key,
 * no bucket or no signal holds plans indefinitely and has to be able to say so.
 */
describe('how many are waiting', () => {
  it('counts what has words and has not gone', () => {
    expect(plansWaiting([plan(T0, 'fix the garden')], {}, byText)).toBe(1);
  });

  it('counts a recording that has no words yet', () => {
    expect(plansWaiting([plan(T0, '', { voice: voice() })], {}, byText)).toBe(1);
  });

  it('counts nothing once everything has gone', () => {
    const one = plan(T0, 'fix the garden');

    expect(plansWaiting([one], { [planKey(one.id)]: byText(one) }, byText)).toBe(0);
  });

  it('never counts the diary', () => {
    expect(plansWaiting([note(T0, 'went to the beach')], {}, byText)).toBe(0);
  });
});

describe('what the list says about its queue', () => {
  it('says nothing when everything has gone', () => {
    expect(planQueueLine(0, true)).toBeNull();
  });

  /** Silence is the right answer for a healthy queue; a reassurance is chrome. */
  it('says nothing when there is no bucket and nothing waiting either', () => {
    expect(planQueueLine(0, false)).toBeNull();
  });

  it('counts what is still to go', () => {
    expect(planQueueLine(1, true)).toBe('1 plan still to send.');
    expect(planQueueLine(4, true)).toBe('4 plans still to send.');
  });

  /**
   * The failure that would otherwise be invisible: a phone holding plans for
   * ever because nothing has been configured, looking perfectly healthy.
   */
  it('says where to go when there is nowhere to send them', () => {
    expect(planQueueLine(2, false)).toBe('2 plans held on this phone. Add a bucket in Settings to send them.');
  });
});
