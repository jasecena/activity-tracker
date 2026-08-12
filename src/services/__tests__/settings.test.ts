import { DEFAULT_SETTINGS, DEFAULT_TRANSCRIPTION_LANGUAGE, normalizeSettings } from '../settings';

/**
 * The trust boundary for settings, field by field.
 *
 * Two fields here decide whether anything leaves the phone, so the direction of
 * every fallback matters: unrecognisable input has to land on *off*, never on
 * on. `mapsEnabled` has always been read that way; `transcriptionKey` now is
 * too, and an empty key is the whole of what "off" means for transcription.
 */

describe('a fresh install', () => {
  it('has no transcription key, so it cannot send a recording anywhere', () => {
    expect(DEFAULT_SETTINGS.transcriptionKey).toBe('');
  });

  it('expects Persian, because that is what the recordings are', () => {
    expect(DEFAULT_SETTINGS.transcriptionLanguage).toBe('fa');
  });

  it('has maps off, for the same reason', () => {
    expect(DEFAULT_SETTINGS.mapsEnabled).toBe(false);
  });
});

describe('reading the transcription key back', () => {
  it('keeps a stored key', () => {
    expect(normalizeSettings({ transcriptionKey: 'xi-abc123' }).transcriptionKey).toBe('xi-abc123');
  });

  /**
   * A key pasted from a web page arrives with whitespace on it, and a leading
   * space is an authentication failure its owner cannot see.
   */
  it('trims a pasted key', () => {
    expect(normalizeSettings({ transcriptionKey: '  xi-abc123\n' }).transcriptionKey).toBe('xi-abc123');
  });

  it('reads anything that is not a string as no key at all', () => {
    for (const stored of [42, null, undefined, {}, ['xi-abc']]) {
      expect(normalizeSettings({ transcriptionKey: stored }).transcriptionKey).toBe('');
    }
  });

  it('reads settings written before transcription existed as having no key', () => {
    expect(normalizeSettings({ mapsEnabled: true, weightKg: 80 }).transcriptionKey).toBe('');
  });
});

describe('the language code', () => {
  it('keeps a plausible ISO code, lowercased', () => {
    expect(normalizeSettings({ transcriptionLanguage: 'EN' }).transcriptionLanguage).toBe('en');
    expect(normalizeSettings({ transcriptionLanguage: 'fas' }).transcriptionLanguage).toBe('fas');
  });

  /**
   * This string goes into a request body, so "two or three letters" is the whole
   * of what it may be. Anything else falls back rather than being sent.
   */
  it('refuses anything that is not one', () => {
    for (const stored of ['', 'english', 'f', '../../etc', 12, null, 'fa fa']) {
      expect(normalizeSettings({ transcriptionLanguage: stored }).transcriptionLanguage).toBe(
        DEFAULT_TRANSCRIPTION_LANGUAGE,
      );
    }
  });
});

describe('the fields that permit a request', () => {
  // `=== true`, not truthy: the failure this guards is a network request nobody
  // asked for, so anything unrecognisable has to mean off.
  it('reads a truthy-but-wrong mapsEnabled as off', () => {
    for (const stored of ['true', 1, {}, [], 'yes']) {
      expect(normalizeSettings({ mapsEnabled: stored }).mapsEnabled).toBe(false);
    }
  });
});
