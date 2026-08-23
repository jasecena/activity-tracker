import { renderHook, waitFor } from '@testing-library/react-native';

import { dayNoteId, type DayNote, type NoteVoice } from '@/core/day';
import { putObject } from '@/services/backup/s3';
import { DEFAULT_SETTINGS, type Settings } from '@/services/settings';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';
import { transcribe } from '@/services/transcribe';

import { usePlanSync } from './usePlanSync';

/**
 * The one thing in this app that talks to a network without being pressed.
 *
 * So what is asserted here is mostly about restraint: that it sends nothing
 * until there is somewhere to send it, that it never touches the diary, and that
 * a failure leaves everything exactly where it was so the next pass tries again.
 * The recording never leaves — only its words — and that has its own assertion
 * because it is the promise Settings makes on this feature's behalf.
 */

jest.mock('@/services/transcribe', () => ({ transcribe: jest.fn() }));
jest.mock('@/services/backup/s3', () => ({ putObject: jest.fn(async () => null) }));
// Identity, so the bytes reaching the bucket can be read in a test. The real
// seal has its own format check against the Python script.
jest.mock('@/services/backup', () => ({ sealObject: (_key: unknown, bytes: Uint8Array) => bytes }));
jest.mock('@/services/noteAudio', () => ({ noteAudioUri: (name: string) => `file:///note-audio/${name}` }));

const T0 = Date.UTC(2026, 0, 5, 9, 0, 0);

const CONFIGURED: Settings = {
  ...DEFAULT_SETTINGS,
  backupBucket: 'my-bucket',
  backupRegion: 'ap-southeast-2',
  backupAccessKeyId: 'AKIA',
  backupSecretKey: 'shhh',
  backupKeyHex: '00'.repeat(32),
  transcriptionKey: 'el-key',
  transcriptionLanguage: 'fa',
};

function voice(): NoteVoice {
  return { fileName: 'voice-1.m4a', durationMs: 90_000, byteLength: 2048, at: null, locked: false };
}

function plan(at: number, text: string, over: Partial<DayNote> = {}): DayNote {
  return { id: dayNoteId(at), at, title: '', text, voice: null, mediaId: null, kind: 'plan', ...over };
}

// `renderHook` is asynchronous in this version of the testing library. Not
// awaiting it leaves the act scope open and the *next* render in the file
// silently never runs its effects, which is why one un-awaited helper failed
// eight tests rather than one.
async function run(notes: readonly DayNote[], settings: Settings = CONFIGURED) {
  const onTranscript = jest.fn();
  const view = await renderHook(() => usePlanSync({ notes, ready: true, settings, onTranscript }));
  return { ...view, onTranscript };
}

const sent = () => (putObject as jest.Mock).mock.calls;
const bodyOf = (call: unknown[]) => new TextDecoder().decode(call[2] as Uint8Array);

/**
 * **Let each pass finish before the next test clears the store.**
 *
 * This hook writes its record after the request comes back, so work still in
 * flight when the next `beforeEach` empties the store lands afterwards and puts
 * the previous test's record back — which reads, from inside the next test, as
 * the hook remembering work it was never told about. Unmounting by hand does
 * not help and actively hurt: the testing library cleans up on its own, and
 * unmounting twice leaves the next `renderHook` handing back a null result.
 */
afterEach(async () => {
  await new Promise((resolve) => setTimeout(resolve, 0));
});

beforeEach(async () => {
  jest.clearAllMocks();
  await writeJson(STORAGE_KEYS.planSync, { transcribed: {}, sent: {} });
});

describe('before there is anywhere to send them', () => {
  it('sends nothing at all', async () => {
    const { result } = await run([plan(T0, 'fix the garden')], DEFAULT_SETTINGS);

    await waitFor(() => expect(result.current.waiting).toBe(1));
    expect(sent()).toHaveLength(0);
  });

  /** An empty transcription key is the only gate, exactly as it is for the button. */
  it('does not ask for words with no key', async () => {
    const settings = { ...CONFIGURED, transcriptionKey: '' };
    const { result } = await run([plan(T0, '', { voice: voice() })], settings);

    await waitFor(() => expect(result.current.waiting).toBe(1));
    expect(transcribe).not.toHaveBeenCalled();
  });
});

describe('sending a plan', () => {
  it('puts it under a key derived from its id', async () => {
    await run([plan(T0, 'fix the garden')]);

    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(sent()[0]?.[1]).toBe(`plans/note-${T0}.json`);
  });

  it('carries the words and the instant', async () => {
    await run([plan(T0, 'fix the garden', { title: 'Garden' })]);

    await waitFor(() => expect(sent()).toHaveLength(1));
    const body = JSON.parse(bodyOf(sent()[0] as unknown[]));
    expect(body).toMatchObject({ title: 'Garden', text: 'fix the garden', at: T0 });
  });

  /**
   * The promise Settings makes on this feature's behalf: its words only, never
   * its recording. The file stays on the phone, where it is already swept,
   * already spared by retention and already in the ordinary backup.
   */
  it('never carries the recording', async () => {
    // A spoken plan is transcribed first and uploaded on the pass after, so the
    // words have to arrive before there is anything to assert about the bytes.
    (transcribe as jest.Mock).mockResolvedValue({ ok: true, text: 'said aloud', languageCode: 'fa' });

    await run([plan(T0, 'said and typed', { voice: voice() })]);

    await waitFor(() => expect(sent()).toHaveLength(1));
    expect(bodyOf(sent()[0] as unknown[])).not.toContain('voice-1.m4a');
  });

  it('never sends a diary entry, however it was written', async () => {
    const { result } = await run([
      { ...plan(T0, 'went to the beach'), kind: 'note' },
      { ...plan(T0 + 1000, 'spoke about the beach', { voice: voice() }), kind: 'note' },
    ]);

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(sent()).toHaveLength(0);
    expect(transcribe).not.toHaveBeenCalled();
  });

  it('holds a spoken plan back until its words arrive', async () => {
    (transcribe as jest.Mock).mockResolvedValue({ ok: false, reason: 'unreachable', detail: 'no route' });

    await run([plan(T0, '', { voice: voice() })]);

    await waitFor(() => expect(transcribe).toHaveBeenCalled());
    expect(sent()).toHaveLength(0);
  });

  it('sends the same plan once, not on every pass', async () => {
    const notes = [plan(T0, 'fix the garden')];
    const { rerender } = await run(notes);

    await waitFor(() => expect(sent()).toHaveLength(1));
    await rerender({});
    await rerender({});

    await waitFor(() => expect(sent()).toHaveLength(1));
  });
});

describe('fetching the words for one that was spoken', () => {
  it('appends them to the note rather than replacing what was typed', async () => {
    (transcribe as jest.Mock).mockResolvedValue({ ok: true, text: 'fix the backyard garden', languageCode: 'fa' });
    const spoken = plan(T0, '', { voice: voice() });

    const { onTranscript } = await run([spoken]);

    await waitFor(() => expect(onTranscript).toHaveBeenCalledWith(spoken, 'fix the backyard garden'));
  });

  it('sends the recording to be transcribed and nothing else with it', async () => {
    (transcribe as jest.Mock).mockResolvedValue({ ok: true, text: 'words', languageCode: 'fa' });

    await run([plan(T0, '', { voice: voice() })]);

    await waitFor(() => expect(transcribe).toHaveBeenCalled());
    expect((transcribe as jest.Mock).mock.calls[0]?.[0]).toEqual({
      uri: 'file:///note-audio/voice-1.m4a',
      apiKey: 'el-key',
      languageCode: 'fa',
    });
  });
});

/**
 * Nothing is ever lost by a failure. The note was saved long before any of this
 * started, so the cost of a bad pass is one retry.
 */
describe('when it does not work', () => {
  it('keeps the plan in the queue and says what the bucket said', async () => {
    (putObject as jest.Mock).mockResolvedValue({ reason: 'unauthorized', detail: '403 SignatureDoesNotMatch' });

    const { result } = await run([plan(T0, 'fix the garden')]);

    await waitFor(() => expect(result.current.trouble?.reason).toBe('unauthorized'));
    expect(result.current.trouble?.detail).toBe('403 SignatureDoesNotMatch');
    expect(result.current.waiting).toBe(1);
  });

  /**
   * The retry is asserted through the record rather than by remounting: an
   * upload that failed must leave no entry under its key, which is precisely
   * what makes the next pass pick it up again. Calling `unmount` by hand to
   * force a second mount broke every test after it in this file — the testing
   * library cleans up on its own and does not want the help.
   */
  it('does not record a failed upload as sent', async () => {
    (putObject as jest.Mock).mockResolvedValue({ reason: 'unreachable', detail: 'offline' });
    const one = plan(T0, 'fix the garden');

    const { result } = await run([one]);

    await waitFor(() => expect(result.current.trouble?.reason).toBe('unreachable'));
    const stored = await readJson<{ sent: Record<string, string> }>(STORAGE_KEYS.planSync);
    expect(stored?.sent ?? {}).toEqual({});
    // Still counted as waiting, which is what the Plans list will say.
    expect(result.current.waiting).toBe(1);
  });

  /**
   * A recording that came back silent is answered, not asked about for ever.
   *
   * Two halves, asserted separately and seeded rather than chained: a pass that
   * depends on a previous pass having written the store is a test that passes
   * alone and fails in a suite, which is exactly what this one did first.
   */
  it('records a silent recording as answered', async () => {
    (transcribe as jest.Mock).mockResolvedValue({ ok: false, reason: 'silent', detail: '' });
    const spoken = plan(T0, '', { voice: voice() });

    const { result } = await run([spoken]);

    await waitFor(() => expect(result.current.trouble?.reason).toBe('silent'));
    await waitFor(async () =>
      expect((await readJson<{ transcribed: Record<string, true> }>(STORAGE_KEYS.planSync))?.transcribed).toEqual({
        [spoken.id]: true,
      }),
    );
  });

  it('never asks again about one already answered', async () => {
    const spoken = plan(T0, '', { voice: voice() });
    await writeJson(STORAGE_KEYS.planSync, { transcribed: { [spoken.id]: true }, sent: {} });

    const { result } = await run([spoken]);

    await waitFor(() => expect(result.current.busy).toBe(false));
    expect(transcribe).not.toHaveBeenCalled();
  });
});
