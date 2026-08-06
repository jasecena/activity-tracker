import { useAudioPlayer } from 'expo-audio';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Alert, Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatClockTime, formatDuration } from '@/core/format';
import type { MediaItem } from '@/core/media';
import type { Position } from '@/core/replay';
import { MapCanvas } from '@/components/MapCanvas';
import { ScreenHeader } from '@/components/ScreenHeader';
import { openForPlayback, releasePlayback } from '@/services/mediaStore';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface MediaScreenProps {
  readonly item: MediaItem;
  /** Where the day says you were at the instant of capture, or null if it does not know. */
  readonly at: Position | null;
  readonly tzOffsetMinutes: number;
  readonly mapsEnabled: boolean;
  readonly onBack: () => void;
  readonly onForget: (id: string) => void;
}

/**
 * One capture, decrypted for as long as you are looking at it.
 *
 * The plaintext exists only while this screen is mounted, in the cache
 * directory, and is deleted on the way out. That is the cost of encrypting
 * media at rest and it is the right cost: the alternative is a decrypted copy
 * of everything you ever captured sitting in the container forever.
 */
export function MediaScreen({ item, at, tzOffsetMinutes, mapsEnabled, onBack, onForget }: MediaScreenProps) {
  const [uri, setUri] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      const opened = await openForPlayback(item);
      if (!live) return;
      setUri(opened);
      setFailed(opened === null);
    })();

    return () => {
      live = false;
      releasePlayback(item);
    };
  }, [item]);

  const confirmForget = () =>
    Alert.alert('Forget this capture?', 'The file is deleted from this phone. There is no copy anywhere else.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Forget',
        style: 'destructive',
        onPress: () => {
          onForget(item.id);
          onBack();
        },
      },
    ]);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={formatClockTime(item.capturedAt, tzOffsetMinutes)}
        subtitle={`${item.kind}${item.durationMs === null ? '' : ` · ${formatDuration(item.durationMs)}`}`}
        onBack={onBack}
        action={{ label: 'Forget this capture', icon: 'trash-outline', onPress: confirmForget }}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stage}>
          {failed ? (
            <Text style={styles.failed}>
              This file cannot be read. That happens when it came from a backup restored onto another phone — the bytes
              travelled and the key, deliberately, did not.
            </Text>
          ) : uri === null ? (
            <Text style={styles.loading}>Decrypting…</Text>
          ) : (
            <Playback item={item} uri={uri} />
          )}
        </View>

        {at ? (
          <>
            <Text style={styles.sectionLabel}>WHERE</Text>
            <MapCanvas
              mapsEnabled={mapsEnabled}
              tracks={[]}
              marks={[{ id: item.id, at, label: 'Captured here', kind: 'media' }]}
              height={200}
              label="Map of where this was captured"
            />
          </>
        ) : (
          <Text style={styles.footnote}>
            The day has no fixes for this moment, so there is nowhere to put it on a map. Nothing was lost — a capture
            never stored a position of its own.
          </Text>
        )}

        <Text style={styles.sectionLabel}>WHAT IS STORED</Text>
        <View style={styles.card}>
          <Field label="Captured" value={formatClockTime(item.capturedAt, tzOffsetMinutes)} />
          <Field label="Kind" value={item.kind} />
          <Field label="Length" value={item.durationMs === null ? '—' : formatDuration(item.durationMs)} />
          <Field label="Size on disk" value={`${Math.round(item.byteLength / 1024)} kB`} />
          <Field label="Position" value={at ? `${at.lat.toFixed(5)}, ${at.lon.toFixed(5)}` : 'not known'} />
          {/* Not a stored field. It is worked out on read from the day's own
              fixes, which is why it can change if the day is re-derived and why
              it is absent for a capture taken in a gap. */}
          <Field label="Position came from" value={at ? 'the day’s fixes' : '—'} />
          <Field label="Identifier" value={item.id} />
        </View>

        <Text style={styles.footnote}>
          The file is encrypted on this phone under a key held in the keychain and marked so it never enters a backup.
          It is decrypted into a temporary copy only while this screen is open, and that copy is deleted when you leave.
        </Text>
      </ScrollView>
    </View>
  );
}

function Playback({ item, uri }: { readonly item: MediaItem; readonly uri: string }) {
  if (item.kind === 'photo') {
    return <Image source={{ uri }} style={StyleSheet.absoluteFill} resizeMode="contain" accessibilityLabel="Photo" />;
  }
  if (item.kind === 'video') return <VideoPlayback uri={uri} />;
  return <AudioPlayback uri={uri} />;
}

function VideoPlayback({ uri }: { readonly uri: string }) {
  const player = useVideoPlayer(uri, (instance) => {
    instance.loop = false;
  });
  return <VideoView style={StyleSheet.absoluteFill} player={player} nativeControls />;
}

function AudioPlayback({ uri }: { readonly uri: string }) {
  const player = useAudioPlayer(uri);
  const [playing, setPlaying] = useState(false);

  return (
    <Pressable
      onPress={() => {
        if (playing) player.pause();
        else player.play();
        setPlaying(!playing);
      }}
      accessibilityRole="button"
      accessibilityLabel={playing ? 'Pause voice note' : 'Play voice note'}
      style={({ pressed }) => [styles.audio, pressed && styles.pressed]}
    >
      <Text style={styles.audioText}>{playing ? '❚❚ Pause' : '▶ Play'}</Text>
    </Pressable>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  stage: {
    height: 320,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  loading: { ...typography.body, color: colors.textMuted },
  failed: { ...typography.caption, color: colors.textSecondary, textAlign: 'center' },
  audio: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.pill,
  },
  audioText: { ...typography.body, color: colors.textPrimary },
  sectionLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, marginTop: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  field: { flexDirection: 'row', justifyContent: 'space-between', gap: spacing.sm, paddingVertical: spacing.sm },
  fieldLabel: { ...typography.body, color: colors.textSecondary, flexShrink: 0 },
  fieldValue: { ...typography.clock, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs },
  pressed: { opacity: 0.6 },
});
