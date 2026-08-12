import { filePart, transcribe } from '../transcribe';

/**
 * The one thing in this app that sends a recording of its owner somewhere.
 *
 * What is worth proving here is mostly about *not* sending: no key means no
 * request at all, and the body that does go carries the audio and nothing about
 * the note it belongs to. The rest is that every way this can fail produces an
 * answer a sentence can be written from, because the person pressed a button and
 * is watching the screen.
 */

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';
const URI = 'file:///mock/documents/note-audio/voice-1.m4a';

const fetchMock = jest.fn();
globalThis.fetch = fetchMock as unknown as typeof fetch;

function answers(body: unknown, status = 200): void {
  fetchMock.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
    // Read on the failure path, for the detail line shown on screen.
    text: async () => JSON.stringify(body),
  });
}

/** The request the mock was called with, as the parts worth asserting about. */
function sent(): { readonly headers: Record<string, string>; readonly form: FormData } {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return { headers: init.headers as Record<string, string>, form: init.body as FormData };
}

/** FormData in the RN/jsdom shim keeps its parts; read them back by name. */
function parts(form: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  form.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

beforeEach(() => {
  fetchMock.mockReset();
});

describe('when there is no key', () => {
  /**
   * An empty key is the feature being off, and it is the only gate — so the
   * thing that must be true is that nothing is sent at all, not merely that the
   * call fails.
   */
  it('makes no request whatsoever', async () => {
    const result = await transcribe({ uri: URI, apiKey: '', languageCode: 'fa' });

    expect(result).toEqual({ ok: false, reason: 'no-key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('treats whitespace as no key', async () => {
    const result = await transcribe({ uri: URI, apiKey: '   ', languageCode: 'fa' });

    expect(result).toEqual({ ok: false, reason: 'no-key' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('makes no request for a recording whose bytes have gone', async () => {
    const result = await transcribe({ uri: '', apiKey: 'sk-real', languageCode: 'fa' });

    expect(result).toEqual({ ok: false, reason: 'no-audio' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('the request', () => {
  beforeEach(() => {
    answers({ text: 'سلام', language_code: 'fa' });
  });

  it('goes to the speech-to-text endpoint with the key in xi-api-key', async () => {
    await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' });

    expect(fetchMock.mock.calls[0]?.[0]).toBe(ENDPOINT);
    expect(sent().headers['xi-api-key']).toBe('sk-real');
  });

  /**
   * `fetch` generates the multipart boundary itself. Setting the header by hand
   * omits the boundary and the service rejects the body — a failure that reads
   * as a bad key rather than a bad request.
   */
  it('sets no Content-Type, so the multipart boundary is generated', async () => {
    await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' });

    const headers = sent().headers;
    expect(headers['Content-Type']).toBeUndefined();
    expect(headers['content-type']).toBeUndefined();
  });

  it('names the model and pins the language rather than letting it be detected', async () => {
    await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' });

    const body = parts(sent().form);
    expect(body.model_id).toBe('scribe_v2');
    expect(body.language_code).toBe('fa');
  });

  /**
   * The privacy claim in Settings, as an assertion. The request carries the
   * audio, the model and the language — the note's words, its title, its day and
   * the position on it all stay on the phone.
   */
  it('sends the audio and nothing about the note it belongs to', async () => {
    await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' });

    expect(Object.keys(parts(sent().form)).sort()).toEqual(['file', 'language_code', 'model_id']);
  });

  it('trims a key pasted with whitespace on it', async () => {
    await transcribe({ uri: URI, apiKey: '  sk-real\n', languageCode: 'fa' });

    expect(sent().headers['xi-api-key']).toBe('sk-real');
  });
});

describe('what comes back', () => {
  it('returns the text and the language the service reported', async () => {
    answers({ text: '  سلام  ', language_code: 'fa' });

    const result = await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' });

    expect(result).toEqual({ ok: true, text: 'سلام', languageCode: 'fa' });
  });

  /**
   * "Nothing was said" and "it did not work" want different sentences on
   * screen, so they are different answers here.
   */
  it('says silent for a recording with no speech in it', async () => {
    answers({ text: '   ', language_code: 'fa' });

    expect(await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' })).toEqual({
      ok: false,
      reason: 'silent',
    });
  });

  it('falls back to the requested language when the service does not name one', async () => {
    answers({ text: 'spoken' });

    const result = await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' });

    expect(result).toEqual({ ok: true, text: 'spoken', languageCode: 'fa' });
  });

  it.each([
    [401, 'unauthorized'],
    [403, 'unauthorized'],
    [429, 'rate-limited'],
    [422, 'failed'],
    [500, 'failed'],
  ])('reads HTTP %i as %s', async (status, reason) => {
    answers({ detail: 'nope' }, status);

    expect(await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' })).toMatchObject({ ok: false, reason });
  });

  /**
   * There is no server-side log, no crash reporter and no telemetry in this app,
   * so what the service said is only ever visible if it is put on the screen.
   */
  it('carries the service’s own words for the screen', async () => {
    answers({ detail: { code: 'quota_exceeded', message: 'You have 0 credits remaining' } }, 401);

    const result = await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' });

    expect(result).toMatchObject({ ok: false, reason: 'unauthorized' });
    expect((result as { detail: string }).detail).toContain('HTTP 401');
    expect((result as { detail: string }).detail).toContain('quota_exceeded');
  });

  it('says what threw, when something threw', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    const result = await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' });

    expect((result as { detail: string }).detail).toContain('TypeError: Network request failed');
  });

  it('does not let a huge error body take over the sheet', async () => {
    answers('x'.repeat(5000), 500);

    const result = await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' });

    expect((result as { detail: string }).detail.length).toBeLessThan(500);
  });

  it('does not trust a 200 that is not a transcript', async () => {
    answers({ unexpected: true });

    expect(await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  /**
   * React Native reports everything its networking layer could not finish as
   * this one message, so it is the honest boundary of what can be told apart —
   * and why the reason is `unreachable` rather than `offline`.
   */
  it('reads a request that could not be completed as unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('Network request failed'));

    expect(await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' })).toMatchObject({
      ok: false,
      reason: 'unreachable',
    });
  });

  it('does not call anything else unreachable', async () => {
    fetchMock.mockRejectedValue(new TypeError('undefined is not a function'));

    expect(await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' })).toMatchObject({
      ok: false,
      reason: 'failed',
    });
  });

  /**
   * The live service answers a spent key with 401 `quota_exceeded` rather than
   * 402 or 429 — measured against the real endpoint, not assumed.
   */
  it('reads a spent quota as a key problem, which is what 401 means here', async () => {
    answers({ detail: { code: 'quota_exceeded' } }, 401);

    expect(await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' })).toMatchObject({
      ok: false,
      reason: 'unauthorized',
    });
  });

  /**
   * `audio/m4a` is not a registered media type; `audio/mp4` is what an `.m4a`
   * container actually is. Asserted on the part directly because the test
   * environment's `FormData` stringifies it on the way in.
   */
  it('describes the file as a registered media type', () => {
    expect(filePart(URI)).toEqual({ uri: URI, name: 'note.m4a', type: 'audio/mp4' });
  });
});
