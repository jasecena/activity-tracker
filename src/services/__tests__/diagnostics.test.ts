import { bytesToHex } from '@noble/ciphers/utils.js';

import { MANIFEST_KEY } from '@/services/backup/manifest';
import { getObject, listKeys, putObject } from '@/services/backup/s3';
import { checkBackupBucket, checkPlansRead, checkPlansWrite, checkTranscription } from '@/services/diagnostics';
import { DEFAULT_SETTINGS, type Settings } from '@/services/settings';

/**
 * The screen that answers "is it actually working", asserted on the two things
 * that are easy to get wrong and expensive to get wrong quietly.
 *
 * **That a 404 on the agenda is a pass.** It is the ordinary state of a bucket
 * whose planner has never run, it is the strongest evidence available that the
 * credentials are good, and reporting it as a failure would send somebody to
 * re-check four fields that were right all along.
 *
 * **That a check which cannot run says so instead of passing.** An `off` result
 * is the honest answer for an unconfigured integration, and the one bug this
 * screen must never have is a green tick on a bucket that will never be written
 * to.
 */

jest.mock('@/services/backup/s3', () => ({
  getObject: jest.fn(),
  listKeys: jest.fn(),
  putObject: jest.fn(),
}));

const KEY = new Uint8Array(32).fill(7);

const PLANS: Settings = {
  ...DEFAULT_SETTINGS,
  exchangeBucket: 'my-exchange-bucket',
  exchangeAccessKeyId: 'AKIA',
  exchangeSecretKey: 'shhh',
  exchangeKeyHex: bytesToHex(KEY),
  exchangeSaltHex: 'a'.repeat(32),
};

const BACKUP: Settings = {
  ...DEFAULT_SETTINGS,
  backupBucket: 'my-backup-bucket',
  backupAccessKeyId: 'AKIA',
  backupSecretKey: 'shhh',
  backupKeyHex: bytesToHex(KEY),
  backupSaltHex: 'b'.repeat(32),
};

// `globalThis` rather than `global`: the test tsconfig carries no Node types,
// and this is the same assignment `transcribe.test.ts` makes.
const fetchMock = jest.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

beforeEach(() => {
  jest.clearAllMocks();
  fetchMock.mockReset();
});

function answering(status: number, body: unknown): void {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (typeof body === 'string' ? body : JSON.stringify(body)),
    json: async () => body,
  });
}

describe('the agenda read', () => {
  it('counts a 404 as working, because nothing has published yet', async () => {
    (getObject as jest.Mock).mockResolvedValue({ reason: 'not-found', detail: 'HTTP 404 — NoSuchKey' });

    const result = await checkPlansRead(PLANS);

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('nothing has been published');
  });

  it('counts a 403 as a failure and names the two fields to check', async () => {
    (getObject as jest.Mock).mockResolvedValue({ reason: 'unauthorized', detail: 'HTTP 403 — SignatureDoesNotMatch' });

    const result = await checkPlansRead(PLANS);

    expect(result.status).toBe('failed');
    expect(result.summary).toContain('access key id');
    // The service's own words, which is the line that makes it fixable.
    expect(result.detail).toContain('SignatureDoesNotMatch');
  });

  it('reports a published agenda by size, without opening it', async () => {
    (getObject as jest.Mock).mockResolvedValue(new Uint8Array(1234));

    const result = await checkPlansRead(PLANS);

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('1,234 bytes');
  });
});

describe('the plans write', () => {
  it('writes the real manifest, to the real key', async () => {
    (putObject as jest.Mock).mockResolvedValue(null);

    const result = await checkPlansWrite(PLANS);

    expect(result.status).toBe('ok');
    const [, key, body, storageClass] = (putObject as jest.Mock).mock.calls[0];
    expect(key).toBe(MANIFEST_KEY);
    expect(storageClass).toBe('STANDARD');
    // The bucket's own salt and never the backup's — the whole point of two
    // buckets is that nothing about the backup lives where the planner looks.
    expect(JSON.parse(new TextDecoder().decode(body)).salt).toBe(PLANS.exchangeSaltHex);
  });

  /**
   * The bug this screen was written to find.
   *
   * Credentials can be perfect and the sync still never runs, because
   * `usePlanSync` gates on the key and returns before touching the network. From
   * outside it is indistinguishable from a queue that is merely slow, and it is
   * the one case a connectivity check must not paper over by testing the parts
   * that do work.
   */
  it('refuses to test a bucket with no passphrase, and says why nothing is sent', async () => {
    const result = await checkPlansWrite({ ...PLANS, exchangeKeyHex: '', exchangeSaltHex: '' });

    expect(result.status).toBe('off');
    expect(result.summary).toContain('no error is ever raised');
    expect(putObject).not.toHaveBeenCalled();
  });

  it('names every missing field rather than saying "not configured"', async () => {
    const result = await checkPlansWrite({ ...PLANS, exchangeAccessKeyId: '', exchangeSecretKey: '' });

    expect(result.status).toBe('off');
    expect(result.summary).toContain('access key id');
    expect(result.summary).toContain('secret key');
    expect(putObject).not.toHaveBeenCalled();
  });
});

describe('the backup bucket', () => {
  it('lists rather than writes, and reports what is up there', async () => {
    (listKeys as jest.Mock).mockResolvedValue(['days/2026-08-04', 'manifest.json']);

    const result = await checkBackupBucket(BACKUP);

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('2 objects');
    expect(putObject).not.toHaveBeenCalled();
  });

  it('does not call a reachable bucket with no passphrase a pass', async () => {
    (listKeys as jest.Mock).mockResolvedValue([]);

    const result = await checkBackupBucket({ ...BACKUP, backupKeyHex: '' });

    expect(result.status).toBe('failed');
    expect(result.summary).toContain('nothing can be sealed');
  });
});

describe('transcription', () => {
  it('proves the key without sending audio, and says how much credit is left', async () => {
    answering(200, { character_count: 1000, character_limit: 100_000 });

    const result = await checkTranscription({ ...DEFAULT_SETTINGS, transcriptionKey: 'xi-key' });

    expect(result.status).toBe('ok');
    expect(result.summary).toContain('99,000');
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(url)).toContain('/v1/user/subscription');
    expect((init.headers as Record<string, string>)['xi-api-key']).toBe('xi-key');
    // The rule the whole app is built on: nothing sends a recording without a
    // press on the note it belongs to, and this screen is not an exception.
    expect(init.body).toBeUndefined();
  });

  it('says a 401 means one of two things, because ElevenLabs uses it for both', async () => {
    answering(401, 'quota_exceeded');

    const result = await checkTranscription({ ...DEFAULT_SETTINGS, transcriptionKey: 'xi-key' });

    expect(result.status).toBe('failed');
    expect(result.summary).toContain('no credit left');
    expect(result.detail).toContain('quota_exceeded');
  });

  it('is off, not broken, with no key', async () => {
    const result = await checkTranscription(DEFAULT_SETTINGS);

    expect(result.status).toBe('off');
  });
});
