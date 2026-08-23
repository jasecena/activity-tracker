import type { DayNote } from '../../day';
import type { Fix } from '../../geo';
import type { Place } from '../../places';
import type { MoveSegment, Segment, StaySegment } from '../../segments';
import { exportFilename, fixesToCsv, notesToCsv, pointsToCsv, segmentsToCsv } from '../index';

const T0 = Date.UTC(2026, 0, 5, 22, 30, 0);
const SYDNEY = 600;

function fix(overrides: Partial<Fix> = {}): Fix {
  return { lat: 0, lon: 0, at: T0, accuracyM: 8, reportedSpeedMps: 1.2, altitudeM: 34.5, ...overrides };
}

const MOVE: MoveSegment = {
  kind: 'move',
  id: 'seg-1',
  startedAt: T0,
  endedAt: T0 + 20 * 60_000,
  fixCount: 48,
  distanceM: 1680.4,
  mode: 'walk',
  label: null,
  modeIsManual: false,
  path: [
    { lat: 0, lon: 0, at: T0, speedMps: null },
    { lat: 0.0002, lon: 0.0001, at: T0 + 10 * 60_000, speedMps: 1.4 },
  ],
  topSpeedMps: 1.9,
};

const STAY: StaySegment = {
  kind: 'stay',
  id: 'seg-2',
  startedAt: T0 + 20 * 60_000,
  endedAt: T0 + 80 * 60_000,
  fixCount: 12,
  center: { lat: 0.0002, lon: 0.0001 },
  radiusM: 14.2,
  purpose: null,
};

const PLACES: Place[] = [{ id: 'place-20-10', name: 'abc restaurant', lat: 0.0002, lon: 0.0001, radiusM: 120 }];

function rows(csv: string): string[] {
  // The trailing newline is deliberate, so the last split entry is empty.
  const lines = csv.split('\n');
  expect(lines[lines.length - 1]).toBe('');
  return lines.slice(0, -1);
}

describe('fixesToCsv', () => {
  it('writes a header and nothing else for no fixes', () => {
    expect(fixesToCsv([], 0)).toBe('timestamp,epoch_ms,latitude,longitude,accuracy_m,reported_speed_mps,altitude_m\n');
  });

  it('writes everything the platform gave us', () => {
    const csv = rows(fixesToCsv([fix()], 0));
    expect(csv[1]).toBe('2026-01-05T22:30:00+00:00,1767652200000,0.0000000,0.0000000,8.0,1.20,34.5');
  });

  // The reason most rejected readings exist at all. An accuracy of Infinity is
  // how `services/location.ts` maps Core Location's "this reading is invalid",
  // and `Infinity` in a CSV cell parses as a string in most tools and as a
  // number in a few — neither of which is what it means.
  it('says "invalid" rather than writing Infinity for an unusable accuracy', () => {
    const csv = rows(fixesToCsv([fix({ accuracyM: Infinity })], 0));
    expect(csv[1]).toContain(',invalid,');
  });

  it('leaves a cell empty when the platform had no value', () => {
    const csv = rows(fixesToCsv([fix({ reportedSpeedMps: null, altitudeM: null })], 0));
    expect(csv[1]?.endsWith(',,')).toBe(true);
  });

  // A bare local time is ambiguous and a bare Z throws away what time it felt
  // like where you were — which is most of the point of a diary.
  it('stamps the offset, so a row is unambiguous', () => {
    const csv = rows(fixesToCsv([fix()], SYDNEY));
    expect(csv[1]).toContain('2026-01-06T08:30:00+10:00');
  });

  it('handles a negative offset', () => {
    const csv = rows(fixesToCsv([fix()], -330));
    expect(csv[1]).toContain('2026-01-05T17:00:00-05:30');
  });
});

describe('pointsToCsv', () => {
  it('writes one row per route point, and skips stays', () => {
    const csv = rows(pointsToCsv([MOVE, STAY], 0));
    expect(csv).toHaveLength(3); // header + two points
    expect(csv[1]).toContain('seg-1,walk,');
  });

  // The first point of a segment has no step behind it, so there is no speed to
  // report — an empty cell, not a zero, which would be a claim.
  it('leaves the first point of a segment without a speed', () => {
    const csv = rows(pointsToCsv([MOVE], 0));
    expect(csv[1]?.endsWith(',')).toBe(true);
    expect(csv[2]?.endsWith(',1.400')).toBe(true);
  });

  it('is just a header when nothing has been recorded', () => {
    expect(rows(pointsToCsv([], 0))).toHaveLength(1);
  });
});

describe('segmentsToCsv', () => {
  it('writes stays and moves in one table, blanking what does not apply', () => {
    const csv = rows(segmentsToCsv([MOVE, STAY], PLACES, 0));
    expect(csv).toHaveLength(3);

    const move = csv[1]?.split(',') ?? [];
    expect(move[1]).toBe('move');
    expect(move[6]).toBe('1680.4');
    expect(move[7]).toBe('walk');

    const stay = csv[2]?.split(',') ?? [];
    expect(stay[1]).toBe('stay');
    expect(stay[6]).toBe(''); // no distance for a stay
    expect(stay[15]).toBe('abc restaurant');
  });

  it('leaves the place blank for a stay nowhere named', () => {
    const csv = rows(segmentsToCsv([STAY], [], 0));
    expect(csv[1]?.endsWith(',')).toBe(true);
  });

  it("records whether a mode was your answer or the classifier's", () => {
    const manual: Segment = { ...MOVE, modeIsManual: true, label: 'Walk to Coles' };
    const csv = rows(segmentsToCsv([manual], [], 0));
    expect(csv[1]).toContain('Walk to Coles,yes,');
  });

  it('computes the average speed rather than making it up', () => {
    // 1680.4 m in 20 minutes.
    const csv = rows(segmentsToCsv([MOVE], [], 0));
    expect(csv[1]?.split(',')[11]).toBe('1.400');
  });
});

describe('CSV quoting', () => {
  // A place called "Mum's, at home" would otherwise silently add a column and
  // shift every value after it.
  it('quotes a label containing a comma', () => {
    const awkward: Segment = { ...MOVE, label: 'Walk, then bus' };
    expect(rows(segmentsToCsv([awkward], [], 0))[1]).toContain('"Walk, then bus"');
  });

  it('doubles a quote inside a label', () => {
    const awkward: Segment = { ...MOVE, label: 'The "shortcut"' };
    expect(rows(segmentsToCsv([awkward], [], 0))[1]).toContain('"The ""shortcut"""');
  });

  it('quotes a label containing a newline', () => {
    const awkward: Segment = { ...MOVE, label: 'two\nlines' };
    expect(segmentsToCsv([awkward], [], 0)).toContain('"two\nlines"');
  });
});

/**
 * The diary is the one export whose contents the app did not produce and could
 * not produce again, which is exactly why it has to be gettable out — and why
 * the quoting matters more here than anywhere else in this file. Free text is
 * full of commas, quotes and paragraph breaks as a matter of course.
 */
describe('notesToCsv', () => {
  const note = (at: number, text: string, title = ''): DayNote => ({
    id: `note-${at}`,
    at,
    title,
    text,
    voice: null,
    mediaId: null,
    kind: 'note',
  });

  it('writes the instant, the day it belongs to, and the words', () => {
    const [header, first] = rows(notesToCsv([note(T0, 'Walked there with Sam', 'Market day')], 0));

    expect(header).toBe('timestamp,epoch_ms,day,title,text,voice_file,voice_seconds,capture_id');
    expect(first).toBe(`2026-01-05T22:30:00+00:00,${T0},2026-01-05,Market day,Walked there with Sam,,,`);
  });

  // The day column is the local day, so a note written late in Sydney files
  // under the date its author would call it — the same rule as everywhere else.
  it('names the local day, not the UTC one', () => {
    expect(rows(notesToCsv([note(T0, 'late one')], SYDNEY))[1]).toContain('2026-01-06');
  });

  it('sorts oldest first whatever order it is handed', () => {
    const out = rows(notesToCsv([note(T0 + 3_600_000, 'later'), note(T0, 'earlier')], 0));

    expect(out[1]).toContain('earlier');
    expect(out[2]).toContain('later');
  });

  it('survives a paragraph break, which a diary entry will have', () => {
    expect(notesToCsv([note(T0, 'Morning.\n\nThen the long way home.')], 0)).toContain(
      '"Morning.\n\nThen the long way home."',
    );
  });

  it('doubles a quote and keeps a comma inside the cell', () => {
    expect(notesToCsv([note(T0, 'Sam said "later", so we went')], 0)).toContain('"Sam said ""later"", so we went"');
  });

  /**
   * The only place the link between the notes file and the media file is
   * visible outside the app. Without it a note about a photograph exports as a
   * note about nothing in particular — and an id naming a capture since
   * forgotten still exports, because it says the note was about a picture,
   * which is true.
   */
  it('names the capture a note is about', () => {
    const about = { ...note(T0, 'The light on the water'), mediaId: 'media-7' };

    expect(rows(notesToCsv([about], 0))[1]?.endsWith(',media-7')).toBe(true);
  });

  it('writes a header and nothing else for an empty diary', () => {
    expect(notesToCsv([], 0)).toBe('timestamp,epoch_ms,day,title,text,voice_file,voice_seconds,capture_id\n');
  });

  /**
   * An entry that was spoken rather than typed would otherwise export as a
   * blank row with a time on it — which reads as a day nobody wrote about, and
   * is the opposite of true. The audio cannot go in a CSV; its name can.
   */
  it('names the recording behind a note that was spoken', () => {
    const spoken = {
      ...note(T0, ''),
      voice: { fileName: 'voice-99.m4a', durationMs: 42_400, byteLength: 96_000, at: null, locked: false },
    };

    expect(rows(notesToCsv([spoken], 0))[1]).toBe(`2026-01-05T22:30:00+00:00,${T0},2026-01-05,,,voice-99.m4a,42,`);
  });
});

describe('exportFilename', () => {
  it('names the file for the local day, so a file list sorts chronologically', () => {
    expect(exportFilename('fixes', T0, SYDNEY)).toBe('activity-tracker-fixes-2026-01-06.csv');
    expect(exportFilename('segments', T0, 0)).toBe('activity-tracker-segments-2026-01-05.csv');
  });
});
