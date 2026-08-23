import { signS3Request, type AwsCredentials } from './sigv4';

/**
 * The three verbs this app knows.
 *
 * `PUT`, `GET` of a listing, and `GET` of one object. There is still no
 * `DELETE` — not because it would be hard, but because the bucket policy denies
 * the phone it, and a client that cannot express what it is not allowed to do is
 * one fewer place for that rule to be undone by accident.
 *
 * **`getObject` is new and it revises what stood here.** This file used to say
 * there was deliberately no `GET` of an object, which was true while the backup
 * was the only thing in the bucket. The agenda channel is the other direction —
 * the machine at home writes what it decided, the phone reads it — so the verb
 * has to exist. What keeps the original property is the policy: the phone may
 * read `agenda/` and nothing else, and `days/`, `media/`, `note-audio/` and
 * `plans/` stay unreadable to it. See `unsealWithKey` for the same note from the
 * other side.
 *
 * Every failure is returned rather than thrown, with the service's own words
 * attached. S3 answers a bad signature with a 403 and an XML body naming which
 * header it disagreed about, and that body is the difference between a fix and
 * an afternoon — the same lesson the transcription button taught, where a
 * generic message read on a phone as "no connection".
 */

export type BackupFailure = 'not-configured' | 'unauthorized' | 'no-such-bucket' | 'unreachable' | 'timeout' | 'failed';

export interface BackupError {
  readonly reason: BackupFailure;
  /** What the other end actually said, for the screen. Never logged. */
  readonly detail: string;
}

export interface BucketConfig extends AwsCredentials {
  readonly bucket: string;
}

const TIMEOUT_MS = 60_000;

/** Small objects and a phone on a slow connection; long enough not to fight it. */
function abortAfter(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function failureFor(status: number): BackupFailure {
  if (status === 403 || status === 401) return 'unauthorized';
  if (status === 404) return 'no-such-bucket';
  return 'failed';
}

function detailFrom(status: number, body: string): string {
  // S3's XML is verbose and its <Message> is the sentence worth reading.
  const message = /<Message>([^<]*)<\/Message>/.exec(body)?.[1];
  const code = /<Code>([^<]*)<\/Code>/.exec(body)?.[1];
  const said = [code, message].filter(Boolean).join(': ');
  return said.length > 0 ? `HTTP ${status} — ${said}` : `HTTP ${status}`;
}

function failureFromThrow(error: unknown, aborted: boolean): BackupError {
  if (aborted) return { reason: 'timeout', detail: `No answer in ${TIMEOUT_MS / 1000}s` };
  const named = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return { reason: 'unreachable', detail: named };
}

/**
 * Put one object, at a storage class chosen by its size.
 *
 * The class is a **signed** header, so the bucket sees the one the app chose and
 * the IAM policy — which permits exactly two — turns a mistake into a 403 rather
 * than a surprise on a bill.
 */
export async function putObject(
  config: BucketConfig,
  key: string,
  body: Uint8Array,
  storageClass: 'STANDARD' | 'GLACIER_IR',
  now: number,
): Promise<BackupError | null> {
  const signed = signS3Request({
    method: 'PUT',
    bucket: config.bucket,
    key,
    body,
    credentials: config,
    now,
    extraHeaders: { 'x-amz-storage-class': storageClass },
  });

  const { signal, done } = abortAfter(TIMEOUT_MS);
  try {
    const response = await fetch(signed.url, {
      method: 'PUT',
      headers: { ...signed.headers, 'content-type': 'application/octet-stream' },
      body: body as unknown as BodyInit,
      signal,
    });
    if (response.ok) return null;
    const text = await response.text().catch(() => '');
    return { reason: failureFor(response.status), detail: detailFrom(response.status, text) };
  } catch (error) {
    return failureFromThrow(error, signal.aborted);
  } finally {
    done();
  }
}

/**
 * Every key already in the bucket.
 *
 * This is the one read the phone makes, and it reads **names, never contents** —
 * which is what keeps "one way" true while still letting a reinstalled app avoid
 * uploading a year of recordings it already sent. `GetObject` is denied by the
 * bucket policy, so even a mistake here cannot become a read.
 *
 * Paged, because a thousand keys is where S3 truncates and a diary that has been
 * running two years is past that. A truncated listing that looked complete would
 * quietly re-upload everything beyond the first page, for ever.
 */
/**
 * One object, as bytes, or why it could not be had.
 *
 * A 404 comes back as `not-configured` rather than an error worth alarming
 * anybody about: an agenda that has not been published yet is the ordinary state
 * of a fresh install, not a fault.
 */
export async function getObject(config: BucketConfig, key: string, now: number): Promise<Uint8Array | BackupError> {
  const signed = signS3Request({
    method: 'GET',
    bucket: config.bucket,
    key,
    body: new Uint8Array(),
    credentials: config,
    now,
  });
  const { signal, done } = abortAfter(TIMEOUT_MS);
  try {
    const response = await fetch(signed.url, { method: 'GET', headers: signed.headers, signal });
    if (!response.ok) {
      const said = await response.text().catch(() => '');
      return { reason: response.status === 404 ? 'not-configured' : failureFor(response.status), detail: said };
    }
    return new Uint8Array(await response.arrayBuffer());
  } catch (error) {
    return {
      reason: error instanceof Error && error.name === 'AbortError' ? 'timeout' : 'unreachable',
      detail: error instanceof Error ? `${error.name}: ${error.message}` : String(error),
    };
  } finally {
    done();
  }
}

export async function listKeys(config: BucketConfig, now: number): Promise<readonly string[] | BackupError> {
  const keys: string[] = [];
  let token: string | undefined;

  do {
    const query: Record<string, string> = { 'list-type': '2' };
    if (token) query['continuation-token'] = token;

    const signed = signS3Request({
      method: 'GET',
      bucket: config.bucket,
      query,
      body: new Uint8Array(),
      credentials: config,
      now,
    });

    const { signal, done } = abortAfter(TIMEOUT_MS);
    try {
      const response = await fetch(signed.url, { method: 'GET', headers: signed.headers, signal });
      const text = await response.text();
      if (!response.ok) return { reason: failureFor(response.status), detail: detailFrom(response.status, text) };

      for (const match of text.matchAll(/<Key>([^<]+)<\/Key>/g)) {
        if (match[1]) keys.push(match[1]);
      }
      token = /<IsTruncated>true<\/IsTruncated>/.test(text)
        ? /<NextContinuationToken>([^<]+)<\/NextContinuationToken>/.exec(text)?.[1]
        : undefined;
    } catch (error) {
      return failureFromThrow(error, signal.aborted);
    } finally {
      done();
    }
  } while (token);

  return keys;
}
