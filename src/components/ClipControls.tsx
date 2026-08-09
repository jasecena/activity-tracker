import { useEvent } from 'expo';
import type { VideoPlayer } from 'expo-video';
import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/core/format';
import { colors, radius, spacing, typography } from '@/theme/tokens';

import { Scrubber } from './Scrubber';

interface ClipControlsProps {
  readonly player: VideoPlayer;
  /** Length in ms, from the item's own record — the player reports 0 until it has read the file. */
  readonly durationMs: number | null;
}

/**
 * The app's own transport: play/pause, a scrubber, and the two times.
 *
 * This replaces AVKit's `nativeControls`, and the reason is touch routing
 * rather than appearance: the native controls sit in a native view that
 * consumes every drag that starts on them, so no gesture of this app's — the
 * swipe up for details, the swipe down to the grid — can begin over a playing
 * video. Owning the controls ends that class of problem rather than working
 * around it once.
 *
 * It also ends the one place the app suddenly looked like a system dialog.
 * The scrubber is the same `Scrubber` the replay screen drags through a day,
 * so a video's timeline and a day's timeline are one control in two places.
 *
 * What is knowingly given up: AirPlay, picture-in-picture, system captions.
 * For a diary's own clips, none of the three earns the touch routing back.
 *
 * `timeUpdate` arrives four times a second — enough for a scrubber to read as
 * live, well under anything that would tax the bridge.
 */
export function ClipControls({ player, durationMs }: ClipControlsProps) {
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  const { currentTime } = useEvent(player, 'timeUpdate', {
    currentTime: player.currentTime,
    currentLiveTimestamp: null,
    currentOffsetFromLive: null,
    bufferedPosition: 0,
  });

  // The stored duration wins: the player says 0 until the file is open, and a
  // scrubber whose range arrives late jumps under the finger.
  const totalMs = durationMs ?? (Number.isFinite(player.duration) ? player.duration * 1000 : 0);
  const atMs = Math.min(totalMs, currentTime * 1000);

  return (
    <View style={styles.bar}>
      <Pressable
        onPress={() => (isPlaying ? player.pause() : player.play())}
        accessibilityRole="button"
        accessibilityLabel={isPlaying ? 'Pause' : 'Play'}
        style={({ pressed }) => [styles.playButton, pressed && styles.pressed]}
      >
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={22} color={colors.textPrimary} />
      </Pressable>

      <Text style={styles.time}>{formatDuration(Math.max(0, atMs))}</Text>

      <View style={styles.track}>
        <Scrubber
          from={0}
          to={Math.max(1, totalMs)}
          value={atMs}
          // `seekBy` rather than assigning `currentTime`: the same seek, as a
          // method call — the immutability rule is right that a bare property
          // write on a hook's value is the shape mistakes take, and the API
          // offers both for exactly this reason.
          onChange={(next) => player.seekBy(next / 1000 - player.currentTime)}
          label={`Playback position, ${formatDuration(Math.max(0, atMs))}`}
        />
      </View>

      {/* Remaining, not total: the question mid-clip is "how much longer". */}
      <Text style={styles.time}>-{formatDuration(Math.max(0, totalMs - atMs))}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(11,15,20,0.62)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  playButton: {
    width: 40,
    height: 40,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { flex: 1 },
  time: { ...typography.caption, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.6 },
});
