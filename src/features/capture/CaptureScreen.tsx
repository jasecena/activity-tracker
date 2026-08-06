import { Ionicons } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatClockTime, formatDuration } from '@/core/format';
import type { MediaItem, MediaKind } from '@/core/media';
import { ScreenHeader } from '@/components/ScreenHeader';
import { now as readNow } from '@/services/clock';
import { colors, radius, spacing, typography } from '@/theme/tokens';

import type { UseMedia } from './hooks/useMedia';

interface CaptureScreenProps {
  readonly media: UseMedia;
  readonly tzOffsetMinutes: number;
  /**
   * Whether the Capture tab is the one on screen.
   *
   * The camera is mounted only when it is. Every tab in this app stays mounted
   * so nothing is lost by switching, which is right for a timeline and wrong
   * for a camera: a preview running behind four hidden screens costs battery,
   * holds the capture session, and leaves the recording indicator lit while you
   * are reading Settings.
   */
  readonly visible: boolean;
  readonly onOpenItem: (item: MediaItem) => void;
}

/**
 * A minute. Long enough for anything worth attaching to a day, short enough
 * that sealing it stays a second or two rather than a stall — the bytes are
 * encrypted on the way in and decrypted again to play.
 */
const MAX_VIDEO_SECONDS = 60;

type Mode = 'photo' | 'video' | 'voice';

const MODES: readonly { readonly key: Mode; readonly label: string; readonly icon: keyof typeof Ionicons.glyphMap }[] =
  [
    { key: 'photo', label: 'Photo', icon: 'camera-outline' },
    { key: 'video', label: 'Video', icon: 'videocam-outline' },
    { key: 'voice', label: 'Voice', icon: 'mic-outline' },
  ];

const KIND_ICONS: Readonly<Record<MediaKind, keyof typeof Ionicons.glyphMap>> = {
  photo: 'image-outline',
  video: 'film-outline',
  audio: 'musical-notes-outline',
};

export function CaptureScreen({ media, tzOffsetMinutes, visible, onOpenItem }: CaptureScreenProps) {
  const [mode, setMode] = useState<Mode>('photo');
  const [facing, setFacing] = useState<CameraType>('back');
  const [busy, setBusy] = useState(false);
  const [recordingVideo, setRecordingVideo] = useState(false);
  const [voiceStartedAt, setVoiceStartedAt] = useState<number | null>(null);
  // How long the voice note has been running. State fed by a timer rather than
  // a clock read during render: a read in render does not advance on its own,
  // and this app keeps values the render depends on in state by rule.
  const [elapsedVoiceMs, setElapsedVoiceMs] = useState(0);
  const [problem, setProblem] = useState<string | null>(null);

  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [microphonePermission, requestMicrophone] = useMicrophonePermissions();

  // The camera handle is imperative by nature — `takePictureAsync` is a method
  // on the view. Nothing rendered reads it, which is what the refs rule cares
  // about.
  const camera = useRef<CameraView | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const needsCamera = mode !== 'voice';
  const needsMicrophone = mode !== 'photo';

  useEffect(() => {
    if (!visible || !needsMicrophone) return;
    void (async () => {
      const granted = await AudioModule.requestRecordingPermissionsAsync();
      if (!granted.granted) return;
      await setAudioModeAsync({ playsInSilentMode: true, allowsRecording: true });
    })();
  }, [visible, needsMicrophone]);

  useEffect(() => {
    if (voiceStartedAt === null) return;
    const timer = setInterval(() => setElapsedVoiceMs(readNow() - voiceStartedAt), 500);
    return () => clearInterval(timer);
  }, [voiceStartedAt]);

  // Leaving the tab mid-recording must not leave the microphone open. The state
  // is cleared in the callback rather than in the effect body: stopping is a
  // conversation with the recorder, and the app has not stopped recording until
  // the recorder says so.
  useEffect(() => {
    if (visible || voiceStartedAt === null) return;
    void recorder.stop().then(() => setVoiceStartedAt(null));
  }, [visible, voiceStartedAt, recorder]);

  const store = useCallback(
    async (uri: string | null | undefined, kind: MediaKind, durationMs: number | null) => {
      if (!uri) {
        setProblem('Nothing was captured.');
        return;
      }
      const stored = await media.keep(uri, kind, durationMs);
      setProblem(stored ? null : 'That capture could not be stored, so it was not kept.');
    },
    [media],
  );

  const takePhoto = useCallback(async () => {
    setBusy(true);
    try {
      const picture = await camera.current?.takePictureAsync({ quality: 0.8, exif: false });
      await store(picture?.uri, 'photo', null);
    } finally {
      setBusy(false);
    }
  }, [store]);

  const toggleVideo = useCallback(async () => {
    if (recordingVideo) {
      camera.current?.stopRecording();
      return;
    }
    setRecordingVideo(true);
    try {
      const clip = await camera.current?.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
      await store(clip?.uri, 'video', null);
    } finally {
      setRecordingVideo(false);
    }
  }, [recordingVideo, store]);

  const toggleVoice = useCallback(async () => {
    if (voiceStartedAt !== null) {
      const startedAt = voiceStartedAt;
      setVoiceStartedAt(null);
      await recorder.stop();
      await store(recorder.uri, 'audio', readNow() - startedAt);
      return;
    }
    await recorder.prepareToRecordAsync();
    recorder.record();
    setElapsedVoiceMs(0);
    setVoiceStartedAt(readNow());
  }, [recorder, store, voiceStartedAt]);

  const missingPermission =
    (needsCamera && cameraPermission?.granted === false) ||
    (needsMicrophone && microphonePermission?.granted === false);

  const recent = [...media.items].reverse().slice(0, 12);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title="Capture"
        subtitle={media.items.length === 1 ? '1 capture' : `${media.items.length} captures`}
      />

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.modes}>
          {MODES.map((option) => {
            const selected = option.key === mode;
            return (
              <Pressable
                key={option.key}
                onPress={() => setMode(option.key)}
                accessibilityRole="radio"
                accessibilityState={{ selected }}
                accessibilityLabel={option.label}
                style={({ pressed }) => [styles.modeChip, selected && styles.modeChipOn, pressed && styles.pressed]}
              >
                <Ionicons name={option.icon} size={16} color={selected ? colors.onAccent : colors.textSecondary} />
                <Text style={[styles.modeText, selected && styles.modeTextOn]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {missingPermission ? (
          <Pressable
            onPress={() => {
              if (needsCamera) void requestCamera();
              if (needsMicrophone) void requestMicrophone();
            }}
            accessibilityRole="button"
            accessibilityLabel="Allow camera and microphone"
            style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
          >
            <Text style={styles.noticeTitle}>Access is off</Text>
            <Text style={styles.noticeBody}>
              Capture needs the camera and microphone. Turn them on in iOS Settings — nothing recorded here leaves this
              phone.
            </Text>
          </Pressable>
        ) : null}

        <View style={styles.stage}>
          {needsCamera && visible ? (
            <CameraView
              ref={camera}
              style={StyleSheet.absoluteFill}
              facing={facing}
              mode={mode === 'video' ? 'video' : 'picture'}
              // The default on iOS already focuses continuously; saying so
              // keeps it from being switched off by a future default change.
              autofocus="on"
            />
          ) : (
            <View style={styles.voiceStage}>
              <Ionicons
                name={voiceStartedAt === null ? 'mic-outline' : 'radio-button-on'}
                size={44}
                color={voiceStartedAt === null ? colors.textMuted : colors.danger}
              />
              <Text style={styles.voiceTime}>
                {voiceStartedAt === null ? 'Ready' : formatDuration(Math.max(0, elapsedVoiceMs))}
              </Text>
            </View>
          )}
        </View>

        <View style={styles.controls}>
          {needsCamera ? (
            <Pressable
              onPress={() => setFacing(facing === 'back' ? 'front' : 'back')}
              accessibilityRole="button"
              accessibilityLabel={facing === 'back' ? 'Switch to front camera' : 'Switch to back camera'}
              style={({ pressed }) => [styles.secondary, pressed && styles.pressed]}
            >
              <Ionicons name="camera-reverse-outline" size={22} color={colors.textPrimary} />
            </Pressable>
          ) : (
            <View style={styles.secondaryPlaceholder} />
          )}

          <Pressable
            onPress={() => {
              if (mode === 'photo') void takePhoto();
              else if (mode === 'video') void toggleVideo();
              else void toggleVoice();
            }}
            disabled={busy}
            accessibilityRole="button"
            accessibilityLabel={shutterLabel(mode, recordingVideo, voiceStartedAt !== null)}
            style={({ pressed }) => [
              styles.shutter,
              (recordingVideo || voiceStartedAt !== null) && styles.shutterActive,
              pressed && styles.pressed,
            ]}
          >
            <View style={styles.shutterInner} />
          </Pressable>

          <View style={styles.secondaryPlaceholder} />
        </View>

        {mode === 'video' ? (
          <Text style={styles.footnote}>
            Clips stop at {MAX_VIDEO_SECONDS} seconds. Everything captured is encrypted as it is written and decrypted
            only to play, and a longer clip makes both passes something you would wait for.
          </Text>
        ) : null}

        {problem ? <Text style={styles.problem}>{problem}</Text> : null}

        <Text style={styles.sectionLabel}>RECENT</Text>
        <View style={styles.card}>
          {recent.length === 0 ? (
            <Text style={styles.empty}>Nothing captured yet.</Text>
          ) : (
            recent.map((item) => (
              <Pressable
                key={item.id}
                onPress={() => onOpenItem(item)}
                accessibilityRole="button"
                accessibilityLabel={`${item.kind} at ${formatClockTime(item.capturedAt, tzOffsetMinutes)}`}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
              >
                <Ionicons name={KIND_ICONS[item.kind]} size={18} color={colors.manual} />
                <Text style={styles.rowTitle}>{formatClockTime(item.capturedAt, tzOffsetMinutes)}</Text>
                <Text style={styles.rowDetail}>
                  {item.durationMs === null ? '' : `${formatDuration(item.durationMs)} · `}
                  {Math.round(item.byteLength / 1024)} kB
                </Text>
              </Pressable>
            ))
          )}
        </View>

        {/* Where a capture happened is not recorded with it — it is worked out
            from the day's own fixes. Saying so is the point: the shutter does
            not touch the GPS. */}
        <Text style={styles.footnote}>
          A capture stores the time it was taken and nothing else about where you were. The map works that out from the
          fixes the day already had, so pressing the shutter never asks for your location.
        </Text>
      </ScrollView>
    </View>
  );
}

function shutterLabel(mode: Mode, recordingVideo: boolean, recordingVoice: boolean): string {
  if (mode === 'photo') return 'Take photo';
  if (mode === 'video') return recordingVideo ? 'Stop video' : 'Start video';
  return recordingVoice ? 'Stop voice note' : 'Start voice note';
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  modes: { flexDirection: 'row', gap: spacing.xs },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderWidth: 1,
    borderColor: colors.border,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  modeChipOn: { backgroundColor: colors.manual, borderColor: colors.manual },
  modeText: { ...typography.caption, color: colors.textSecondary },
  modeTextOn: { color: colors.onAccent, fontWeight: '600' },
  stage: {
    height: 320,
    borderRadius: radius.md,
    overflow: 'hidden',
    backgroundColor: colors.surface,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
  },
  voiceStage: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  voiceTime: { ...typography.clock, color: colors.textSecondary },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  secondary: {
    width: 44,
    height: 44,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.surfaceRaised,
  },
  secondaryPlaceholder: { width: 44, height: 44 },
  shutter: {
    width: 68,
    height: 68,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterActive: { borderColor: colors.danger },
  shutterInner: { width: 52, height: 52, borderRadius: radius.pill, backgroundColor: colors.textPrimary },
  notice: {
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: colors.manual,
  },
  noticeTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  noticeBody: { ...typography.caption, color: colors.textSecondary },
  sectionLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, marginTop: spacing.sm },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  row: { flexDirection: 'row', alignItems: 'center', gap: spacing.sm, paddingVertical: spacing.sm },
  rowTitle: { ...typography.body, color: colors.textPrimary, flex: 1 },
  rowDetail: { ...typography.caption, color: colors.textSecondary },
  empty: { ...typography.body, color: colors.textMuted, paddingVertical: spacing.lg, textAlign: 'center' },
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs },
  problem: { ...typography.caption, color: colors.danger, paddingHorizontal: spacing.xs },
  pressed: { opacity: 0.6 },
});
