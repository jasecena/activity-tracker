import type { DayGroup, DayNote } from '../../day';
import type { Segment } from '../../segments';
import type { Place } from '../../places';
import {
  backupObjects,
  dayObject,
  daysAboutToBeLost,
  fixObjects,
  placesObject,
  previousDays,
  voiceObjects,
} from '../index';

/**
 * What belongs in the bucket, decided without a bucket.
 *
 * The whole of "which objects should be up there" is arithmetic over days and
 * notes, which is why it is here rather than in the service — a backup that
 * uploads the wrong set is a failure nobody notices until they open it, and a
 * failure like that should be catchable on a Linux runner.
 */

const UTC = 0;
const NOW = Date.UTC(2026, 0, 10, 15, 0, 0);

function day(key: string, startedAt: number): DayGroup {
  return { key, startedAt, segments: [] as readonly Segment[] };
}

function note(at: number, text: string, voice: DayNote['voice'] = null): DayNote {
  return { id: `note-${at}`, at, title: '', text, voice, mediaId: null, kind: 'note' };
}

const RECORDING = { fileName: 'voice-1.m4a', durationMs: 4_000, byteLength: 2048, at: null, locked: false };

const TODAY = day('2026-01-10', Date.UTC(2026, 0, 10));
const YESTERDAY = day('2026-01-09', Date.UTC(2026, 0, 9));
const LAST_WEEK = day('2026-01-03', Date.UTC(2026, 0, 3));

describe('which days are eligible', () => {
  /**
   * Today is still being recorded. An object uploaded at three in the afternoon
   * would be a day with an evening missing from it, and nothing would ever go
   * back to fix it.
   */
  it('leaves today alone', () => {
    expect(previousDays([TODAY, YESTERDAY, LAST_WEEK], NOW, UTC).map((d) => d.key)).toEqual([
      '2026-01-09',
      '2026-01-03',
    ]);
  });

  /** Which day an instant belongs to is a wall-clock fact, and the offset is a parameter. */
  it('asks the offset, so a phone an hour ahead agrees with itself', () => {
    const justAfterMidnightUtc = Date.UTC(2026, 0, 10, 0, 30, 0);

    // Thirteen hours ahead, it is already the 10th — so the 10th is today.
    expect(previousDays([TODAY, YESTERDAY], justAfterMidnightUtc, 13 * 60).map((d) => d.key)).toEqual(['2026-01-09']);
    // Five hours behind, it is still the 9th, so the 9th is today and the 10th
    // is not a previous day either.
    expect(previousDays([TODAY, YESTERDAY], justAfterMidnightUtc, -5 * 60).map((d) => d.key)).toEqual(['2026-01-10']);
  });
});

describe('a day, as an object', () => {
  it('carries its notes with it, and only its own', () => {
    const notes = [note(Date.UTC(2026, 0, 9, 10), 'a Friday'), note(Date.UTC(2026, 0, 3, 10), 'the Saturday before')];

    const body = JSON.parse(dayObject(YESTERDAY, notes, UTC).body ?? '');

    expect(body.day).toBe('2026-01-09');
    expect(body.notes).toHaveLength(1);
    expect(body.notes[0].text).toBe('a Friday');
  });

  it('goes to a key that does not change, so pressing twice overwrites', () => {
    expect(dayObject(YESTERDAY, [], UTC).key).toBe('days/2026-01-09');
    expect(dayObject(YESTERDAY, [note(Date.UTC(2026, 0, 9, 10), 'added later')], UTC).key).toBe('days/2026-01-09');
  });
});

describe('the recordings', () => {
  it('are objects of their own, named the way the note names them', () => {
    const notes = [note(Date.UTC(2026, 0, 9, 10), 'said aloud', RECORDING)];

    expect(voiceObjects([YESTERDAY], notes, UTC)).toEqual([
      { key: 'note-audio/voice-1.m4a', body: null, fileName: 'voice-1.m4a' },
    ]);
  });

  /**
   * A recording is bytes and a day is a paragraph. Keeping them apart is what
   * stops a sentence added to Tuesday re-uploading Tuesday's half-megabyte of
   * audio along with it.
   */
  it('are not embedded in the day', () => {
    const notes = [note(Date.UTC(2026, 0, 9, 10), 'said aloud', RECORDING)];

    expect(dayObject(YESTERDAY, notes, UTC).body).not.toContain('voice-1.m4a'.repeat(2));
    expect(JSON.parse(dayObject(YESTERDAY, notes, UTC).body ?? '').notes[0].voice.fileName).toBe('voice-1.m4a');
  });

  it('ignores a recording on a day that is not eligible yet', () => {
    const todaysNote = note(Date.UTC(2026, 0, 10, 9), 'this morning', RECORDING);

    expect(voiceObjects(previousDays([TODAY, YESTERDAY], NOW, UTC), [todaysNote], UTC)).toEqual([]);
  });
});

describe('the whole set', () => {
  it('is every finished day and every recording on one', () => {
    const notes = [note(Date.UTC(2026, 0, 9, 10), 'said aloud', RECORDING), note(Date.UTC(2026, 0, 10, 9), 'today')];

    expect(backupObjects([TODAY, YESTERDAY, LAST_WEEK], notes, NOW, UTC).map((o) => o.key)).toEqual([
      'days/2026-01-09',
      'days/2026-01-03',
      'note-audio/voice-1.m4a',
    ]);
  });

  it('is empty on a fresh install, rather than one hollow object', () => {
    expect(backupObjects([], [], NOW, UTC)).toEqual([]);
    expect(backupObjects([TODAY], [], NOW, UTC)).toEqual([]);
  });
});

/**
 * The trap this feature has by construction: retention runs on a timer and the
 * backup runs on a press, so a month of not pressing leaves both places with
 * nothing having gone wrong. Saying so is the app's job; deciding for its owner
 * is not — refusing to apply retention would make a setting stop working, which
 * is worse than a warning.
 */
describe('what retention is about to take', () => {
  const OLD = day('2025-12-01', Date.UTC(2025, 11, 1));

  it('names a day past the cutoff that has never gone up', () => {
    expect(daysAboutToBeLost([OLD, YESTERDAY], new Set(), 30, NOW, UTC)).toEqual(['2025-12-01']);
  });

  it('says nothing about a day already in the bucket', () => {
    expect(daysAboutToBeLost([OLD, YESTERDAY], new Set(['days/2025-12-01']), 30, NOW, UTC)).toEqual([]);
  });

  it('says nothing when nothing is old enough', () => {
    expect(daysAboutToBeLost([YESTERDAY], new Set(), 30, NOW, UTC)).toEqual([]);
  });

  it('says nothing when retention is off, which is what zero means', () => {
    expect(daysAboutToBeLost([OLD], new Set(), 0, NOW, UTC)).toEqual([]);
  });

  /** Today is not eligible for backup, so it cannot be "about to be lost" either. */
  it('never warns about today', () => {
    expect(daysAboutToBeLost([TODAY], new Set(), 1, NOW, UTC)).toEqual([]);
  });
});

describe('the two things that were missing', () => {
  /**
   * **A stay is backed up as a coordinate and a radius**, so a restored backup
   * held every journey and not one name for anywhere. "Home" is not derivable
   * from anything, and neither are the readings a frozen day was folded from.
   */
  const place = (id: string, name: string): Place => ({ id, name, lat: 0, lon: 0, radiusM: 120 });

  it('sends the place names as one object rather than one each', () => {
    // What a reader wants on a laptop is the list, not to reassemble it from
    // forty files. The same shape as the manifest, for the same reason.
    const object = placesObject([place('p-2', 'Work'), place('p-1', 'Home')]);

    expect(object?.key).toBe('places/current');
    expect(JSON.parse(object!.body!).places.map((p: Place) => p.id)).toEqual(['p-1', 'p-2']);
  });

  it('sends nothing at all when nowhere has been named', () => {
    // An empty object in the bucket would look like a successful backup of a
    // list somebody had emptied.
    expect(placesObject([])).toBeNull();
  });

  it('sends the archived readings one object per day', () => {
    // One object would mean reading and rewriting a year of readings to add
    // this morning's — the failure `pruneBuffer` avoids on disk, for the same
    // reason, and it degrades over months rather than failing where anyone
    // would see it.
    const objects = fixObjects(['2026-01-06', '2026-01-05']);

    expect(objects.map((o) => o.key)).toEqual(['fixes/2026-01-05', 'fixes/2026-01-06']);
  });

  it('names an archived day rather than carrying it', () => {
    // `core` cannot read storage and should not want to: a day of readings is
    // hundreds of kilobytes, and deciding what to upload is a question about
    // names.
    const objects = fixObjects(['2026-01-05']);

    expect(objects).toHaveLength(1);
    expect(objects[0]?.body).toBeNull();
    expect(objects[0]?.archiveDay).toBe('2026-01-05');
  });

  it('puts all four kinds in one backup', () => {
    const objects = backupObjects(
      [YESTERDAY],
      [note(Date.UTC(2026, 0, 9, 9), 'Something', RECORDING)],
      NOW,
      UTC,
      [place('p-1', 'Home')],
      ['2026-01-09'],
    );

    expect(objects.map((o) => o.key.split('/')[0])).toEqual(
      expect.arrayContaining(['days', 'note-audio', 'places', 'fixes']),
    );
  });
});
