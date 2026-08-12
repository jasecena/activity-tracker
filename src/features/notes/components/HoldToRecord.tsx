import { Ionicons } from '@expo/vector-icons';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, View } from 'react-native';
import Svg, { Circle } from 'react-native-svg';

import { monotonicNow } from '@/services/clock';
import { colors } from '@/theme/tokens';

import { HOLD_MS, HOLD_TICK_MS, holdFraction, ringDashOffset } from '../hold';

interface HoldToRecordProps {
  readonly recording: boolean;
  /** Between the stop and the file being written. The button is dead for it. */
  readonly saving: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
}

const SIZE = 56;
const STROKE = 3;
const RADIUS = SIZE / 2 - STROKE / 2;
const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

/**
 * Hold to start talking; tap to stop.
 *
 * **Why it is not a tap.** This sits in the note sheet, beside the field you
 * type into and a thumb's width from Save — recording and typing are the same
 * act, so the two live together, and that is exactly what makes an accidental
 * touch cheap to make and expensive to get. A single tap-to-toggle turns a
 * double tap into a recording that started and stopped: a second of silence
 * attached to a diary entry, and no obvious way to tell what happened. A
 * deliberate second of holding cannot be done by accident.
 *
 * **The ring is what makes the second bearable.** A button that does nothing
 * for a second is a broken button; a button filling a ring for a second is a
 * button counting down, and nobody lets go of it early. It fills from the
 * moment the finger lands and empties the moment it leaves, so an abandoned
 * hold visibly abandons rather than lingering.
 *
 * Stopping stays one tap. The confusion was only ever about beginning something
 * you did not mean to.
 */
export function HoldToRecord({ recording, saving, onStart, onStop }: HoldToRecordProps) {
  /**
   * When the finger landed, and how long ago that was.
   *
   * Both in state rather than refs: the ring is drawn from the second, and a
   * value the render depends on lives in state by rule — `react-hooks/refs` is
   * an error here, not a warning. `monotonicNow`, not `now`, because this is a
   * duration: the wall clock is corrected under the app, and a correction
   * landing mid-hold would jump the ring or finish the hold early, which is the
   * one outcome this control exists to prevent.
   */
  const [holdingSince, setHoldingSince] = useState<number | null>(null);
  const [heldMs, setHeldMs] = useState(0);

  /**
   * The caller's handler, held rather than closed over.
   *
   * The timer below is the hold; restarting it because a parent re-rendered and
   * handed down a new function would silently extend the second — so the effect
   * depends on the touch and nothing else, and reads the current handler when
   * it fires.
   */
  const begin = useRef(onStart);
  useEffect(() => {
    begin.current = onStart;
  }, [onStart]);

  const release = useCallback(() => {
    setHoldingSince(null);
    setHeldMs(0);
  }, []);

  /**
   * One timer decides, a second one draws.
   *
   * Deliberately not the same timer: making the start depend on the ring's
   * ticks would mean a dropped frame, or a render batched behind something
   * else, quietly lengthening the hold. The decision is a single timeout of
   * exactly `HOLD_MS`; the ring is decoration over it and may tick as coarsely
   * as it likes.
   */
  useEffect(() => {
    if (holdingSince === null) return;

    const started = setTimeout(() => {
      setHoldingSince(null);
      setHeldMs(0);
      begin.current();
    }, HOLD_MS);
    const drawing = setInterval(() => setHeldMs(monotonicNow() - holdingSince), HOLD_TICK_MS);

    return () => {
      clearTimeout(started);
      clearInterval(drawing);
    };
  }, [holdingSince]);

  const fraction = holdFraction(heldMs);

  return (
    <Pressable
      onPressIn={() => {
        if (recording || saving) return;
        setHoldingSince(monotonicNow());
        // A hair above zero rather than zero, so the ring appears under the
        // finger on the frame it lands rather than on the first tick.
        setHeldMs(1);
      }}
      onPressOut={release}
      onPress={() => {
        if (recording) onStop();
      }}
      disabled={saving}
      accessibilityRole="button"
      accessibilityState={{ busy: saving, selected: recording }}
      accessibilityLabel={recording ? 'Stop recording' : 'Hold to record a voice note'}
      accessibilityHint={recording ? undefined : 'Hold for a second to start recording'}
      style={({ pressed }) => [styles.button, recording && styles.recording, pressed && !recording && styles.pressed]}
    >
      {fraction > 0 ? (
        <View style={StyleSheet.absoluteFill} pointerEvents="none" testID="hold-ring">
          <Svg width={SIZE} height={SIZE}>
            <Circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={RADIUS}
              stroke={colors.move}
              strokeWidth={STROKE}
              fill="none"
              strokeDasharray={`${CIRCUMFERENCE} ${CIRCUMFERENCE}`}
              strokeDashoffset={ringDashOffset(fraction, RADIUS)}
              // From the top, like every other progress ring on the platform,
              // rather than from three o'clock where SVG starts.
              transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}
              strokeLinecap="round"
            />
          </Svg>
        </View>
      ) : null}

      <Ionicons
        name={recording ? 'stop' : 'mic-outline'}
        size={24}
        color={recording ? colors.onAccent : colors.textPrimary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    width: SIZE,
    height: SIZE,
    borderRadius: SIZE / 2,
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recording: { backgroundColor: colors.danger },
  pressed: { opacity: 0.8 },
});
