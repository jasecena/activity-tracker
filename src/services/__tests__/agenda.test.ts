import { bytesToHex, utf8ToBytes } from '@noble/ciphers/utils.js';

import { AGENDA_VERSION } from '@/core/agenda';
import { fetchAgenda } from '@/services/agenda';
import { sealWithSalt } from '@/services/backup/seal';
import { getObject } from '@/services/backup/s3';
import { DEFAULT_SETTINGS, type Settings } from '@/services/settings';

/**
 * The one thing this app reads back out of the bucket, and the only reason an
 * unseal path exists on the phone at all.
 *
 * The seal is the **real** one here rather than a mock — an agenda is sealed
 * with the same function the app seals its own uploads with, and opened with the
 * one that will open it on a device. That round trip is the part worth asserting:
 * everything else is a message on a screen.
 */

jest.mock('@/services/backup/s3', () => ({ getObject: jest.fn() }));

const KEY = new Uint8Array(32).fill(7);
const SALT = new Uint8Array(16).fill(3);
const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);

const CONFIGURED: Settings = {
  ...DEFAULT_SETTINGS,
  exchangeBucket: 'my-exchange-bucket',
  exchangeRegion: 'ap-southeast-2',
  exchangeAccessKeyId: 'AKIA',
  exchangeSecretKey: 'shhh',
  exchangeKeyHex: bytesToHex(KEY),
};

function agendaBytes(body: unknown): Uint8Array {
  return sealWithSalt(KEY, utf8ToBytes(JSON.stringify(body)), SALT);
}

function item(over: Record<string, unknown> = {}) {
  return {
    id: 'abc123',
    title: 'باغچه پشتی را درست کن',
    detail: '',
    shape: 'once',
    urgency: 'soon',
    deadline: null,
    effortMinutes: 90,
    context: 'backyard',
    energy: 'high',
    suggestedAt: T0 + 3_600_000,
    why: 'شنبه صبح',
    quote: 'باید باغچه رو درست کنم',
    saidAt: T0,
    ...over,
  };
}

beforeEach(() => jest.clearAllMocks());

it('opens what the machine sealed, Persian and all', async () => {
  (getObject as jest.Mock).mockResolvedValue(
    agendaBytes({ version: AGENDA_VERSION, generatedAt: T0, items: [item()] }),
  );

  const result = await fetchAgenda(CONFIGURED);

  expect(result.ok).toBe(true);
  if (!result.ok) return;
  expect(result.agenda.items[0]?.title).toBe('باغچه پشتی را درست کن');
  expect(result.agenda.items[0]?.why).toBe('شنبه صبح');
  expect(result.agenda.generatedAt).toBe(T0);
});

it('asks for the one key both ends agree on', async () => {
  (getObject as jest.Mock).mockResolvedValue(agendaBytes({ version: AGENDA_VERSION, generatedAt: T0, items: [] }));

  await fetchAgenda(CONFIGURED);

  expect((getObject as jest.Mock).mock.calls[0]?.[1]).toBe('agenda/current.json');
});

it('says nothing is configured rather than reaching for a bucket that is not there', async () => {
  const result = await fetchAgenda(DEFAULT_SETTINGS);

  expect(result).toEqual({ ok: false, kind: 'not-configured' });
  expect(getObject).not.toHaveBeenCalled();
});

/** A bucket nothing has published to yet is the ordinary state of a fresh install. */
it('treats a missing agenda as nothing published rather than a fault', async () => {
  (getObject as jest.Mock).mockResolvedValue({ reason: 'not-configured', detail: '404' });

  expect(await fetchAgenda(CONFIGURED)).toEqual({ ok: false, kind: 'not-configured' });
});

it('reports what the bucket said when it refuses', async () => {
  (getObject as jest.Mock).mockResolvedValue({ reason: 'unauthorized', detail: '403 AccessDenied' });

  expect(await fetchAgenda(CONFIGURED)).toEqual({
    ok: false,
    kind: 'error',
    reason: 'unauthorized',
    detail: '403 AccessDenied',
  });
});

/**
 * The wrong key and altered bytes are indistinguishable to an authentication
 * tag, and neither is worth guessing between — so both refuse rather than
 * producing something plausible.
 */
it('refuses an object it cannot authenticate', async () => {
  const wrongKey = { ...CONFIGURED, exchangeKeyHex: bytesToHex(new Uint8Array(32).fill(9)) };
  (getObject as jest.Mock).mockResolvedValue(agendaBytes({ version: AGENDA_VERSION, generatedAt: T0, items: [] }));

  const result = await fetchAgenda(wrongKey);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.kind).toBe('error');
});

it('refuses bytes that are not one of ours at all', async () => {
  (getObject as jest.Mock).mockResolvedValue(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8, 9, 10]));

  const result = await fetchAgenda(CONFIGURED);

  expect(result.ok).toBe(false);
});

it('refuses an object that opened but is not JSON', async () => {
  (getObject as jest.Mock).mockResolvedValue(sealWithSalt(KEY, utf8ToBytes('not json at all'), SALT));

  const result = await fetchAgenda(CONFIGURED);

  expect(result.ok).toBe(false);
  if (result.ok) return;
  expect(result.kind).toBe('error');
});

/**
 * A newer writer is a build to install, not a screen to draw badly. The caller
 * keeps the last agenda it understood and says why.
 */
it('says an agenda is too new rather than half-reading it', async () => {
  (getObject as jest.Mock).mockResolvedValue(agendaBytes({ version: 99, generatedAt: T0, items: [item()] }));

  expect(await fetchAgenda(CONFIGURED)).toEqual({ ok: false, kind: 'too-new' });
});
