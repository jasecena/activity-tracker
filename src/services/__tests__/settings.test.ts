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

/**
 * The two buckets are two settings, and the thing worth testing is that they
 * never quietly become one.
 *
 * A field that fell back to the backup's value would put plans in the bucket
 * that holds the journeys, or seal them under the key the planner is not
 * supposed to have — and either mistake reads as the feature working.
 */
describe('the plans bucket, which is not the backup bucket', () => {
  it('keeps the two sets of credentials apart', () => {
    const stored = {
      backupBucket: 'the-backup',
      backupRegion: 'us-east-1',
      backupAccessKeyId: 'AKIA-BACKUP',
      backupSecretKey: 'backup-secret',
      exchangeBucket: 'the-plans',
      exchangeRegion: 'ap-southeast-2',
      exchangeAccessKeyId: 'AKIA-PLANS',
      exchangeSecretKey: 'plans-secret',
    };
    const settings = normalizeSettings(stored);

    expect(settings.backupBucket).toBe('the-backup');
    expect(settings.exchangeBucket).toBe('the-plans');
    expect(settings.exchangeAccessKeyId).not.toBe(settings.backupAccessKeyId);
    expect(settings.exchangeSecretKey).not.toBe(settings.backupSecretKey);
  });

  /**
   * **An unset plans bucket must not inherit the backup's.** This is the one
   * failure that would send plans to the bucket full of coordinates while
   * looking entirely healthy.
   */
  it('leaves the plans bucket empty rather than falling back to the backup', () => {
    const settings = normalizeSettings({
      backupBucket: 'the-backup',
      backupAccessKeyId: 'AKIA-BACKUP',
      backupSecretKey: 'backup-secret',
      backupKeyHex: 'ab'.repeat(32),
      backupSaltHex: 'cd'.repeat(16),
    });

    expect(settings.exchangeBucket).toBe('');
    expect(settings.exchangeAccessKeyId).toBe('');
    expect(settings.exchangeSecretKey).toBe('');
    expect(settings.exchangeKeyHex).toBe('');
    expect(settings.exchangeSaltHex).toBe('');
  });

  // Same rule as the backup's key: hex or nothing. A half-written key is not
  // repaired into a different one, because it would seal plans nothing can open.
  it('refuses a key or salt that is not the right hex', () => {
    for (const bad of ['', 'not-hex', 'ab'.repeat(31), 'AB'.repeat(32), 12, null]) {
      expect(normalizeSettings({ exchangeKeyHex: bad }).exchangeKeyHex).toBe('');
      expect(normalizeSettings({ exchangeSaltHex: bad }).exchangeSaltHex).toBe('');
    }
    expect(normalizeSettings({ exchangeKeyHex: 'ab'.repeat(32) }).exchangeKeyHex).toBe('ab'.repeat(32));
    expect(normalizeSettings({ exchangeSaltHex: 'cd'.repeat(16) }).exchangeSaltHex).toBe('cd'.repeat(16));
  });

  it('defaults the plans region rather than leaving it blank', () => {
    expect(normalizeSettings({}).exchangeRegion).toBe('ap-southeast-2');
    expect(normalizeSettings({ exchangeRegion: '  ' }).exchangeRegion).toBe('ap-southeast-2');
  });
});
