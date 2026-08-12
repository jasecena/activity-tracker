import { holdScreenAwake, releaseScreenAwake } from './wakefulness';

/**
 * The one file that sends anything to ElevenLabs.
 *
 * **This is the second thing in the app that leaves the phone, and the first
 * that is a recording of its owner.** Apple Maps imagery — the only other
 * request — sends the region you are looking at; this sends your voice. The
 * whole of `docs/ARCHITECTURE.md` § 12 exists to keep that list short and
 * honest, so the rules are stricter here than anywhere else in `services`:
 *
 * **Nothing happens without a press.** There is no automatic transcription, no
 * queue that drains on launch, and no retry on a schedule. A recording is
 * uploaded when its owner taps the button on the note it belongs to, and never
 * otherwise. That is what lets this be a plain request-and-wait rather than the
 * background-upload machinery § 15 anticipated: the person is looking at the
 * screen, so a failure can simply say so.
 *
 * **No key, no request.** An empty key is the feature being off, and it is the
 * only gate — there is no separate switch to leave on by accident. A fresh
 * install cannot transcribe anything because there is nothing to authenticate
 * with, which is a stronger guarantee than a boolean defaulting to false.
 *
 * **The audio only. No note text, no title, no day, no coordinates.** The
 * request carries the file, the model and the language, and the position on the
 * note stays on the phone. A transcript is the only thing that comes back and
 * the only thing that is kept.
 *
 * The reading is appended to the note by `appendTranscript`, never written over
 * it — see `core/day/notes.ts` for why that is the safety property rather than a
 * convenience.
 */

const ENDPOINT = 'https://api.elevenlabs.io/v1/speech-to-text';

/**
 * Scribe v2. Named here rather than made configurable: it is the model § 15
 * chose on Persian accuracy, and a wrong value is a 422 rather than a worse
 * transcript.
 */
const MODEL_ID = 'scribe_v2';

/**
 * How long to wait before giving up, in ms.
 *
 * `fetch` has no timeout of its own, so without this a request that never
 * answers leaves the button spinning for the life of the screen. Generous
 * because the upload is the slow part and a long note on a slow connection is
 * not a failure — but finite, because "it is still going" has to become "it
 * did not work" eventually.
 */
const TIMEOUT_MS = 120_000;

/** Why a transcription did not happen, in terms a sentence can be written about. */
export type TranscriptionFailure =
  /** No API key stored — the feature is off. */
  | 'no-key'
  /** The recording's bytes are missing; nothing to send. */
  | 'no-audio'
  /** The service rejected the key. */
  | 'unauthorized'
  /** Out of credit, or too many requests. */
  | 'rate-limited'
  /** The request never reached the service. */
  | 'offline'
  /** It reached the service and nothing came back in time. */
  | 'timeout'
  /** It worked, and there was no speech in the recording. */
  | 'silent'
  /** Anything else, including a response this app does not understand. */
  | 'failed';

export type TranscriptionResult =
  | { readonly ok: true; readonly text: string; readonly languageCode: string }
  | { readonly ok: false; readonly reason: TranscriptionFailure };

export interface TranscriptionRequest {
  /** A file URI for the recording — `noteAudioUri`, not a note or an id. */
  readonly uri: string;
  readonly apiKey: string;
  /** ISO-639 code, pinned rather than detected. See `settings.transcriptionLanguage`. */
  readonly languageCode: string;
}

/**
 * A React Native `FormData` part for a file on disk.
 *
 * RN accepts `{ uri, name, type }` where the DOM types demand a `Blob`, and
 * this is the documented idiom rather than a trick — but the cast has to be
 * written down somewhere, so it is written down here.
 */
function filePart(uri: string): Blob {
  return { uri, name: 'note.m4a', type: 'audio/m4a' } as unknown as Blob;
}

function failureFor(status: number): TranscriptionFailure {
  if (status === 401 || status === 403) return 'unauthorized';
  if (status === 429) return 'rate-limited';
  return 'failed';
}

/**
 * Send one recording and wait for its text.
 *
 * The key and the language are parameters rather than reads: this file has no
 * opinion about where settings live, which is what keeps it the only thing in
 * the app that knows the endpoint exists.
 *
 * **The screen is held awake for the request**, on the same reasoning as a
 * capture: waiting for a network response is not user activity, so a phone put
 * down while a long note uploads looks to the auto-lock timer exactly like a
 * phone left alone.
 */
export async function transcribe({ uri, apiKey, languageCode }: TranscriptionRequest): Promise<TranscriptionResult> {
  if (apiKey.trim().length === 0) return { ok: false, reason: 'no-key' };
  if (uri.length === 0) return { ok: false, reason: 'no-audio' };

  const form = new FormData();
  form.append('file', filePart(uri));
  form.append('model_id', MODEL_ID);
  // Pinned, never detected. Declaring the language is most of the distance
  // between Scribe's code-switched and single-language accuracy on Persian —
  // see `docs/BACKLOG.md` § 15.
  form.append('language_code', languageCode);

  const abort = new AbortController();
  const timer = setTimeout(() => abort.abort(), TIMEOUT_MS);
  await holdScreenAwake();

  try {
    const response = await fetch(ENDPOINT, {
      method: 'POST',
      // **No `Content-Type` here, deliberately.** `fetch` generates the
      // multipart boundary and sets the header itself; setting it by hand omits
      // the boundary and the service rejects the body as malformed.
      headers: { 'xi-api-key': apiKey.trim() },
      body: form,
      signal: abort.signal,
    });

    if (!response.ok) return { ok: false, reason: failureFor(response.status) };

    const body: unknown = await response.json();
    if (typeof body !== 'object' || body === null) return { ok: false, reason: 'failed' };

    const { text, language_code: code } = body as { text?: unknown; language_code?: unknown };
    if (typeof text !== 'string') return { ok: false, reason: 'failed' };

    const spoken = text.trim();
    // A successful transcription of a recording with no speech in it. Worth its
    // own answer: "nothing was said" and "it did not work" want different
    // sentences on screen.
    if (spoken.length === 0) return { ok: false, reason: 'silent' };

    return { ok: true, text: spoken, languageCode: typeof code === 'string' ? code : languageCode };
  } catch {
    // The error itself is deliberately not logged. A fetch error can carry the
    // request URL and, on some platforms, headers with it — and
    // `services/timing.ts` already draws the line that nothing which could
    // carry a key or a content reaches a console, because device logs are
    // swept into a sysdiagnose.
    console.warn('Could not transcribe the recording');
    return { ok: false, reason: abort.signal.aborted ? 'timeout' : 'offline' };
  } finally {
    clearTimeout(timer);
    void releaseScreenAwake();
  }
}
