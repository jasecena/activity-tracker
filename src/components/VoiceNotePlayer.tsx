import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer, useAudioPlayerStatus } from 'expo-audio';
import { useCallback, useEffect } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NoteVoice } from '@/core/day';
import { formatDuration } from '@/core/format';
import { releaseAudioFocus, takeAudioFocus } from '@/services/audioFocus';
import { noteAudioUri } from '@/services/noteAudio';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface VoiceNotePlayerProps {
  readonly voice: NoteVoice;
  /** Offered in the sheet, where a recording can be replaced; never on a row. */
  readonly onForget?: () => void;
}

/**
 * Playing back what was said.
 *
 * It is not in the gallery, because a voice note is not a capture: the Media tab
 * is for looking at pictures, and a diary entry that has to be opened in a
 * different tab from the words beside it is two features pretending to be one.
 * So the pill sits on the note — on the row in the day's Notes section, and in
 * the sheet while the entry is being written. Shared rather than filed under
 * `features/notes`, because those two callers live on either side of that line
 * and `NoteRow` is the one in `components`.
 *
 * `useAudioPlayer` is a native module outside `src/services`, and it is the
 * same exception `MediaGalleryScreen` already takes: a player is a hook over a
 * native object rather than a value a service can build and hand over. One
 * file, which is what the boundary is actually for. It moved here when the
 * gallery stopped showing voice notes, so it is still one file and not two.
 *
 * A missing file is drawn as missing rather than as a dead play button. The
 * bytes can be gone — a restored backup, since the recordings are excluded from
 * one — while the note that names them is perfectly intact, and the note is the
 * part that mattered.
 */
export function VoiceNotePlayer({ voice, onForget }: VoiceNotePlayerProps) {
  const uri = noteAudioUri(voice.fileName);
  const player = useAudioPlayer(uri ?? undefined);
  const status = useAudioPlayerStatus(player);

  /**
   * Whether it is playing is **read from the player**, never mirrored.
   *
   * The obvious version holds a `playing` boolean and flips it on every press,
   * and it is wrong in the one case that matters: a clip that plays to its end
   * stops on its own, the boolean says otherwise, and the button sits on
   * "pause" over silence. The next press then pauses something already
   * stopped, and the one after resumes from the end and finishes instantly —
   * two presses to get back to the start of a thirty-second note, neither
   * doing what it says.
   *
   * Deriving it means the button cannot disagree with the audio, and there is
   * no state to keep in step. It is also why there is no effect here: an
   * effect that copies player state into React state is the same bug written
   * more slowly, which is what `react-hooks/set-state-in-effect` is for.
   */
  const playing = status.playing;

  /**
   * Sitting at the end, so the next press should start again rather than
   * resume into silence. Rewinding on the press rather than on the finish
   * keeps every decision in one place — and there is nothing to do about a
   * finished clip until somebody asks for it again.
   */
  const atEnd = status.duration > 0 && status.currentTime >= status.duration;

  /**
   * What the rest of the app calls to shut this one up.
   *
   * Stable across renders, because it is also the identity the focus is held
   * under — a function rebuilt every render would claim the focus afresh each
   * time and could never be found again to release it.
   */
  const silence = useCallback(() => player.pause(), [player]);

  // A row scrolled away, a sheet closed, a tab that finally unmounts: a
  // component that vanishes holding the focus leaves a dead function as the
  // thing the next player would interrupt.
  useEffect(() => () => releaseAudioFocus(silence), [silence]);

  if (!uri) {
    return (
      <View style={styles.pill}>
        <Ionicons name="alert-circle-outline" size={20} color={colors.textMuted} />
        <Text style={styles.missing}>Recording missing</Text>
      </View>
    );
  }

  return (
    <View style={styles.row}>
      <Pressable
        onPress={() => {
          if (playing) {
            player.pause();
            // Paused by hand, so it is not making a noise and has no claim on
            // being the one thing that is.
            releaseAudioFocus(silence);
            return;
          }
          if (atEnd) void player.seekTo(0);
          // Before `play`, so nothing is ever briefly audible over the thing it
          // is replacing.
          takeAudioFocus(silence);
          player.play();
        }}
        accessibilityRole="button"
        accessibilityLabel={playing ? 'Pause the recording' : 'Play the recording'}
        style={({ pressed }) => [styles.pill, pressed && styles.pressed]}
      >
        <Ionicons name={playing ? 'pause' : 'play'} size={18} color={colors.textPrimary} />
        <Text style={styles.duration}>{formatDuration(voice.durationMs)}</Text>
      </Pressable>

      {onForget ? (
        <Pressable
          onPress={onForget}
          accessibilityRole="button"
          accessibilityLabel="Delete the recording"
          style={({ pressed }) => [styles.forget, pressed && styles.pressed]}
        >
          <Ionicons name="trash-outline" size={18} color={colors.danger} />
        </Pressable>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm },
  pill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    alignSelf: 'flex-start',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  duration: { ...typography.clock, color: colors.textPrimary },
  missing: { ...typography.caption, color: colors.textMuted },
  forget: { padding: spacing.xs },
  pressed: { opacity: 0.6 },
});
