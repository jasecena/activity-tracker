import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { File } from 'expo-file-system';
import { useCallback, useEffect, useRef, useState } from 'react';

import { backupObjects, type BackupObject } from '@/core/backup';
import type { DayGroup, DayNote } from '@/core/day';
import { KDF, sealObject } from '@/services/backup';
import { listKeys, putObject, type BackupError, type BucketConfig } from '@/services/backup/s3';
import { now as readNow, tzOffsetMinutes } from '@/services/clock';
import { noteAudioUri } from '@/services/noteAudio';
import type { Settings } from '@/services/settings';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';
import { holdScreenAwake, releaseScreenAwake } from '@/services/wakefulness';

/**
 * Sending the days that are over to the bucket.
 *
 * **Nothing here happens on its own.** No queue, no retry, no launch hook — the
 * one entry point is a press, which is what keeps the enumerable-requests rule
 * true now that this app can talk to a third place. A note written after a
 * backup is not in the bucket until the button is pressed again, and the screen
 * says so rather than implying otherwise.
 *
 * **The record of what has gone up is a hash per key.** Not a timestamp and not
 * a flag: a day whose notes changed has to be uploaded again, and only the bytes
 * know that. Comparing hashes is also what makes pressing the button twice cost
 * nothing, which matters because pressing it twice is the documented way to
 * catch up.
 */

export type BackupStage = 'idle' | 'listing' | 'uploading' | 'done' | 'failed';

export interface BackupProgress {
  readonly stage: BackupStage;
  /** Objects sent this run. */
  readonly sent: number;
  /** Objects this run intends to send. */
  readonly total: number;
  readonly error: BackupError | null;
}

export interface UseBackup {
  readonly progress: BackupProgress;
  /** Keys known to be in the bucket, for the counts and the retention warning. */
  readonly uploaded: ReadonlySet<string>;
  readonly ready: boolean;
  readonly run: (days: readonly DayGroup[], notes: readonly DayNote[]) => Promise<void>;
}

/** Below this an object stays Standard: the cold classes bill a minimum size. */
const COLD_ABOVE_BYTES = 128 * 1024;

const IDLE: BackupProgress = { stage: 'idle', sent: 0, total: 0, error: null };

/** What the bucket is told about itself, in plaintext, so a laptop can derive the key. */
function manifestFor(settings: Settings): Uint8Array {
  return utf8ToBytes(JSON.stringify({ version: 1, salt: settings.backupSaltHex, kdf: KDF }, null, 2));
}

export function configFrom(settings: Settings): BucketConfig | null {
  if (settings.backupBucket.length === 0 || settings.backupAccessKeyId.length === 0) return null;
  if (settings.backupSecretKey.length === 0 || settings.backupKeyHex.length === 0) return null;
  return {
    bucket: settings.backupBucket,
    region: settings.backupRegion,
    accessKeyId: settings.backupAccessKeyId,
    secretAccessKey: settings.backupSecretKey,
  };
}

export function useBackup(settings: Settings): UseBackup {
  const [progress, setProgress] = useState<BackupProgress>(IDLE);
  const [sent, setSent] = useState<Record<string, string>>({});
  const [ready, setReady] = useState(false);
  const running = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = await readJson<Record<string, string>>(STORAGE_KEYS.backupLog);
      if (live) {
        setSent(stored && typeof stored === 'object' ? stored : {});
        setReady(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  const run = useCallback(
    async (days: readonly DayGroup[], notes: readonly DayNote[]) => {
      const config = configFrom(settings);
      if (!config) {
        setProgress({ stage: 'failed', sent: 0, total: 0, error: { reason: 'not-configured', detail: '' } });
        return;
      }
      // A second press while the first is still going would upload everything
      // twice and race the record of what went.
      if (running.current) return;
      running.current = true;

      const backupKey = hexToBytes(settings.backupKeyHex);
      // Sealing and uploading is not "user activity", so a long run on a quiet
      // screen looks to the auto-lock timer exactly like a phone left alone —
      // the same reason a recording holds it.
      await holdScreenAwake();

      try {
        setProgress({ stage: 'listing', sent: 0, total: 0, error: null });

        // **What is already there, from the bucket rather than from memory.** A
        // reinstalled app has no record and would otherwise send a year of
        // recordings again; the listing reads names and never contents, which
        // is what keeps this one-way.
        const listed = await listKeys(config, readNow());
        if (!Array.isArray(listed)) {
          setProgress({ stage: 'failed', sent: 0, total: 0, error: listed as BackupError });
          return;
        }
        const present = new Set<string>(listed);

        const offset = tzOffsetMinutes();
        const wanted = backupObjects(days, notes, readNow(), offset);

        // The manifest first and every time, because it is small and because a
        // bucket holding objects and no manifest cannot be opened at all.
        const work: { object: BackupObject; bytes: Uint8Array }[] = [];
        for (const object of wanted) {
          const bytes = await bytesFor(object);
          if (!bytes) continue;
          const fingerprint = bytesToHex(sha256(bytes)).slice(0, 32);
          // Unchanged and known to be up there: nothing to do. Both halves
          // matter — the hash catches a day whose notes changed, and the
          // listing catches a phone whose record was lost.
          if (sent[object.key] === fingerprint && present.has(object.key)) continue;
          work.push({ object, bytes });
        }

        setProgress({ stage: 'uploading', sent: 0, total: work.length + 1, error: null });

        const record = { ...sent };
        let done = 0;

        const manifest = manifestFor(settings);
        const manifestFailure = await putObject(config, 'manifest.json', manifest, 'STANDARD', readNow());
        if (manifestFailure) {
          setProgress({ stage: 'failed', sent: 0, total: work.length + 1, error: manifestFailure });
          return;
        }
        done += 1;
        setProgress({ stage: 'uploading', sent: done, total: work.length + 1, error: null });

        for (const { object, bytes } of work) {
          const sealed = sealObject(backupKey, bytes);
          const storageClass = sealed.length > COLD_ABOVE_BYTES ? 'GLACIER_IR' : 'STANDARD';
          const failure = await putObject(config, object.key, sealed, storageClass, readNow());
          if (failure) {
            // Stop, keep what did go, and say what happened. Carrying on past a
            // 403 would be a hundred identical failures and a progress bar
            // finishing on a backup that did not happen.
            await writeJson(STORAGE_KEYS.backupLog, record);
            setSent(record);
            setProgress({ stage: 'failed', sent: done, total: work.length + 1, error: failure });
            return;
          }

          record[object.key] = bytesToHex(sha256(bytes)).slice(0, 32);
          done += 1;
          setProgress({ stage: 'uploading', sent: done, total: work.length + 1, error: null });
        }

        await writeJson(STORAGE_KEYS.backupLog, record);
        setSent(record);
        setProgress({ stage: 'done', sent: done, total: work.length + 1, error: null });
      } finally {
        running.current = false;
        await releaseScreenAwake();
      }
    },
    [sent, settings],
  );

  return { progress, uploaded: new Set(Object.keys(sent)), ready, run };
}

/**
 * The bytes of one object: a day's JSON, or a recording read off disk.
 *
 * A recording whose file has gone — a restored phone, a sweep — is skipped
 * rather than uploaded empty. An empty object in the bucket would look like a
 * successful backup of a recording that no longer exists.
 */
async function bytesFor(object: BackupObject): Promise<Uint8Array | null> {
  if (object.body !== null) return utf8ToBytes(object.body);
  if (!object.fileName) return null;

  const uri = noteAudioUri(object.fileName);
  if (!uri) return null;
  try {
    const file = new File(uri);
    return file.exists ? new Uint8Array(await file.bytes()) : null;
  } catch {
    return null;
  }
}
