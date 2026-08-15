import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Alert } from 'react-native';

import type { NoteVoice } from '@/core/day';
import type { Fix } from '@/core/geo';
import { silenceAudio } from '@/services/audioFocus';
import { now as readNow } from '@/services/clock';
import { appendFixes } from '@/services/fixBuffer';
import { keepNoteAudio } from '@/services/noteAudio';
import { askPosition } from '@/services/position';
import { holdScreenAwake, releaseScreenAwake } from '@/services/wakefulness';

/**
 * The longest a voice note may run, after which it stops itself and says so.
 *
 * **A limit on recording, never on playback, and that distinction is the whole
 * point of the number.** A cap applied where the audio is read back is a silent
 * truncation: you talk for two hours, the app looks like it is listening for
 * two hours, and the loss is discovered afterwards when the recording turns out
 * to be twenty minutes long and the rest was never anywhere. There is no
 * recovering from that — a recording is the one thing in this app nothing can
 * reconstruct, in the same way a note is.
 *
 * So the cap fires at the microphone. The recording stops, everything up to
 * that point is kept and handed back exactly as a pressed stop would hand it
 * back, and a dialog says it happened. The failure becomes something you are
 * told about while you are still in the room, and pressing record again carries
 * on into a second note.
 *
 * Twenty minutes rather than none because a recorder with no ceiling left
 * running by accident is a phone quietly filling its own disk with a pocket —
 * captures are already the only store in the app with no bound on them. It is
 * deliberately far above the video cap: a clip is sixty seconds because forty
 * megabytes a minute of 1080p is the constraint, and voice at this preset is a
 * fraction of that, so the two numbers are answering different questions and
 * should not be tied together.
 *
 * One number for both microphones — the sheet's and the Notes tab's — because
 * they are one question. A cap per button would be two places to change it and
 * one of them eventually stale.
 */
export const MAX_VOICE_MS = 20 * 60_000;

/**
 * Which instance of this hook holds the microphone, or null.
 *
 * **There are two recorders in the app now and they are mounted at once.** One
 * is in the note sheet, under the fields; the other is the microphone on the
 * Notes tab that writes a note on its own. Every tab stays mounted with the
 * inactive ones hidden — deliberate, so a switch cannot throw away a running
 * recording — so both hooks are alive whichever screen is showing, and they are
 * as unaware of each other as the players were before `services/audioFocus.ts`
 * was written. Two of them recording at once is therefore the *default*
 * behaviour rather than an edge case: start the tab's microphone, open a note,
 * press the sheet's, and there is nothing in either to say no.
 *
 * The same shape as the audio focus, for the same reason and one file smaller —
 * this module is already the only thing in the app that touches the recorder,
 * so a second module would be a boundary around one caller. **The holder is
 * identified by an object each instance owns**, which is what makes the release
 * exact: a release that did not check identity would let a finished recording
 * clear a claim belonging to one that had already started.
 */
let holder: object | null = null;

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
export function useVoiceNote(onRecorded: (voice: NoteVoice, startedAt: number) => void): UseVoiceNote {
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  /**
   * This instance's claim on the microphone. Nothing is ever read off it — its
   * identity is the whole value, which is why it is an empty object.
   *
   * A `useMemo` rather than a `useRef`, so there is no ref here for anything to
   * be tempted to read during render. `react-hooks/refs` is an error in this
   * project and the exemption below is narrow on purpose.
   */
  const claim = useMemo(() => ({}), []);
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

  // A recording abandoned by an unmount would otherwise hold the microphone for
  // the rest of the session. Neither of the two ever unmounts today — the shell
  // hides tabs rather than dropping them — which is exactly why this is written
  // down rather than relied upon.
  useEffect(
    () => () => {
      if (holder === claim) holder = null;
    },
    [claim],
  );

  const start = useCallback(() => {
    void (async () => {
      if (recording || saving) return;

      // **Claimed before the permission prompt, not after.** The claim is what
      // makes two microphones one microphone, and everything below it is
      // asynchronous — a prompt, an audio mode, a prepare — so a check that
      // waited for any of them would be a check with a window in it.
      if (holder !== null && holder !== claim) {
        Alert.alert(
          'Something else is recording',
          'A voice note is already being recorded somewhere in the app. Stop that one first, and this will record into its own note.',
        );
        return;
      }
      holder = claim;

      try {
        // Asked on first use rather than at launch: a permission prompt is a
        // question, and asking it before anybody has pressed anything is the
        // app asking on its own behalf.
        const granted = await AudioModule.requestRecordingPermissionsAsync();
        // Given straight back. A refused prompt is not a recording, and a claim
        // left behind by one would lock out the other microphone for good.
        if (!granted.granted) {
          holder = null;
          return;
        }

        // **Nothing else is playing while this records.** Everywhere else in
        // the app the rule is one sound at a time because two at once is a
        // mess; here it is because the microphone would record the other one.
        // After the permission, so a refused prompt does not stop playback for
        // a recording that never starts.
        silenceAudio();
        await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });

        await recorder.prepareToRecordAsync();
        recorder.record();
      } catch (error) {
        console.warn('Could not start the voice note', error);
        holder = null;
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
  }, [claim, recorder, recording, saving]);

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
          // **The start instant travels with it**, so a caller filing a note of
          // its own can date the note to when the talking began rather than to
          // when the file finished being written. The sheet ignores it: there
          // the instant is the pickers' business, and they were seeded before
          // anybody pressed record.
          handler.current(
            {
              ...kept,
              durationMs: readNow() - startedAt,
              at: at ? { lat: at.lat, lon: at.lon } : null,
              // Every recording starts unlocked. Keeping one is a decision its
              // owner makes about a recording that exists, not a default the
              // app applies to one that has just been made.
              locked: false,
            },
            startedAt,
          );
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
        // Only ours, and only if it still is. The identity check is the whole
        // point: without it a recording finishing late would clear a claim
        // belonging to the one that started after it.
        if (holder === claim) holder = null;
      }
    })();
  }, [claim, recorder, recording, since]);

  /**
   * The cap, enforced against the clock that is already running.
   *
   * It goes through the same `stop` a press goes through rather than a second
   * path to the same place: the file is kept, the position taken at the start
   * still travels with it, recording mode is still given back, and the note in
   * the sheet gains its recording exactly as it would have. The only difference
   * is who pressed the button.
   *
   * `stop` flips `recording` before its first `await`, so this cannot re-enter:
   * the next render fails the guard. The dialog is after the call for the same
   * reason — nothing about telling somebody should sit between the limit and
   * the recorder being told to stop.
   *
   * Declared after `stop` because it uses it. Hook order is what has to be
   * stable, not the order effects and callbacks are written in.
   */
  useEffect(() => {
    if (!recording || elapsedMs < MAX_VOICE_MS) return;

    stop();
    Alert.alert(
      'Recording stopped',
      `A voice note stops after ${MAX_VOICE_MS / 60_000} minutes. Everything up to here has been kept — record again to carry on in another note.`,
    );
  }, [recording, elapsedMs, stop]);

  return { recording, saving, elapsedMs, start, stop };
}
