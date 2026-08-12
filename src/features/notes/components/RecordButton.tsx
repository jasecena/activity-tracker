import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet } from 'react-native';

import { colors } from '@/theme/tokens';

interface RecordButtonProps {
  readonly recording: boolean;
  readonly onStart: () => void;
  readonly onStop: () => void;
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
export function RecordButton({ recording, onStart, onStop }: RecordButtonProps) {
  return (
    <Pressable
      onPress={recording ? onStop : onStart}
      accessibilityRole="button"
      accessibilityState={{ selected: recording }}
      accessibilityLabel={recording ? 'Stop recording' : 'Record a voice note'}
      style={({ pressed }) => [styles.button, recording && styles.recording, pressed && styles.pressed]}
    >
      <Ionicons
        // A square, not a second microphone in another colour. The two states
        // have to be different *shapes* to be told apart without reading.
        name={recording ? 'square' : 'mic'}
        size={recording ? 20 : 24}
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
  pressed: { opacity: 0.7 },
});
