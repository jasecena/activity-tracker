import { manifestBytes, MANIFEST_KEY } from '@/services/backup/manifest';
import { getObject, listKeys, putObject, type BackupError, type BucketConfig } from '@/services/backup/s3';
import { AGENDA_KEY } from '@/services/agenda';
import { now as readNow } from '@/services/clock';
import type { Settings } from '@/services/settings';

/**
 * Asking each integration whether it actually works, and saying what it said.
 *
 * **This exists because one of the three had no press behind it.** A backup is
 * a button and a transcription is a button, so a broken one says so the moment
 * you try it. Plans go on their own — `usePlanSync` is the one automatic thing
 * in the app — and an automatic thing that fails has nowhere to put the news:
 * the queue count goes up, the screen says "still to send", and every
 * explanation from "no passphrase" to "the secret key has a typo in it" looks
 * identical from the outside. That is the gap these checks close.
 *
 * Three rules hold them to the same standard as the rest of the app.
 *
 * **Nothing is sent that the app would not send anyway.** The plans check writes
 * `manifest.json`, which is the first thing a real sync writes and is byte-for-byte
 * what it would write — so a passing check has left the bucket in exactly the
 * state a passing sync would. The transcription check sends no audio at all; see
 * `checkTranscription` for why that is not a compromise. Nothing here invents a
 * request with no counterpart in ordinary use.
 *
 * **The other end's own words go on the screen.** A reason is for the ordinary
 * case; the detail line is for the case where the ordinary sentence is not
 * enough to act on — which is exactly when a phone with no server log, no crash
 * reporter and no telemetry has nothing else to offer. `transcribe` learned this
 * the expensive way and says so at length.
 *
 * **On the screen, never in a log.** These results name buckets and quote
 * services; `console` output is swept into a sysdiagnose and leaves the sandbox.
 * They are held for the life of the screen and thrown away with it.
 */

/** Whether a check ran, and how it came out. */
export type CheckStatus =
  /** It worked. */
  | 'ok'
  /** Not configured, so there was nothing to test. Not a failure. */
  | 'off'
  /** It was tried and it did not work. */
  | 'failed';

export interface CheckResult {
  /** Stable across runs, so the list does not reorder while it fills in. */
  readonly id: CheckId;
  readonly title: string;
  readonly status: CheckStatus;
  /** One line, in the terms of the thing being tested. */
  readonly summary: string;
  /** What the other end actually said. Absent when nothing was asked. */
  readonly detail?: string;
}

export type CheckId = 'transcription' | 'backup' | 'plans-write' | 'plans-read';

/**
 * The name of each check, in one place.
 *
 * Read both by the check itself and by the line that says which one is in
 * flight. Two copies of a title is how a screen ends up saying it is running
 * "Plans bucket" and then reporting on "Plans bucket — sending", which reads as
 * two different things having happened.
 */
export const CHECK_TITLES: Readonly<Record<CheckId, string>> = {
  transcription: 'Transcription — ElevenLabs',
  backup: 'Backup bucket',
  'plans-write': 'Plans bucket — sending',
  'plans-read': 'Plans bucket — the agenda',
};

/** How much of a service's answer is worth putting on a phone screen. */
const DETAIL_LIMIT = 400;

function clipped(text: string): string {
  const trimmed = text.trim();
  return trimmed.length > DETAIL_LIMIT ? `${trimmed.slice(0, DETAIL_LIMIT)}…` : trimmed;
}

/**
 * The sentence for a bucket failure, in terms of what to go and change.
 *
 * A reason code on its own reads as an apology. `unauthorized` on a bucket
 * almost always means one of two specific typos, and saying which two is the
 * difference between a fix and an afternoon.
 */
function bucketSentence(error: BackupError): string {
  switch (error.reason) {
    case 'unauthorized':
      return 'The bucket refused the credentials — check the access key id and secret key, and that this user has the policy for this bucket.';
    case 'no-such-bucket':
      return 'No such bucket in that region — check the bucket name and the region.';
    case 'unreachable':
      return 'The request could not be completed. No answer either way about whether it left the phone.';
    case 'timeout':
      return 'It reached the service and nothing came back in time.';
    case 'not-found':
      return 'Signed and accepted, and there is nothing at that key yet.';
    case 'not-configured':
      return 'Not configured.';
    case 'failed':
      return 'The bucket answered, and not with anything this understands.';
  }
}

const ELEVENLABS_SUBSCRIPTION = 'https://api.elevenlabs.io/v1/user/subscription';

/** Long enough for a phone on a slow connection, short enough to stop being "still going". */
const TIMEOUT_MS = 30_000;

function abortAfter(ms: number): { signal: AbortSignal; done: () => void } {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, done: () => clearTimeout(timer) };
}

function threwAs(error: unknown, aborted: boolean): { summary: string; detail: string } {
  const named = error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return {
    summary: aborted
      ? 'It reached the service and nothing came back in time.'
      : // Deliberately not "nothing was sent": a thrown fetch cannot tell a
        // request that never left the device from one whose reply was lost, and
        // this app does not print unverifiable claims about that. `transcribe`
        // makes the same distinction for the same reason.
        'The request could not be completed.',
    detail: clipped(named),
  };
}

/**
 * Is the ElevenLabs key good, without sending a recording.
 *
 * **No audio leaves the phone for this**, and that is a requirement rather than
 * an optimisation. `transcribe` is the only thing in the app that sends a
 * recording and its first rule is that nothing happens without a press on the
 * note it belongs to. A diagnostic that quietly uploaded a voice note to prove
 * the key works would break that rule in the one screen whose whole job is
 * telling the truth about what leaves.
 *
 * So it asks the account endpoint instead, which authenticates with the same
 * `xi-api-key` header the transcription uses. That proves the three things worth
 * proving — the key is real, the service is reachable, the account is live — and
 * it also reads back the quota, which is worth having: ElevenLabs answers a
 * spent quota with a 401, indistinguishable at the transcription endpoint from a
 * key that was never valid. A check that says how many characters are left
 * answers that question before it gets asked.
 *
 * What it cannot prove is that the *model* accepts a given recording — a 422 on
 * a bad `language_code` or an unreadable file is still only findable by
 * transcribing. That is stated on the screen rather than papered over.
 */
export async function checkTranscription(settings: Settings): Promise<CheckResult> {
  const base = { id: 'transcription', title: CHECK_TITLES['transcription'] } as const;
  const key = settings.transcriptionKey.trim();
  if (key.length === 0) {
    return { ...base, status: 'off', summary: 'No key, so transcription is off. Nothing was sent.' };
  }

  const { signal, done } = abortAfter(TIMEOUT_MS);
  try {
    const response = await fetch(ELEVENLABS_SUBSCRIPTION, { headers: { 'xi-api-key': key }, signal });
    if (!response.ok) {
      const body = await response.text().catch(() => '');
      const summary =
        response.status === 401 || response.status === 403
          ? 'The key was refused. Either it is wrong or the account has no credit left — ElevenLabs answers both with a 401.'
          : response.status === 429
            ? 'Rate limited. The key is good; there have been too many requests.'
            : 'ElevenLabs answered, and not with anything this understands.';
      return { ...base, status: 'failed', summary, detail: clipped(`HTTP ${response.status} — ${body}`) };
    }

    const body: unknown = await response.json().catch(() => null);
    const quota =
      typeof body === 'object' && body !== null
        ? (body as { character_count?: unknown; character_limit?: unknown })
        : {};
    const used = typeof quota.character_count === 'number' ? quota.character_count : null;
    const limit = typeof quota.character_limit === 'number' ? quota.character_limit : null;
    const left =
      used !== null && limit !== null
        ? `${(limit - used).toLocaleString()} of ${limit.toLocaleString()} characters left.`
        : 'The account answered.';

    return {
      ...base,
      status: 'ok',
      summary: `The key works. ${left}`,
      // Said plainly rather than left for somebody to discover: a good key is
      // not the same claim as a recording this model will accept.
      detail:
        'No audio was sent. This proves the key and the account, not that a particular recording will transcribe.',
    };
  } catch (error) {
    const { summary, detail } = threwAs(error, signal.aborted);
    return { ...base, status: 'failed', summary, detail };
  } finally {
    done();
  }
}

function backupConfig(settings: Settings): BucketConfig | null {
  if (settings.backupBucket.length === 0 || settings.backupAccessKeyId.length === 0) return null;
  if (settings.backupSecretKey.length === 0) return null;
  return {
    bucket: settings.backupBucket,
    region: settings.backupRegion,
    accessKeyId: settings.backupAccessKeyId,
    secretAccessKey: settings.backupSecretKey,
  };
}

function exchangeConfig(settings: Settings): BucketConfig | null {
  if (settings.exchangeBucket.length === 0 || settings.exchangeAccessKeyId.length === 0) return null;
  if (settings.exchangeSecretKey.length === 0) return null;
  return {
    bucket: settings.exchangeBucket,
    region: settings.exchangeRegion,
    accessKeyId: settings.exchangeAccessKeyId,
    secretAccessKey: settings.exchangeSecretKey,
  };
}

/**
 * Which of the fields a bucket needs are still empty.
 *
 * **Named one by one rather than counted**, because "not configured" is the
 * message that wasted the evening this screen was written after. A phone with
 * three of four fields filled in behaves exactly like one with none — the
 * config builder returns null either way and the sync returns before doing
 * anything — and the person looking at it can see four boxes with text in three
 * of them.
 */
function missingFields(settings: Settings, which: 'backup' | 'exchange'): readonly string[] {
  const fields =
    which === 'backup'
      ? ([
          ['bucket', settings.backupBucket],
          ['access key id', settings.backupAccessKeyId],
          ['secret key', settings.backupSecretKey],
          ['passphrase', settings.backupKeyHex],
        ] as const)
      : ([
          ['bucket', settings.exchangeBucket],
          ['access key id', settings.exchangeAccessKeyId],
          ['secret key', settings.exchangeSecretKey],
          ['passphrase', settings.exchangeKeyHex],
        ] as const);
  return fields.filter(([, value]) => value.length === 0).map(([name]) => name);
}

function absent(missing: readonly string[]): string {
  return missing.length === 1
    ? `No ${missing[0]} set.`
    : `No ${missing.slice(0, -1).join(', ')} or ${missing.at(-1)} set.`;
}

/**
 * Can the phone reach the backup bucket.
 *
 * `listKeys` rather than a write, because listing is the one read the phone is
 * allowed and it changes nothing. It exercises everything a backup depends on —
 * the signature, the region, the credential, the bucket policy — and answers
 * with how many objects are already up there, which is the number somebody
 * actually wants to see.
 */
export async function checkBackupBucket(settings: Settings): Promise<CheckResult> {
  const base = { id: 'backup', title: CHECK_TITLES['backup'] } as const;
  const missing = missingFields(settings, 'backup');
  const config = backupConfig(settings);
  if (!config) {
    return { ...base, status: 'off', summary: `${absent(missing)} Nothing is backed up.` };
  }

  const result = await listKeys(config, readNow());
  if (!Array.isArray(result)) {
    const error = result as BackupError;
    return { ...base, status: 'failed', summary: bucketSentence(error), detail: clipped(error.detail) };
  }

  const count = result.length;
  const objects = count === 1 ? '1 object' : `${count.toLocaleString()} objects`;
  // A reachable bucket and an unusable one: with no passphrase there is no key
  // to seal with, so `configFrom` refuses and the button stays inert. Worth
  // saying here rather than letting a green tick imply a working backup.
  if (settings.backupKeyHex.length === 0) {
    return {
      ...base,
      status: 'failed',
      summary: `The bucket works and holds ${objects}, but no backup passphrase is set, so nothing can be sealed or sent.`,
    };
  }
  return { ...base, status: 'ok', summary: `Signed, listed, and holding ${objects}.` };
}

/**
 * Can the phone write to the plans bucket.
 *
 * **It writes the real manifest**, the same bytes `usePlanSync` writes before
 * the first plan of a run, to the same key. That is deliberate on three counts:
 * the exchange policy permits `plans/*` and `manifest.json` and nothing else, so
 * a made-up diagnostic key would come back 403 and prove nothing; writing junk
 * under `plans/` would put a row in front of the machine at home that means
 * nothing and would never be corrected; and the manifest is idempotent, so a
 * check that passes has left the bucket exactly as a sync that passes would —
 * including publishing the salt, if it had not been published yet.
 *
 * In other words the successful case of this check is not a simulation of the
 * first step of a sync. It **is** the first step of a sync.
 */
export async function checkPlansWrite(settings: Settings): Promise<CheckResult> {
  const base = { id: 'plans-write', title: CHECK_TITLES['plans-write'] } as const;
  const missing = missingFields(settings, 'exchange');
  const config = exchangeConfig(settings);
  if (!config) {
    return { ...base, status: 'off', summary: `${absent(missing)} Plans stay on this phone.` };
  }
  // The passphrase is not part of `exchangeConfig` — a bucket can be reached
  // without one — but it is what `usePlanSync` gates on, so a bucket with no
  // passphrase is a sync that will never run however well the credentials work.
  if (settings.exchangeKeyHex.length === 0 || settings.exchangeSaltHex.length === 0) {
    return {
      ...base,
      status: 'off',
      summary:
        'No plans passphrase set. The credentials may be fine, but nothing can be sealed, so no plan is ever sent and no error is ever raised.',
    };
  }

  const failure = await putObject(config, MANIFEST_KEY, manifestBytes(settings.exchangeSaltHex), 'STANDARD', readNow());
  if (failure) {
    return { ...base, status: 'failed', summary: bucketSentence(failure), detail: clipped(failure.detail) };
  }
  return {
    ...base,
    status: 'ok',
    summary: `Wrote ${MANIFEST_KEY}. Sending a plan takes the same signature and the same permission, so plans can go.`,
  };
}

/**
 * Can the phone read the agenda back.
 *
 * **A 404 is a pass**, and saying so is most of the point of this check. The
 * agenda is written by a computer in somebody's house that may never have run
 * yet; a bucket that answers "no such key" has accepted the signature, matched
 * the credential and applied the policy, which is everything the read path
 * needs. It used to be impossible to see that from inside the app — `getObject`
 * reported a 404 as `not-configured`, the same answer a phone with no
 * credentials gives — and `BackupFailure` now keeps the two apart precisely so
 * this line can be written.
 */
export async function checkPlansRead(settings: Settings): Promise<CheckResult> {
  const base = { id: 'plans-read', title: CHECK_TITLES['plans-read'] } as const;
  const config = exchangeConfig(settings);
  if (!config) {
    return { ...base, status: 'off', summary: 'No plans bucket set, so there is no agenda to read.' };
  }

  const result = await getObject(config, AGENDA_KEY, readNow());
  if (result instanceof Uint8Array) {
    const bytes = result.length === 1 ? '1 byte' : `${result.length.toLocaleString()} bytes`;
    return { ...base, status: 'ok', summary: `Read ${AGENDA_KEY} — ${bytes}. The machine at home has published.` };
  }

  const error = result as BackupError;
  if (error.reason === 'not-found') {
    return {
      ...base,
      status: 'ok',
      summary: `Signed and accepted, and nothing has been published to ${AGENDA_KEY} yet. That is the ordinary state until the machine at home runs.`,
    };
  }
  return { ...base, status: 'failed', summary: bucketSentence(error), detail: clipped(error.detail) };
}

/** The checks, in the order they are shown and run. */
export const CHECKS: readonly {
  readonly id: CheckId;
  readonly run: (settings: Settings) => Promise<CheckResult>;
}[] = [
  { id: 'transcription', run: checkTranscription },
  { id: 'backup', run: checkBackupBucket },
  { id: 'plans-write', run: checkPlansWrite },
  { id: 'plans-read', run: checkPlansRead },
];
