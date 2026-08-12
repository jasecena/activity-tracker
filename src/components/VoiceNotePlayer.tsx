import { Ionicons } from '@expo/vector-icons';
import { useAudioPlayer } from 'expo-audio';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import type { NoteVoice } from '@/core/day';
import { formatDuration } from '@/core/format';
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
  const [playing, setPlaying] = useState(false);

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
          if (playing) player.pause();
          else player.play();
          setPlaying(!playing);
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
