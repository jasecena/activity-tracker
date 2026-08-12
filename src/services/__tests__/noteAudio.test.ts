import * as FileSystem from 'expo-file-system';
import { Directory, File, Paths } from 'expo-file-system';

import {
  adoptFromMedia,
  deleteNoteAudio,
  eraseAllNoteAudio,
  keepNoteAudio,
  noteAudioName,
  noteAudioUri,
  sweepNoteAudio,
} from '../noteAudio';

/**
 * The diary's recordings, against the in-memory filesystem.
 *
 * What is worth proving here is that a voice note lands somewhere the media
 * sweep cannot reach, that the diary's own sweep only ever takes what no note
 * refers to, and that a recording made under the old build — when a voice note
 * was a capture — arrives intact rather than being left in a directory nothing
 * reads any more.
 */

const { __reset, __seed } = FileSystem as unknown as typeof import('../../../__mocks__/expo-file-system');

const STARTED_AT = 1_767_600_000_000;

function bytes(length: number): Uint8Array {
  const out = new Uint8Array(length);
  for (let index = 0; index < length; index += 1) out[index] = (index * 7 + 3) % 251;
  return out;
}

function recorded(uri = 'file:///mock/cache/recording.m4a', length = 2048): string {
  __seed(uri, bytes(length));
  return uri;
}

beforeEach(() => {
  __reset();
});

describe('keeping one', () => {
  it('names the file for the instant it was started', () => {
    expect(noteAudioName(STARTED_AT)).toBe(`voice-${STARTED_AT}.m4a`);
  });

  it('moves the recorder’s file into the diary’s directory and reports its size', () => {
    const kept = keepNoteAudio(recorded(), STARTED_AT);

    expect(kept).toEqual({ fileName: `voice-${STARTED_AT}.m4a`, byteLength: 2048 });
    expect(new File(Paths.document, 'note-audio', `voice-${STARTED_AT}.m4a`).exists).toBe(true);
  });

  /**
   * The whole reason for a second directory: `sweepOrphans` deletes anything in
   * the media directory the media index does not name, and a recording the
   * notes own is by definition something it does not name.
   */
  it('keeps it out of the media directory the capture sweep walks', () => {
    keepNoteAudio(recorded(), STARTED_AT);

    expect(new Directory(Paths.document, 'media').list()).toEqual([]);
  });

  it('moves rather than copies, so a recording is never on disk twice', () => {
    const uri = recorded();

    keepNoteAudio(uri, STARTED_AT);

    expect(new File(uri).exists).toBe(false);
  });

  /**
   * Null rather than a name pointing at no bytes. A note that claims a
   * recording it cannot play is worse than a note that says it was typed.
   */
  it('refuses a recording the platform never wrote', () => {
    expect(keepNoteAudio('file:///mock/cache/never-happened.m4a', STARTED_AT)).toBeNull();
  });

  it('replaces a recording made again at the same instant', () => {
    keepNoteAudio(recorded('file:///mock/cache/first.m4a', 100), STARTED_AT);
    const second = keepNoteAudio(recorded('file:///mock/cache/second.m4a', 400), STARTED_AT);

    expect(second?.byteLength).toBe(400);
  });
});

describe('reading one back', () => {
  it('hands a player the stored file', () => {
    const kept = keepNoteAudio(recorded(), STARTED_AT);

    expect(noteAudioUri(kept!.fileName)).toContain('note-audio');
  });

  it('answers null for bytes that have gone', () => {
    expect(noteAudioUri('voice-1.m4a')).toBeNull();
  });

  it('forgets one on request', () => {
    const kept = keepNoteAudio(recorded(), STARTED_AT);

    deleteNoteAudio(kept!.fileName);

    expect(noteAudioUri(kept!.fileName)).toBeNull();
  });

  it('is untroubled by deleting one twice', () => {
    expect(() => deleteNoteAudio('voice-never.m4a')).not.toThrow();
  });
});

describe('the sweep', () => {
  it('takes a recording no note refers to', () => {
    const abandoned = keepNoteAudio(recorded('file:///mock/cache/a.m4a'), STARTED_AT);
    const saved = keepNoteAudio(recorded('file:///mock/cache/b.m4a'), STARTED_AT + 60_000);

    expect(sweepNoteAudio([saved!.fileName])).toBe(1);
    expect(noteAudioUri(abandoned!.fileName)).toBeNull();
    expect(noteAudioUri(saved!.fileName)).not.toBeNull();
  });

  it('takes nothing at all before anything has been recorded', () => {
    expect(sweepNoteAudio([])).toBe(0);
  });
});

describe('a recording made while a voice note was still a capture', () => {
  it('moves out of the media directory keeping its bytes', () => {
    __seed('file:///mock/documents/media/m-99.m4a', bytes(512));

    const adopted = adoptFromMedia('m-99.m4a', STARTED_AT);

    expect(adopted).toEqual({ fileName: `voice-${STARTED_AT}.m4a`, byteLength: 512 });
    expect(new File(Paths.document, 'media', 'm-99.m4a').exists).toBe(false);
  });

  it('says so when the capture had already lost its bytes', () => {
    expect(adoptFromMedia('m-missing.m4a', STARTED_AT)).toBeNull();
  });
});

describe('erasing everything', () => {
  it('takes the recordings with it', () => {
    const kept = keepNoteAudio(recorded(), STARTED_AT);

    eraseAllNoteAudio();

    expect(noteAudioUri(kept!.fileName)).toBeNull();
  });
});
