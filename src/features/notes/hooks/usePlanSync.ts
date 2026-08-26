import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DayNote } from '@/core/day';
import { planKey, planPayload, plansToSend, plansWaiting } from '@/core/plans';
import { sealObject } from '@/services/backup';
import { manifestBytes, MANIFEST_KEY } from '@/services/backup/manifest';
import { putObject, type BackupError, type BucketConfig } from '@/services/backup/s3';
import { now as readNow } from '@/services/clock';
import type { Settings } from '@/services/settings';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

/**
 * Sending plans to the bucket, when you press Send.
 *
 * **This used to be the one thing in the app that happened on its own, and it is
 * not any more.** It transcribed a spoken plan the moment it saw one and
 * uploaded whatever it got, unattended. Both halves are now a press, and the
 * reason is the same for both: what leaves here does not stop at a bucket. A
 * machine at home reads it, hands it to a model, and writes what the model
 * decided into a database. A transcript nobody read is a wrong commitment
 * nobody asked for, sitting in that database, and the cost of correcting it is
 * far higher than the cost of a button.
 *
 * So the order is now: record, transcribe with the Transcribe button, **read
 * what came back**, edit it if it is wrong, save, then Send. Every one of those
 * is a decision somebody made.
 *
 * What that changes about this file:
 *
 * - **No transcription here at all.** It belongs to the note sheet's button,
 *   which already existed, already shows its own failures and already puts the
 *   words in the draft rather than the store — so they are read before Save
 *   rather than after upload. This hook no longer knows the transcriber exists.
 * - **No effect that fires on a list change.** One callback, one press.
 *
 * What is unchanged, and deliberately: the salt goes up before the first plan,
 * nothing is ever lost by a failure, and a plan is re-sent when its content
 * changes because the record is a fingerprint rather than a flag.
 */

export type PlanSyncTrouble = BackupError['reason'];

export interface PlanSyncState {
  /** Plans not in the bucket yet, including those still waiting on a transcript. */
  readonly waiting: number;
  /** True while a send is in flight, so a screen can say so. */
  readonly busy: boolean;
  /**
   * What went wrong last, and what the other end said about it.
   *
   * Held for the screen and never logged: `console` output is swept into a
   * sysdiagnose and leaves the sandbox.
   */
  readonly trouble: { readonly reason: PlanSyncTrouble; readonly detail: string } | null;
  /** Send everything that has words and is not up there yet. */
  readonly send: () => void;
}

interface PlanSyncRecord {
  /**
   * Object key to a fingerprint of what was sent under it.
   *
   * `transcribed` used to live here too, marking which recordings had been sent
   * to ElevenLabs so the automatic pass would not ask twice. Nothing asks
   * automatically any more, so there is nothing to mark — the button is the
   * record. Old entries are simply ignored rather than migrated away.
   */
  readonly sent: Record<string, string>;
  /**
   * The salt this phone has already published, or absent.
   *
   * Compared against the current one rather than being a boolean, so a bucket
   * that is repointed at a fresh one gets its manifest written again instead of
   * silently keeping the old bucket's.
   */
  readonly manifestSalt?: string;
}

const EMPTY: PlanSyncRecord = { sent: {} };

interface UsePlanSyncInput {
  readonly notes: readonly DayNote[];
  /** False until the diary has actually been read — an empty list means neither. */
  readonly ready: boolean;
  readonly settings: Settings;
}

/**
 * The exchange bucket, or nothing.
 *
 * **Not the backup's bucket, and not the backup's key.** This queue sends to
 * the one place the machine at home can read, and that machine must never be
 * able to reach a journey. `Settings.exchangeBucket` carries the full argument.
 */
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

export { MANIFEST_KEY };

export function usePlanSync({ notes, ready, settings }: UsePlanSyncInput): PlanSyncState {
  const [record, setRecord] = useState<PlanSyncRecord>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<PlanSyncState['trouble']>(null);

  // One send at a time. Two overlapping presses would send the same plan twice
  // and race the record of what went — the same guard `useBackup` takes.
  const running = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = await readJson<PlanSyncRecord>(STORAGE_KEYS.planSync);
      if (!live) return;
      setRecord({ sent: stored?.sent ?? {}, manifestSalt: stored?.manifestSalt });
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, []);

  /**
   * What went under a key last time.
   *
   * The whole payload rather than the words alone, so a plan whose instant or
   * recording changed is sent again — and, now that a transcript is edited
   * before it goes, so is one whose text was corrected after a first send.
   * Sliced because a collision here costs a re-upload of one small object.
   */
  const fingerprintOf = useCallback(
    (note: DayNote) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(planPayload(note))))).slice(0, 32),
    [],
  );

  const waiting = useMemo(
    () => (loaded ? plansWaiting(notes, record.sent, fingerprintOf) : 0),
    [loaded, notes, record.sent, fingerprintOf],
  );

  const send = useCallback(() => {
    if (!ready || !loaded || running.current) return;

    const config = bucketFor(settings);
    if (!config) return;

    const toSend = plansToSend(notes, record.sent, fingerprintOf);
    if (toSend.length === 0) return;

    running.current = true;

    void (async () => {
      setBusy(true);
      try {
        // **The salt goes up before the first plan does.** A sealed plan in a
        // bucket whose manifest is missing is not a plan, it is a receipt: the
        // machine at home has the passphrase but nothing to run it through, and
        // the failure would arrive there rather than here, where it is fixable.
        let published = record.manifestSalt;
        if (settings.exchangeSaltHex.length > 0 && published !== settings.exchangeSaltHex) {
          const failure = await putObject(
            config,
            MANIFEST_KEY,
            manifestBytes(settings.exchangeSaltHex),
            'STANDARD',
            readNow(),
          );
          if (failure) {
            setTrouble(failure);
            return;
          }
          published = settings.exchangeSaltHex;
        }

        const sent = { ...record.sent };
        let changed = false;
        for (const plan of toSend) {
          const bytes = utf8ToBytes(JSON.stringify(planPayload(plan)));
          // Always STANDARD: Glacier bills a 128 KB minimum per object and a
          // plan is a few hundred bytes, so the cold class would charge forty
          // times the size for a saving that does not exist.
          const failure = await putObject(
            config,
            planKey(plan.id),
            sealObject(hexToBytes(settings.exchangeKeyHex), bytes),
            'STANDARD',
            readNow(),
          );
          if (failure) {
            // Stop and keep what did go. Carrying on past a 403 is a hundred
            // identical failures and a queue that looks like it drained.
            setTrouble(failure);
            break;
          }
          sent[planKey(plan.id)] = fingerprintOf(plan);
          changed = true;
          setTrouble(null);
        }

        if (!changed && published === record.manifestSalt) return;
        const next: PlanSyncRecord = { sent, manifestSalt: published };
        await writeJson(STORAGE_KEYS.planSync, next);
        setRecord(next);
      } catch (error) {
        setTrouble({ reason: 'failed', detail: error instanceof Error ? error.message : String(error) });
      } finally {
        running.current = false;
        setBusy(false);
      }
    })();
  }, [ready, loaded, notes, settings, record, fingerprintOf]);

  return { waiting, busy, trouble, send };
}
