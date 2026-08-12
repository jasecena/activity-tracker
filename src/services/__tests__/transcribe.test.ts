import { transcribe } from '../transcribe';

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

    expect(await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' })).toEqual({ ok: false, reason });
  });

  it('does not trust a 200 that is not a transcript', async () => {
    answers({ unexpected: true });

    expect(await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' })).toEqual({
      ok: false,
      reason: 'failed',
    });
  });

  it('reads a request that never arrived as offline', async () => {
    fetchMock.mockRejectedValue(new Error('Network request failed'));

    expect(await transcribe({ uri: URI, apiKey: 'sk-real', languageCode: 'fa' })).toEqual({
      ok: false,
      reason: 'offline',
    });
  });
});
