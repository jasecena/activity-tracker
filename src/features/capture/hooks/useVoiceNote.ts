import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useCallback, useEffect, useRef, useState } from 'react';

import type { Fix } from '@/core/geo';
import { now as readNow } from '@/services/clock';
import { askPosition } from '@/services/position';
import { holdScreenAwake, releaseScreenAwake } from '@/services/wakefulness';

import type { UseMedia } from './useMedia';

export interface UseVoiceNote {
  readonly recording: boolean;
  /** Between the stop and the file being written. Both count as busy. */
  readonly saving: boolean;
  readonly elapsedMs: number;
  readonly toggle: () => void;
}

/**
 * A voice note, recorded from wherever the button is.
 *
 * Lifted out of `CaptureScreen` rather than copied: it now runs from the Day
 * screen, beside the note button, because saying something aloud about a day
 * and writing it down are the same act with different hands. The camera tab has
 * no claim on it — a voice note has no viewfinder, and putting it behind one
 * meant opening a camera, ignoring the picture, and finding a third mode.
 *
 * Everything here is the behaviour the camera screen already had, and the
 * reasons it had it survive the move:
 *
 * **The position is read at the start and kept in a ref.** `stop` resolves in a
 * closure created before the reading arrived, so as state it would be null then
 * and null for ever after — asked for, received, and dropped one render away.
 * A minute of talking while walking would otherwise be stamped wherever you
 * finished, which is the one place it definitely was not started.
 *
 * **The screen is held awake, sealing included.** Nothing about recording
 * counts as user activity, so a phone put down mid-note looks to the auto-lock
 * timer exactly like a phone left alone — reported from a device as a clip cut
 * off half a minute in. The hold is keyed on busy rather than on recording:
 * dropping it between stopping and saving would release it precisely where the
 * phone would lock.
 */
export function useVoiceNote(media: UseMedia): UseVoiceNote {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [recording, setRecording] = useState(false);
  const [saving, setSaving] = useState(false);
  const [since, setSince] = useState<number | null>(null);
  // Fed by a timer rather than read during render: a clock read in render does
  // not advance on its own, and what the render depends on lives in state here
  // by rule.
  const [elapsedMs, setElapsedMs] = useState(0);
  const startedAtPosition = useRef<Fix | null>(null);

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

  const toggle = useCallback(() => {
    void (async () => {
      if (recording) {
        setRecording(false);
        setSaving(true);
        const startedAt = since ?? readNow();
        try {
          await recorder.stop();
          if (recorder.uri) {
            // Null orientation: a voice note has no picture, so which way the
            // phone was held is a fact about nothing.
            await media.keep(recorder.uri, 'audio', {
              durationMs: readNow() - startedAt,
              at: startedAtPosition.current,
              orientation: null,
            });
          }
        } catch (error) {
          console.warn('Could not keep the voice note', error);
        } finally {
          setSaving(false);
          setSince(null);
          setElapsedMs(0);
          startedAtPosition.current = null;
        }
        return;
      }

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
  }, [media, recorder, recording, since]);

  return { recording, saving, elapsedMs, toggle };
}
