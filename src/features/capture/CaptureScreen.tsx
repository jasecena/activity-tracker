import { Ionicons } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/core/format';
import type { MediaKind } from '@/core/media';
import type { Fix } from '@/core/geo';
import { now as readNow } from '@/services/clock';
import { askPosition } from '@/services/position';
import { colors, radius, spacing, typography } from '@/theme/tokens';

import type { UseMedia } from './hooks/useMedia';

interface CaptureScreenProps {
  readonly media: UseMedia;
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

/**
 * The viewfinder fills the screen and the shutter sits at the bottom.
 *
 * Both because this is the one tab that is a thing you *do*. A preview boxed
 * into 320 points with a list of filenames under it is a screen about
 * capturing; a full-bleed frame with the shutter under your thumb is a camera.
 *
 * The list that used to sit here is gone rather than moved — Media is a whole
 * tab now, and showing the last twelve captures in two places means two things
 * to keep in step and one of them always slightly wrong.
 */
export function CaptureScreen({ media, visible }: CaptureScreenProps) {
  const [mode, setMode] = useState<Mode>('photo');
  const [facing, setFacing] = useState<CameraType>('back');

  /**
   * Recording and saving are separate states, and conflating them was a bug.
   *
   * `recordAsync` resolves only once recording *stops*, so awaiting it and
   * clearing the flag in a `finally` kept the button showing "recording" for
   * the whole time the clip was being sealed. Reported from a phone: the Stop
   * button appeared to do nothing, so it got tapped again, and again.
   *
   * Stop now flips the state the instant it is pressed — before the camera has
   * finished, before a byte is written — because that is when the person
   * pressing it needs to know it worked.
   */
  const [state, setState] = useState<'idle' | 'recording' | 'saving'>('idle');
  /** When the current recording started, for the elapsed clock. */
  const [since, setSince] = useState<number | null>(null);
  // Fed by a timer rather than read during render: a clock read in render does
  // not advance on its own, and this app keeps what the render depends on in
  // state by rule.
  const [elapsedMs, setElapsedMs] = useState(0);
  const [progress, setProgress] = useState(0);
  /**
   * Where the current recording started.
   *
   * Read when recording begins rather than when it ends: a minute of video or a
   * voice note walked home would otherwise be stamped with wherever you
   * finished, which is the one place it definitely was not taken.
   */
  const [startedAtPlace, setStartedAtPlace] = useState<Fix | null>(null);
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
    if (since === null) return;
    const timer = setInterval(() => setElapsedMs(readNow() - since), 500);
    return () => clearInterval(timer);
  }, [since]);

  // Leaving the tab mid-recording must not leave the camera or the microphone
  // running. The state is cleared in a callback rather than in the effect body:
  // stopping is a conversation with the hardware, and the app has not stopped
  // recording until the hardware says so.
  useEffect(() => {
    if (visible || state !== 'recording') return;
    camera.current?.stopRecording();
    void recorder.stop().then(() => setSince(null));
  }, [visible, state, recorder]);

  /**
   * Seal what was captured, showing how far along it is.
   *
   * Always ends in `idle`, whatever happened: a screen stuck on "Saving…"
   * because a write threw is worse than one that says it failed.
   */
  const store = useCallback(
    async (uri: string | null | undefined, kind: MediaKind, durationMs: number | null, at: Fix | null) => {
      setState('saving');
      setProgress(0);
      try {
        if (!uri) {
          setProblem('Nothing was captured.');
          return;
        }
        const stored = await media.keep(uri, kind, { durationMs, at, onProgress: setProgress });
        setProblem(stored ? null : 'That capture could not be stored, so it was not kept.');
      } finally {
        setState('idle');
        setSince(null);
        setProgress(0);
        setStartedAtPlace(null);
      }
    },
    [media],
  );

  const takePhoto = useCallback(async () => {
    // Both started together: a photo's shutter *is* its start, and waiting for
    // the fix before opening it would add a visible delay to the one capture
    // that should feel instant.
    const [picture, at] = await Promise.all([
      camera.current?.takePictureAsync({ quality: 0.8, exif: false }),
      askPosition(),
    ]);
    await store(picture?.uri, 'photo', null, at);
  }, [store]);

  const toggleVideo = useCallback(async () => {
    if (state === 'recording') {
      // Before the camera has finished and before a byte is written. The
      // person who pressed Stop needs to know now, not in ten seconds.
      setState('saving');
      camera.current?.stopRecording();
      return;
    }

    setState('recording');
    setSince(readNow());
    setElapsedMs(0);
    // Not awaited: the recording starts now, and the reading lands a moment
    // later without holding up the shutter.
    void askPosition().then(setStartedAtPlace);

    const clip = await camera.current?.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
    await store(clip?.uri, 'video', null, startedAtPlace);
  }, [startedAtPlace, state, store]);

  const toggleVoice = useCallback(async () => {
    if (state === 'recording') {
      const startedAt = since ?? readNow();
      setState('saving');
      await recorder.stop();
      await store(recorder.uri, 'audio', readNow() - startedAt, startedAtPlace);
      return;
    }

    await recorder.prepareToRecordAsync();
    recorder.record();
    setElapsedMs(0);
    setSince(readNow());
    setState('recording');
    void askPosition().then(setStartedAtPlace);
  }, [recorder, since, startedAtPlace, state, store]);

  const missingPermission =
    (needsCamera && cameraPermission?.granted === false) ||
    (needsMicrophone && microphonePermission?.granted === false);

  return (
    <View style={styles.screen}>
      {/* The viewfinder is the screen, not a panel on it. */}
      {needsCamera && visible ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          mode={mode === 'video' ? 'video' : 'picture'}
          // The default on iOS already focuses continuously; saying so keeps it
          // from being switched off by a future default change.
          autofocus="on"
        />
      ) : (
        <View style={[StyleSheet.absoluteFill, styles.voiceStage]}>
          <Ionicons
            name={state === 'recording' ? 'radio-button-on' : 'mic-outline'}
            size={56}
            color={state === 'recording' ? colors.danger : colors.textMuted}
          />
          <Text style={styles.voiceTime}>
            {state === 'recording' ? formatDuration(Math.max(0, elapsedMs)) : 'Ready'}
          </Text>
        </View>
      )}

      <View style={styles.topBar} pointerEvents="box-none">
        <View style={styles.modes}>
          {MODES.map((option) => {
            const selected = option.key === mode;
            return (
              <Pressable
                key={option.key}
                onPress={() => setMode(option.key)}
                // Changing what you are capturing halfway through capturing it
                // would unmount the camera under a running recording.
                disabled={state !== 'idle'}
                accessibilityRole="radio"
                accessibilityState={{ selected, disabled: state !== 'idle' }}
                accessibilityLabel={option.label}
                style={({ pressed }) => [styles.modeChip, selected && styles.modeChipOn, pressed && styles.pressed]}
              >
                <Ionicons name={option.icon} size={16} color={selected ? colors.onAccent : colors.textPrimary} />
                <Text style={[styles.modeText, selected && styles.modeTextOn]}>{option.label}</Text>
              </Pressable>
            );
          })}
        </View>

        {state === 'recording' && needsCamera ? (
          <View style={styles.recordingBadge}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>{formatDuration(Math.max(0, elapsedMs))}</Text>
          </View>
        ) : null}
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

      {/* Over the preview rather than under it. Sealing a minute of video takes
          seconds, and a screen that looks idle while it happens is what got the
          Stop button pressed three times. */}
      {state === 'saving' ? (
        <View style={styles.saving} accessible accessibilityLabel={`Saving, ${Math.round(progress * 100)}%`}>
          <Text style={styles.savingText}>Saving… {Math.round(progress * 100)}%</Text>
          {/* Not decoration. Leaving now suspends the app mid-write; the capture
              is recovered on the next launch, but only if it gets one, and cache
              is the first thing iOS reclaims. */}
          <Text style={styles.savingHint}>Keep the app open</Text>
          <View style={styles.progressTrack}>
            <View style={[styles.progressFill, { width: `${Math.round(progress * 100)}%` }]} />
          </View>
        </View>
      ) : null}

      <View style={styles.bottomBar} pointerEvents="box-none">
        {problem ? <Text style={styles.problem}>{problem}</Text> : null}

        {mode === 'video' && state !== 'recording' ? (
          <Text style={styles.footnote}>Clips stop at {MAX_VIDEO_SECONDS} seconds.</Text>
        ) : null}

        <View style={styles.controls}>
          <View style={styles.secondaryPlaceholder} />

          <Pressable
            onPress={() => {
              if (mode === 'photo') void takePhoto();
              else if (mode === 'video') void toggleVideo();
              else void toggleVoice();
            }}
            // Ignored while sealing. A tap that does nothing visible is what
            // taught the last build's user to keep tapping.
            disabled={state === 'saving'}
            accessibilityRole="button"
            accessibilityLabel={shutterLabel(mode, state)}
            style={({ pressed }) => [
              styles.shutter,
              state === 'recording' && styles.shutterActive,
              state === 'saving' && styles.shutterDisabled,
              pressed && styles.pressed,
            ]}
          >
            <View style={[styles.shutterInner, state === 'recording' && styles.shutterInnerActive]} />
          </Pressable>

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
        </View>
      </View>
    </View>
  );
}

function shutterLabel(mode: Mode, state: 'idle' | 'recording' | 'saving'): string {
  if (state === 'saving') return 'Saving';
  if (mode === 'photo') return 'Take photo';
  if (mode === 'video') return state === 'recording' ? 'Stop video' : 'Start video';
  return state === 'recording' ? 'Stop voice note' : 'Start voice note';
}

const styles = StyleSheet.create({
  // Black rather than the app background: what sits behind a viewfinder while
  // it starts up should look like a camera, not like a missing screen.
  screen: { flex: 1, backgroundColor: '#000' },
  topBar: {
    position: 'absolute',
    top: spacing.sm,
    left: spacing.md,
    right: spacing.md,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: spacing.sm,
  },
  bottomBar: {
    position: 'absolute',
    left: 0,
    right: 0,
    bottom: 0,
    paddingHorizontal: spacing.md,
    paddingBottom: spacing.md,
    gap: spacing.xs,
  },
  modes: { flexDirection: 'row', gap: spacing.xs },
  modeChip: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
    // Its own backing, because what is behind it is a live camera and a chip
    // with a border alone disappears against a bright sky.
    backgroundColor: 'rgba(11,15,20,0.55)',
  },
  modeChipOn: { backgroundColor: colors.manual },
  modeText: { ...typography.caption, color: colors.textPrimary },
  modeTextOn: { color: colors.onAccent, fontWeight: '600' },
  voiceStage: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
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
    backgroundColor: 'rgba(11,15,20,0.55)',
  },
  secondaryPlaceholder: { width: 44, height: 44 },
  shutter: {
    width: 72,
    height: 72,
    borderRadius: radius.pill,
    borderWidth: 3,
    borderColor: colors.textPrimary,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterActive: { borderColor: colors.danger },
  shutterDisabled: { opacity: 0.4 },
  shutterInner: { width: 56, height: 56, borderRadius: radius.pill, backgroundColor: colors.textPrimary },
  shutterInnerActive: { width: 28, height: 28, borderRadius: radius.sm, backgroundColor: colors.danger },
  saving: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'center',
    justifyContent: 'center',
    gap: spacing.sm,
    backgroundColor: 'rgba(11,15,20,0.82)',
    padding: spacing.lg,
  },
  savingText: { ...typography.body, color: colors.textPrimary },
  savingHint: { ...typography.caption, color: colors.textSecondary },
  progressTrack: {
    width: '70%',
    height: 4,
    borderRadius: radius.pill,
    backgroundColor: colors.border,
    overflow: 'hidden',
  },
  progressFill: { height: 4, backgroundColor: colors.move },
  recordingBadge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: spacing.xs,
    backgroundColor: 'rgba(11,15,20,0.7)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.xs,
  },
  recordingDot: { width: 8, height: 8, borderRadius: radius.pill, backgroundColor: colors.danger },
  recordingText: { ...typography.caption, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  notice: {
    position: 'absolute',
    top: 64,
    left: spacing.md,
    right: spacing.md,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.md,
    padding: spacing.md,
    gap: spacing.xs,
    borderLeftWidth: 3,
    borderLeftColor: colors.manual,
  },
  noticeTitle: { ...typography.body, fontWeight: '600', color: colors.textPrimary },
  noticeBody: { ...typography.caption, color: colors.textSecondary },
  footnote: { ...typography.caption, color: colors.textPrimary, textAlign: 'center' },
  problem: { ...typography.caption, color: colors.danger, textAlign: 'center' },
  pressed: { opacity: 0.6 },
});
