import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { NoteVoice } from '@/core/day';
import type { Fix } from '@/core/geo';
import { now as readNow } from '@/services/clock';
import { appendFixes } from '@/services/fixBuffer';
import { keepNoteAudio } from '@/services/noteAudio';
import { askPosition } from '@/services/position';
import { holdScreenAwake, releaseScreenAwake } from '@/services/wakefulness';

export interface UseVoiceNote {
  readonly recording: boolean;
  /** Between the stop and the file being written. Both count as busy. */
  readonly saving: boolean;
  readonly elapsedMs: number;
  /** Begin. Deliberately separate from `stop`: see `RecordButton`. */
  readonly start: () => void;
  readonly stop: () => void;
}

/**
 * Saying a note instead of typing it.
 *
 * **It writes a note's recording, not a capture**, and that is the change this
 * hook exists to carry. A voice note used to go to the media store: sealed
 * beside the photographs, listed in the gallery, counted as something the
 * camera produced. It is a diary entry — the same thing as the paragraph in the
 * field above it, said rather than typed — so the bytes go to
 * `services/noteAudio.ts` and the result is handed back for the sheet to attach
 * to whatever is being written. Nothing is stored until the note is saved,
 * which is what makes recording and typing genuinely interchangeable rather
 * than two features that happen to sit near each other.
 *
 * `start` and `stop` are separate rather than one `toggle`, and they stayed
 * that way after the hold was withdrawn: the caller decides which of the two a
 * press means from state it already renders, so the hook never has to guess
 * whether a press arriving mid-save was meant to start or to stop.
 *
 * **`stop` flips `recording` to false before its first `await`.** The button
 * reverts in the same tick as the press and the file is written behind it —
 * a control that waits for a file system before admitting it was pressed is a
 * control people press twice.
 *
 * Two things survive from the camera screen this came off, and they are the two
 * that were hard-won:
 *
 * **The position is read at the start and kept in a ref.** `stop` resolves in a
 * closure created before the reading arrived, so as state it would be null then
 * and null for ever after — asked for, received, and dropped one render away.
 * A minute of talking while walking would otherwise be stamped wherever you
 * finished, which is the one place it definitely was not started.
 *
 * **The screen is held awake, saving included.** Nothing about recording counts
 * as user activity, so a phone put down mid-note looks to the auto-lock timer
 * exactly like a phone left alone — reported from a device as a clip cut off
 * half a minute in. The hold is keyed on busy rather than on recording:
 * dropping it between stopping and saving would release it precisely where the
 * phone would lock.
 */
export function useVoiceNote(onRecorded: (voice: NoteVoice) => void): UseVoiceNote {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  // Fed by a timer rather than read during render: a clock read in render does
  // not advance on its own, and what the render depends on lives in state here
  // by rule.
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtPosition = useRef<Fix | null>(null);

  /**
   * The caller's handler, held rather than closed over.
   *
   * The sheet passes a fresh function every render — it sets its draft state —
   * and `stop` runs inside a promise chain begun before that render existed.
   * Through a dependency it would be the handler from whenever recording began;
   * through a ref it is the current one, which is the only one whose draft is
   * the draft on screen.
   */
  const handler = useRef(onRecorded);
  useEffect(() => {
    handler.current = onRecorded;
  }, [onRecorded]);

  const busy = recording || saving;

  useEffect(() => {
    if (!busy) return;
    void holdScreenAwake();
    return () => {
      void releaseScreenAwake();
    };
  }, [busy]);

  useEffect(() => {
    if (since === null) return;
    const timer = setInterval(() => setElapsedMs(readNow() - since), 250);
    return () => clearInterval(timer);
  }, [since]);

  const start = useCallback(() => {
    void (async () => {
      if (recording || saving) return;

      try {
        // Asked on first use rather than at launch: a permission prompt is a
        // question, and asking it before anybody has pressed anything is the
        // app asking on its own behalf.
        const granted = await AudioModule.requestRecordingPermissionsAsync();
        if (!granted.granted) return;
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });

        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch (error) {
        console.warn('Could not start the voice note', error);
        return;
      }

      setElapsedMs(0);
      setSince(readNow());
      setRecording(true);
      startedAtPosition.current = null;
      // Not awaited: recording starts now, and a reading that takes a moment
      // must not be the thing standing between the button and the microphone.
      void askPosition().then((at) => {
        startedAtPosition.current = at;
      });
    })();
  }, [recorder, recording, saving]);

  const stop = useCallback(() => {
    void (async () => {
      if (!recording) return;

      setRecording(false);
      setSaving(true);
      const startedAt = since ?? readNow();
      const at = startedAtPosition.current;

      try {
        await recorder.stop();
        const kept = recorder.uri ? keepNoteAudio(recorder.uri, startedAt) : null;
        if (kept) {
          // The same reading in two places, as a capture does it: on the note,
          // where it survives the fixes being pruned and tracking having been
          // off; and in the fix stream, so a note spoken during a stationary
          // afternoon leaves a mark on the day rather than none.
          if (at) await appendFixes([at]);
          handler.current({
            ...kept,
            durationMs: readNow() - startedAt,
            at: at ? { lat: at.lat, lon: at.lon } : null,
          });
        }
      } catch (error) {
        console.warn('Could not keep the voice note', error);
      } finally {
        // **Recording mode is given back, and this matters more than it used to.**
        // An iOS session with `allowsRecording` still true routes playback to the
        // receiver rather than the speaker, so the recording plays back faintly
        // as if held to an ear. It was survivable while playback happened in
        // another tab; now the player is in the same sheet, a tap away from the
        // button that just finished, so the quiet playback would be the normal
        // case rather than an edge one.
        try {
          await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: false });
        } catch (error) {
          console.warn('Could not release recording mode', error);
        }
        setSaving(false);
        setSince(null);
        setElapsedMs(0);
        startedAtPosition.current = null;
      }
    })();
  }, [recorder, recording, since]);

  return { recording, saving, elapsedMs, start, stop };
}
