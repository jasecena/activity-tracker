import { bytesToHex, utf8ToBytes } from '@noble/ciphers/utils.js';
import { hmac } from '@noble/hashes/hmac.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * Signing a request to S3, by hand.
 *
 * The alternative was `@aws-sdk/client-s3`, which is megabytes of code and a
 * dependency tree this repository would not otherwise recognise, for two verbs.
 * SigV4 is about eighty lines and it is fully specified, which makes it the rare
 * case where writing it out is smaller *and* more inspectable than taking it —
 * the same argument that keeps this app free of a navigation library.
 *
 * Nothing here is clever. That is deliberate: a signing bug fails as a 403 with
 * no explanation of which byte was wrong, so every step is written the way the
 * specification states it rather than the way it could be shortened.
 *
 * **This file reads no clock**, for the same reason `core` does not: `now` is a
 * parameter, so the tests are not a different test on a different day.
 */

export interface AwsCredentials {
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  readonly region: string;
}

export interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

const SERVICE = 's3';
const ALGORITHM = 'AWS4-HMAC-SHA256';

/** `20260813T120000Z` and `20260813`, which are the only two forms SigV4 wants. */
export function stampsFor(now: number): { readonly amzDate: string; readonly dateStamp: string } {
  const iso = new Date(now).toISOString();
  const amzDate = `${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
  return { amzDate, dateStamp: amzDate.slice(0, 8) };
}

/**
 * Percent-encoding as S3 wants it for a key, which is **not** `encodeURIComponent`.
 *
 * The unreserved set is the one RFC 3986 names, and `encodeURIComponent` leaves
 * `!'()*` alone while the specification requires them escaped. The keys this app
 * writes are dates and ids and would never notice — which is exactly why it is
 * written correctly now rather than after a file name with a bracket in it
 * produces an unsignable request nobody can reproduce.
 */
function uriEncode(input: string, encodeSlash: boolean): string {
  let out = '';
  for (const character of input) {
    if (/[A-Za-z0-9\-._~]/.test(character)) out += character;
    else if (character === '/') out += encodeSlash ? '%2F' : '/';
    else {
      for (const byte of utf8ToBytes(character)) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
    }
  }
  return out;
}

function hmacHex(key: Uint8Array, data: string): Uint8Array {
  return hmac(sha256, key, utf8ToBytes(data));
}

/** The four-step chain that ties a key to one day, one region and one service. */
function signingKey(secret: string, dateStamp: string, region: string): Uint8Array {
  const date = hmacHex(utf8ToBytes(`AWS4${secret}`), dateStamp);
  const scopedRegion = hmacHex(date, region);
  const scopedService = hmacHex(scopedRegion, SERVICE);
  return hmacHex(scopedService, 'aws4_request');
}

export interface SignParams {
  readonly method: 'PUT' | 'GET';
  readonly bucket: string;
  /** The object key, unencoded. Empty for a request about the bucket itself. */
  readonly key?: string;
  /** Already-sorted query parameters, unencoded. */
  readonly query?: Readonly<Record<string, string>>;
  readonly body: Uint8Array;
  readonly credentials: AwsCredentials;
  readonly now: number;
  /** Anything beyond the three SigV4 always sends. Lower-cased by the caller. */
  readonly extraHeaders?: Readonly<Record<string, string>>;
  /**
   * Override the derived host.
   *
   * Only for checking this implementation against AWS's own published example,
   * whose host predates regional endpoints. Nothing in the app passes it.
   */
  readonly host?: string;
}

/**
 * A signed request, ready to hand to `fetch`.
 *
 * Virtual-hosted style (`<bucket>.s3.<region>.amazonaws.com`) because path style
 * is deprecated for new buckets, and the region is in the host rather than left
 * to a redirect — S3 answers a wrong-region request with a 301 that `fetch`
 * cannot follow while keeping the signature valid.
 */
export function signS3Request({
  method,
  bucket,
  key = '',
  query = {},
  body,
  credentials,
  now,
  extraHeaders = {},
  host: hostOverride,
}: SignParams): SignedRequest {
  const { amzDate, dateStamp } = stampsFor(now);
  const host = hostOverride ?? `${bucket}.s3.${credentials.region}.amazonaws.com`;
  const payloadHash = bytesToHex(sha256(body));

  const canonicalUri = key.length === 0 ? '/' : `/${uriEncode(key, false)}`;
  const canonicalQuery = Object.keys(query)
    .sort()
    .map((name) => `${uriEncode(name, true)}=${uriEncode(query[name] ?? '', true)}`)
    .join('&');

  // The three S3 requires, plus whatever the caller adds. Sorted by name and
  // lower-cased, which is the part of the canonical form most easily got wrong.
  const headers: Record<string, string> = {
    host,
    'x-amz-content-sha256': payloadHash,
    'x-amz-date': amzDate,
    ...extraHeaders,
  };
  const names = Object.keys(headers)
    .map((name) => name.toLowerCase())
    .sort();
  const canonicalHeaders = names.map((name) => `${name}:${(headers[name] ?? '').trim()}\n`).join('');
  const signedHeaders = names.join(';');

  const canonicalRequest = [method, canonicalUri, canonicalQuery, canonicalHeaders, signedHeaders, payloadHash].join(
    '\n',
  );

  const scope = `${dateStamp}/${credentials.region}/${SERVICE}/aws4_request`;
  const stringToSign = [ALGORITHM, amzDate, scope, bytesToHex(sha256(utf8ToBytes(canonicalRequest)))].join('\n');

  const signature = bytesToHex(
    hmacHex(signingKey(credentials.secretAccessKey, dateStamp, credentials.region), stringToSign),
  );

  const url = `https://${host}${canonicalUri}${canonicalQuery.length > 0 ? `?${canonicalQuery}` : ''}`;
  return {
    url,
    headers: {
      ...headers,
      Authorization: `${ALGORITHM} Credential=${credentials.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`,
    },
  };
}
