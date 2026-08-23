import { bytesToHex, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import { sha256 } from '@noble/hashes/sha2.js';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import type { DayNote } from '@/core/day';
import { planKey, planPayload, plansToSend, plansWaiting, planToTranscribe } from '@/core/plans';
import { sealObject } from '@/services/backup';
import { putObject, type BackupError, type BucketConfig } from '@/services/backup/s3';
import { now as readNow } from '@/services/clock';
import { noteAudioUri } from '@/services/noteAudio';
import type { Settings } from '@/services/settings';
import { transcribe, type TranscriptionFailure } from '@/services/transcribe';
import { readJson, STORAGE_KEYS, writeJson } from '@/services/storage';

/**
 * Sending plans to the bucket, and fetching the words for the spoken ones.
 *
 * **This is the one thing in the app that happens on its own**, and the rule it
 * bends is worth stating rather than burying. Every other request is a press:
 * a map is drawn while you look at one, a recording is transcribed when you
 * press Transcribe, the backup goes when you press Back up. This runs by itself
 * whenever a plan exists that is not up there yet.
 *
 * What holds the line is that it is still *your* press that makes the thing it
 * sends. The switch is off until a bucket is configured, nothing already on the
 * phone is swept into it, and only entries filed under Plans are eligible — a
 * diary entry is never a candidate, however it was written. Settings says all of
 * this in its own words.
 *
 * **Only the words go.** A plan's recording stays here: already swept, already
 * spared by retention, already in the ordinary backup, and the thing reading the
 * bucket reads text.
 *
 * Two passes rather than one loop, and the order matters:
 *
 * 1. **A plan that was spoken has its words fetched**, one per pass, because
 *    the transcript is written back onto the note and every writer in this app
 *    reads its list out of the closure it was built in — a loop would write each
 *    result over the same snapshot and keep only the last. Writing one lets the
 *    list change, which brings this effect round again for the next.
 * 2. **Everything with words is uploaded**, oldest first. That loop is safe
 *    because it writes no notes.
 *
 * Nothing is ever lost by a failure. The note is saved long before any of this
 * starts, a failed transcription is not marked done, a failed upload is not
 * recorded as sent, and both are simply tried again the next time the list
 * changes or the app opens.
 */

export type PlanSyncTrouble = TranscriptionFailure | BackupError['reason'];

export interface PlanSyncState {
  /** Plans not in the bucket yet, including those still waiting on a transcript. */
  readonly waiting: number;
  /** True while a request is in flight, so a screen can say so. */
  readonly busy: boolean;
  /**
   * What went wrong last, and what the other end said about it.
   *
   * Held for the screen and never logged, exactly as the transcription error is:
   * `console` output is swept into a sysdiagnose and leaves the sandbox, and a
   * queue that fails silently is the complaint that error already answered.
   */
  readonly trouble: { readonly reason: PlanSyncTrouble; readonly detail: string } | null;
}

interface PlanSyncRecord {
  /** Note ids whose recording has been asked about, successfully or not worth retrying. */
  readonly transcribed: Record<string, true>;
  /** Object key to a fingerprint of what was sent under it. */
  readonly sent: Record<string, string>;
}

const EMPTY: PlanSyncRecord = { transcribed: {}, sent: {} };

interface UsePlanSyncInput {
  readonly notes: readonly DayNote[];
  /** False until the diary has actually been read — an empty list means neither. */
  readonly ready: boolean;
  readonly settings: Settings;
  /** Put the spoken words on the note. `appendTranscript`, through the store. */
  readonly onTranscript: (note: DayNote, text: string) => void;
}

function bucketFor(settings: Settings): BucketConfig | null {
  if (
    settings.backupBucket.length === 0 ||
    settings.backupAccessKeyId.length === 0 ||
    settings.backupSecretKey.length === 0 ||
    settings.backupKeyHex.length === 0
  ) {
    return null;
  }
  return {
    bucket: settings.backupBucket,
    region: settings.backupRegion,
    accessKeyId: settings.backupAccessKeyId,
    secretAccessKey: settings.backupSecretKey,
  };
}

export function usePlanSync({ notes, ready, settings, onTranscript }: UsePlanSyncInput): PlanSyncState {
  const [record, setRecord] = useState<PlanSyncRecord>(EMPTY);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [trouble, setTrouble] = useState<PlanSyncState['trouble']>(null);

  // One pass at a time. Two overlapping runs would send the same plan twice and
  // race the record of what went — the same guard `useBackup` takes.
  const running = useRef(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const stored = await readJson<PlanSyncRecord>(STORAGE_KEYS.planSync);
      if (!live) return;
      setRecord({ transcribed: stored?.transcribed ?? {}, sent: stored?.sent ?? {} });
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
   * recording changed is sent again. Sliced because a collision here costs a
   * re-upload of one small object, not a wrong answer.
   */
  const fingerprintOf = useCallback(
    (note: DayNote) => bytesToHex(sha256(utf8ToBytes(JSON.stringify(planPayload(note))))).slice(0, 32),
    [],
  );

  const waiting = useMemo(
    () => (loaded ? plansWaiting(notes, record.sent, fingerprintOf) : 0),
    [loaded, notes, record.sent, fingerprintOf],
  );

  useEffect(() => {
    if (!ready || !loaded || running.current) return;

    const config = bucketFor(settings);
    if (!config) return;

    const speak = planToTranscribe(notes, record.transcribed);
    const toSend = plansToSend(notes, record.sent, fingerprintOf);
    if (!speak && toSend.length === 0) return;

    running.current = true;

    void (async () => {
      // Inside the async body rather than beside the ref above it:
      // `react-hooks/set-state-in-effect` is an error in this project, and a
      // synchronous set here is exactly the cascading render it is about. The
      // ref is what actually guards re-entry, and a ref is not state.
      setBusy(true);
      try {
        if (speak) {
          // **No key, no transcription, and no pretending otherwise.** An empty
          // key is the only gate on the feature, exactly as it is for the
          // button; a spoken plan simply waits, and the count says so.
          if (settings.transcriptionKey.length === 0) return;

          // A recording whose file the store cannot name is one this app never
          // wrote — `isStoredFileName`'s rule, reached from the other side. It
          // is marked below rather than retried, or it holds up the queue for
          // ever behind a file that is not coming back.
          const uri = speak.voice ? noteAudioUri(speak.voice.fileName) : null;
          const result = uri
            ? await transcribe({
                uri,
                apiKey: settings.transcriptionKey,
                languageCode: settings.transcriptionLanguage,
              })
            : ({ ok: false, reason: 'no-audio' } as const);

          if (result.ok) {
            onTranscript(speak, result.text);
          } else if (result.reason === 'silent' || result.reason === 'no-audio' || result.reason === 'no-key') {
            // Nothing was said, or there is nothing to send it. Asking again
            // would be asking for ever, so this counts as answered — the plan
            // keeps whatever was typed and stops holding up the queue.
            setTrouble({ reason: result.reason, detail: result.detail ?? '' });
          } else {
            // Reachable, refused or timed out: worth another go when the list
            // next changes. Not marked, so it stays a candidate.
            setTrouble({ reason: result.reason, detail: result.detail ?? '' });
            return;
          }

          const next: PlanSyncRecord = {
            ...record,
            transcribed: { ...record.transcribed, [speak.id]: true },
          };
          await writeJson(STORAGE_KEYS.planSync, next);
          setRecord(next);
          // Round again for the next one, and for the upload of this one's
          // words — the list has changed, so the effect is about to re-run.
          return;
        }

        const sent = { ...record.sent };
        // **Only written when something actually changed.** `record` is a
        // dependency of this effect, so setting it to a fresh object that says
        // the same thing re-runs the effect, which re-sends, which sets it
        // again — a failed upload becomes an infinite loop hammering the bucket.
        // Found by a test suite that never finished.
        let changed = false;
        for (const plan of toSend) {
          const bytes = utf8ToBytes(JSON.stringify(planPayload(plan)));
          // Always STANDARD: Glacier bills a 128 KB minimum per object and a
          // plan is a few hundred bytes, so the cold class would charge forty
          // times the size for a saving that does not exist.
          const failure = await putObject(
            config,
            planKey(plan.id),
            sealObject(hexToBytes(settings.backupKeyHex), bytes),
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

        if (!changed) return;
        const next: PlanSyncRecord = { ...record, sent };
        await writeJson(STORAGE_KEYS.planSync, next);
        setRecord(next);
      } catch (error) {
        setTrouble({ reason: 'failed', detail: error instanceof Error ? error.message : String(error) });
      } finally {
        running.current = false;
        setBusy(false);
      }
    })();
  }, [ready, loaded, notes, settings, record, fingerprintOf, onTranscript]);

  return { waiting, busy, trouble };
}
