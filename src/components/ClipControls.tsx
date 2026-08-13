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
  /** True while the scrubber is being dragged — the host pauses its own gestures for the duration. */
  readonly onScrubbing?: (scrubbing: boolean) => void;
  /**
   * Turn the sound on or off.
   *
   * A callback rather than this component writing `player.muted`, because the
   * player arrives here as a prop and a write to a prop is the shape mistakes
   * take — the same reasoning the seek below already follows. The component that
   * *created* the player owns changing it; this one reports the press.
   */
  readonly onToggleMute?: () => void;
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
export function ClipControls({ player, durationMs, onScrubbing, onToggleMute }: ClipControlsProps) {
  const { isPlaying } = useEvent(player, 'playingChange', { isPlaying: player.playing });
  // Read from the player rather than mirrored into state, for the same reason
  // the voice-note player reads `playing`: a boolean beside the truth is a
  // boolean that eventually disagrees with it.
  const { muted } = useEvent(player, 'mutedChange', { muted: player.muted });
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
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Ionicons name={isPlaying ? 'pause' : 'play'} size={28} color={colors.textPrimary} />
      </Pressable>

      {/* **Sound is a control, not a surprise.** A clip starts muted because it
          starts on its own, so this is how it gets a voice — which makes it a
          primary control rather than an afterthought, and it is sized like one.
          In the bar and in line with the scrubber, because it belongs to this
          clip and this moment rather than to the app. */}
      <Pressable
        onPress={onToggleMute}
        accessibilityRole="button"
        accessibilityState={{ selected: !muted }}
        accessibilityLabel={muted ? 'Turn sound on' : 'Mute'}
        style={({ pressed }) => [styles.button, pressed && styles.pressed]}
      >
        <Ionicons
          // Different glyphs, not one glyph in two colours — the same rule the
          // record button follows, so the state reads at a glance and survives
          // a greyscale screen.
          name={muted ? 'volume-mute' : 'volume-high'}
          size={26}
          color={colors.textPrimary}
        />
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
          onDragging={onScrubbing}
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
  // 48, not the 40 it was: these are the two controls pressed while holding a
  // phone one-handed over a moving picture, and 44 is the smallest iOS asks
  // anything tappable to be.
  button: {
    width: 48,
    height: 48,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
  },
  track: { flex: 1 },
  time: { ...typography.caption, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  pressed: { opacity: 0.6 },
});
