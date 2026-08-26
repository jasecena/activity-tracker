import { act, renderHook, waitFor } from '@testing-library/react-native';

import { dayNoteId, type DayNote, type NoteVoice } from '@/core/day';
import { putObject } from '@/services/backup/s3';
import { DEFAULT_SETTINGS, type Settings } from '@/services/settings';
import { STORAGE_KEYS, writeJson } from '@/services/storage';

import { usePlanSync } from './usePlanSync';

/**
 * Sending plans, which is now a press and used to not be.
 *
 * **The first assertion in this file is that nothing happens on its own**, and
 * it is the one that matters most. This hook transcribed and uploaded
 * unattended, and what leaves it does not stop at a bucket: a machine at home
 * reads it, hands it to a model, and writes what the model decided into a
 * database. An unread transcript is a wrong commitment sitting in that
 * database, and correcting it costs far more than a button does.
 *
 * The rest is restraint of the older kind, unchanged: it never touches the
 * diary, the recording never leaves — only its words — and a failure leaves
 * everything where it was so the next press tries again.
 */

jest.mock('@/services/backup/s3', () => ({ putObject: jest.fn(async () => null) }));
/**
 * The seal is stubbed, but **the key it was handed is kept**.
 *
 * Which key sealed a plan is the whole of the two-bucket guarantee, and a stub
 * that threw its first argument away could not tell the right key from the one
 * that opens every journey this phone has recorded.
 */
const sealedWith: Uint8Array[] = [];
jest.mock('@/services/backup', () => ({
  sealObject: (key: Uint8Array, bytes: Uint8Array) => {
    sealedWith.push(key);
    return bytes;
  },
}));

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);

const CONFIGURED: Settings = {
  ...DEFAULT_SETTINGS,
  exchangeBucket: 'my-exchange-bucket',
  exchangeRegion: 'ap-southeast-2',
  exchangeAccessKeyId: 'AKIA',
  exchangeSecretKey: 'shhh',
  exchangeKeyHex: '00'.repeat(32),
  exchangeSaltHex: 'aa'.repeat(16),
};

function voice(): NoteVoice {
  return { fileName: 'voice-1.m4a', durationMs: 90_000, byteLength: 2048, at: null, locked: false };
}

function plan(at: number, text: string, over: Partial<DayNote> = {}): DayNote {
  return { id: dayNoteId(at), at, title: '', text, voice: null, mediaId: null, kind: 'plan', ...over };
}

/**
 * Mount, and hand back a `press` that sends and waits.
 *
 * `renderHook` is asynchronous in this version of the testing library. Not
 * awaiting it leaves the act scope open and the *next* render in the file
 * silently never runs its effects.
 */
async function mount(notes: readonly DayNote[], settings: Settings = CONFIGURED) {
  sealedWith.length = 0;
  const view = await renderHook(() => usePlanSync({ notes, ready: true, settings }));
  // The stored record is read in an effect, and a press before that lands is a
  // press the hook is right to ignore. Waiting for the count is waiting for the
  // read, without reaching into the hook to find out.
  await waitFor(() => expect(view.result.current).toBeTruthy());
  const press = async () => {
    await act(async () => {
      view.result.current.send();
    });
    await waitFor(() => expect(view.result.current.busy).toBe(false));
  };
  return { ...view, press };
}

/** Every PUT this hook made, in order. */
const puts = () => (putObject as jest.Mock).mock.calls;
/**
 * The plans only.
 *
 * The manifest goes up before the first of them and is asserted on its own,
 * below — keeping it out of this helper is what stops every count in the file
 * being off by one and saying nothing about why.
 */
const sent = () => puts().filter((call) => String(call[1]).startsWith('plans/'));
const manifests = () => puts().filter((call) => call[1] === 'manifest.json');
const bodyOf = (call: unknown[]) => new TextDecoder().decode(call[2] as Uint8Array);

afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

beforeEach(async () => {
  // **`clearAllMocks` clears calls, not implementations.** A test that makes the
  // bucket refuse leaves it refusing for every test after it, and those then
  // fail for a reason that has nothing to do with what they are checking.
  jest.clearAllMocks();
  (putObject as jest.Mock).mockResolvedValue(null);
  await writeJson(STORAGE_KEYS.planSync, { sent: {} });
});

describe('nothing happens without a press', () => {
  /**
   * The whole reason this hook was rewritten. It used to fire on a list change,
   * which meant a plan reached a database before anybody had read what the
   * transcriber made of it.
   */
  it('sends nothing when a plan simply appears', async () => {
    await mount([plan(T0, 'fix the garden')]);

    // Long enough that an effect-driven upload would have happened.
    await new Promise((resolve) => setTimeout(resolve, 10));
    expect(putObject).not.toHaveBeenCalled();
  });

  it('sends it when Send is pressed', async () => {
    const { press } = await mount([plan(T0, 'fix the garden')]);

    await press();

    expect(sent()).toHaveLength(1);
  });

  it('counts what is waiting, so the button can say how many', async () => {
    const { result } = await mount([plan(T0, 'fix the garden'), plan(T0 + 1000, 'call the plumber')]);

    await waitFor(() => expect(result.current.waiting).toBe(2));
  });
});

describe('before there is anywhere to send them', () => {
  it('sends nothing at all, even when pressed', async () => {
    const { press } = await mount([plan(T0, 'fix the garden')], DEFAULT_SETTINGS);

    await press();

    expect(putObject).not.toHaveBeenCalled();
  });
});

describe('sending a plan', () => {
  it('puts it under a key derived from its id', async () => {
    const one = plan(T0, 'fix the garden');
    const { press } = await mount([one]);

    await press();

    expect(sent()[0]?.[1]).toBe(`plans/${one.id}.json`);
  });

  it('carries the words and the instant', async () => {
    const { press } = await mount([plan(T0, 'fix the garden', { title: 'garden' })]);

    await press();

    const payload = JSON.parse(bodyOf(sent()[0]!));
    expect(payload.text).toBe('fix the garden');
    expect(payload.title).toBe('garden');
    expect(payload.at).toBe(T0);
  });

  it('never carries the recording', async () => {
    const { press } = await mount([plan(T0, 'said out loud', { voice: voice() })]);

    await press();

    const payload = JSON.parse(bodyOf(sent()[0]!));
    expect(payload.spokenMs).toBe(90_000);
    expect(JSON.stringify(payload)).not.toContain('voice-1.m4a');
  });

  it('never sends a diary entry, however it was written', async () => {
    const { press } = await mount([
      plan(T0, 'a plan'),
      { ...plan(T0 + 1000, 'a diary entry'), kind: 'note' } as DayNote,
    ]);

    await press();

    expect(sent()).toHaveLength(1);
    expect(bodyOf(sent()[0]!)).toContain('a plan');
  });

  /**
   * A spoken plan with no words yet is not sendable, and that is now the whole
   * mechanism rather than a race: transcription is the note sheet's button, so
   * a recording waits until somebody asks for its words and keeps them.
   */
  it('holds a spoken plan back until it has words', async () => {
    const { press } = await mount([plan(T0, '', { voice: voice() })]);

    await press();

    expect(sent()).toHaveLength(0);
  });

  it('sends the same plan once, not on every press', async () => {
    const { press } = await mount([plan(T0, 'fix the garden')]);

    await press();
    await press();

    expect(sent()).toHaveLength(1);
  });
});

describe('the manifest', () => {
  it('publishes the salt before it sends the first plan', async () => {
    const { press } = await mount([plan(T0, 'fix the garden')]);

    await press();

    expect(puts()[0]?.[1]).toBe('manifest.json');
    expect(puts()[1]?.[1]).toContain('plans/');
  });

  it('carries this bucket’s salt, and never the backup’s', async () => {
    const { press } = await mount([plan(T0, 'fix the garden')], { ...CONFIGURED, backupSaltHex: 'ff'.repeat(16) });

    await press();

    const manifest = JSON.parse(bodyOf(manifests()[0]!));
    expect(manifest.salt).toBe(CONFIGURED.exchangeSaltHex);
    expect(manifest.salt).not.toBe('ff'.repeat(16));
  });

  it('publishes it once, not before every plan', async () => {
    const { press } = await mount([plan(T0, 'one'), plan(T0 + 1000, 'two')]);

    await press();

    expect(manifests()).toHaveLength(1);
    expect(sent()).toHaveLength(2);
  });

  it('holds the plans back if the salt cannot be published', async () => {
    (putObject as jest.Mock).mockResolvedValue({ reason: 'unauthorized', detail: '403 AccessDenied' });
    const { press } = await mount([plan(T0, 'fix the garden')]);

    await press();

    expect(sent()).toHaveLength(0);
  });
});

describe('which key it seals with, and which bucket it sends to', () => {
  it('seals a plan with the plans key and never the backup key', async () => {
    const { press } = await mount([plan(T0, 'fix the garden')], {
      ...CONFIGURED,
      backupKeyHex: 'bb'.repeat(32),
    });

    await press();

    expect(sealedWith).toHaveLength(1);
    expect(Array.from(sealedWith[0]!)).toEqual(Array.from(new Uint8Array(32)));
  });

  it('addresses every request to the plans bucket', async () => {
    const { press } = await mount([plan(T0, 'fix the garden')], {
      ...CONFIGURED,
      backupBucket: 'my-backup-bucket',
    });

    await press();

    for (const call of puts()) {
      expect((call[0] as { bucket: string }).bucket).toBe('my-exchange-bucket');
    }
  });

  it('sends nothing at all when only the backup is configured', async () => {
    const { press } = await mount([plan(T0, 'fix the garden')], {
      ...DEFAULT_SETTINGS,
      backupBucket: 'my-backup-bucket',
      backupAccessKeyId: 'AKIA',
      backupSecretKey: 'shhh',
      backupKeyHex: 'bb'.repeat(32),
    });

    await press();

    expect(putObject).not.toHaveBeenCalled();
  });
});

describe('when it does not work', () => {
  it('keeps the plan in the queue and says what the bucket said', async () => {
    (putObject as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ reason: 'unauthorized', detail: '403 SignatureDoesNotMatch' });
    const { result, press } = await mount([plan(T0, 'fix the garden')]);

    await press();

    expect(result.current.trouble?.reason).toBe('unauthorized');
    expect(result.current.trouble?.detail).toContain('SignatureDoesNotMatch');
    await waitFor(() => expect(result.current.waiting).toBe(1));
  });

  it('does not record a failed upload as sent', async () => {
    (putObject as jest.Mock)
      .mockResolvedValueOnce(null)
      .mockResolvedValue({ reason: 'unreachable', detail: 'offline' });
    const { press } = await mount([plan(T0, 'fix the garden')]);

    await press();
    // The bucket comes back, and the same plan goes on the next press.
    (putObject as jest.Mock).mockResolvedValue(null);
    await press();

    expect(sent().length).toBeGreaterThanOrEqual(2);
  });
});
