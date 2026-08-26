import { hexToBytes } from '@noble/ciphers/utils.js';

import { readAgenda, type Agenda } from '@/core/agenda';
import { unsealWithKey } from '@/services/backup/seal';
import { getObject, type BackupError, type BucketConfig } from '@/services/backup/s3';
import { now as readNow } from '@/services/clock';
import type { Settings } from '@/services/settings';

/**
 * Fetching what the machine at home decided.
 *
 * **The one thing this app reads back out of the bucket**, and the only reason
 * an unseal path exists on the phone at all. Everything else in that bucket is
 * written and forgotten; `agenda/current.json` is written at the other end and
 * read here.
 *
 * Three properties hold it down, and all three are the mirror of what already
 * governs the write direction:
 *
 * **Its own key, in its own bucket.** The agenda is sealed with the exchange
 * key, never the backup's — because the machine that writes it must hold that
 * key, and a machine that holds the backup's key could read every journey this
 * phone has recorded. This used to be one bucket split by prefix, with a policy
 * condition keeping the two apart; it is now two buckets and two keys, so the
 * separation is structural rather than conditional. `Settings.exchangeBucket`
 * argues it in full and `unsealWithKey` says the same from the other side.
 *
 * What the phone may do in that bucket is still narrow: `GetObject` on
 * `agenda/` and nothing else, so it cannot read back the plans it sent.
 *
 * **One object, replaced whole.** No log to replay and no state to reconcile: a
 * phone that has been off for a week asks once and has the current answer.
 *
 * **Nothing is sent.** A `GET` carries a signature and nothing else — not what
 * is on the phone, not what was done with the last agenda. What you did with a
 * suggestion is a separate feature and does not exist yet.
 */

/** Where the machine writes. Fixed rather than configurable: both ends agree on it. */
export const AGENDA_KEY = 'agenda/current.json';

export type AgendaFailure =
  | { readonly kind: 'not-configured' }
  /** Fetched, but this build does not understand the shape. Keep what you had. */
  | { readonly kind: 'too-new' }
  | { readonly kind: 'error'; readonly reason: BackupError['reason']; readonly detail: string };

export type AgendaResult = { readonly ok: true; readonly agenda: Agenda } | ({ readonly ok: false } & AgendaFailure);

function bucketFor(settings: Settings): BucketConfig | null {
  if (
    settings.exchangeBucket.length === 0 ||
    settings.exchangeAccessKeyId.length === 0 ||
    settings.exchangeSecretKey.length === 0 ||
    settings.exchangeKeyHex.length === 0
  ) {
    return null;
  }
  return {
    bucket: settings.exchangeBucket,
    region: settings.exchangeRegion,
    accessKeyId: settings.exchangeAccessKeyId,
    secretAccessKey: settings.exchangeSecretKey,
  };
}

export async function fetchAgenda(settings: Settings): Promise<AgendaResult> {
  const config = bucketFor(settings);
  if (!config) return { ok: false, kind: 'not-configured' };

  const bytes = await getObject(config, AGENDA_KEY, readNow());
  if (!(bytes instanceof Uint8Array)) {
    // A 404 is the ordinary state of a bucket nothing has published to yet
    // rather than a fault, and `getObject` already says so. Both reasons land
    // here on purpose: this screen shows the same thing for "no bucket" and
    // "nothing published", because there is the same nothing to draw. The
    // diagnostics screen is where the two are worth telling apart, and
    // `BackupFailure` keeps them distinct so it can.
    if (bytes.reason === 'not-configured' || bytes.reason === 'not-found') {
      return { ok: false, kind: 'not-configured' };
    }
    return { ok: false, kind: 'error', reason: bytes.reason, detail: bytes.detail };
  }

  let text: string;
  try {
    text = new TextDecoder().decode(unsealWithKey(hexToBytes(settings.exchangeKeyHex), bytes));
  } catch (error) {
    // Wrong key or altered bytes, indistinguishable and not worth guessing
    // between — the same sentence the unseal path itself refuses with.
    return {
      ok: false,
      kind: 'error',
      reason: 'failed',
      detail: error instanceof Error ? error.message : 'unreadable',
    };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return { ok: false, kind: 'error', reason: 'failed', detail: 'the agenda was not readable as JSON' };
  }

  const agenda = readAgenda(parsed);
  // **Refused whole rather than half-read.** A newer writer is a build to
  // install, not a screen to draw badly — so the caller keeps the last agenda it
  // understood and says why.
  if (!agenda) return { ok: false, kind: 'too-new' };

  return { ok: true, agenda };
}
