import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { colors } from '@/theme/tokens';

interface RecordButtonProps {
  readonly recording: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
  /**
   * How big, for the two places this button appears.
   *
   * In the sheet it sits at the end of a row beside the player and takes the
   * default. On the Notes tab it is the whole point of the screen's lower edge
   * — a thing reached for one-handed, in a hurry, without looking — so it is
   * larger there. A parameter rather than a second component: the glyph rule
   * below is the part that must never be forked.
   */
  readonly size?: number;
  /**
   * Why the microphone will not start, or absent when it will.
   *
   * A string rather than a boolean, so the reason reaches a screen reader and
   * anybody holding the button down waiting for something to happen. There is
   * exactly one reason today — the recording on this note is locked — and the
   * control it is disabled by is directly beside it, which is what makes
   * disabling honest here where the copy button chose to disappear instead: a
   * dimmed mic next to a lit padlock explains itself, and a mic that vanished
   * would not.
   */
  readonly disabledReason?: string;
}

const SIZE = 56;

/**
 * Tap to start, tap to stop.
 *
 * **This replaces a one-second hold with a filling ring, which was withdrawn
 * after being used.** The ring was built to stop an accidental double tap
 * becoming a recording that started and stopped, and it did — but it solved that
 * by making the deliberate case worse: every recording began with a second of
 * holding still and watching an arc, which is a second of not talking, on a
 * control whose entire job is to be pressed the moment you have something to
 * say. A guard that taxes the intended use every time to prevent an occasional
 * mistake is the wrong trade, and no amount of tuning the duration fixes the
 * shape of it.
 *
 * **What actually prevents the double tap is the icon changing.** The state is
 * carried by the glyph — a microphone becomes a square — rather than by colour
 * alone, so it survives a glance, a colourblind reader and a screen in sunlight.
 * Colour moves with it because two signals are more legible than one, but
 * nothing depends on it: turn the screen greyscale and the button still says
 * which of the two things it is about to do.
 *
 * **The change is synchronous, and that is the point of this component being
 * dumb.** `recording` flips in the same tick as the press; writing the file
 * happens behind it. A button that waits for a file system before admitting it
 * was pressed is a button people press again.
 */
export function RecordButton({ recording, onStart, onStop, size = SIZE, disabledReason }: RecordButtonProps) {
  // Never while recording: whatever disables starting must not be able to trap
  // a recording that is already running with no way to stop it.
  const blocked = !recording && disabledReason !== undefined;

  return (
    <Pressable
      onPress={recording ? onStop : onStart}
      disabled={blocked}
      accessibilityRole="button"
      accessibilityState={{ selected: recording, disabled: blocked }}
      accessibilityLabel={recording ? 'Stop recording' : (disabledReason ?? 'Record a voice note')}
      style={({ pressed }) => [
        styles.button,
        { width: size, height: size, borderRadius: size / 2 },
        recording && styles.recording,
        blocked && styles.blocked,
        pressed && styles.pressed,
      ]}
    >
      <Ionicons
        // A square, not a second microphone in another colour. The two states
        // have to be different *shapes* to be told apart without reading.
        name={recording ? 'square' : 'mic'}
        // Proportional, so the larger button is a larger button rather than the
        // same glyph adrift in more circle.
        size={Math.round(size * (recording ? 0.36 : 0.43))}
        color={recording ? colors.onAccent : blocked ? colors.textMuted : colors.textPrimary}
      />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  button: {
    backgroundColor: colors.surfaceRaised,
    alignItems: 'center',
    justifyContent: 'center',
  },
  recording: { backgroundColor: colors.danger },
  blocked: { opacity: 0.4 },
  pressed: { opacity: 0.7 },
});
