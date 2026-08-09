import { Ionicons } from '@expo/vector-icons';
import { AudioModule, RecordingPresets, setAudioModeAsync, useAudioRecorder } from 'expo-audio';
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/core/format';
import { oppositeEdge, topEdgeFor, uprightRotationFor, type CaptureOrientation, type MediaKind } from '@/core/media';
import type { Fix } from '@/core/geo';
import { now as readNow } from '@/services/clock';
import { ensureForegroundPermission } from '@/services/location';
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

/**
 * How far one press of the zoom moves it.
 *
 * `CameraView`'s `zoom` is 0 to 1 across whatever range the lens has, not a
 * magnification — 0.5 is not "2×" and there is no way to ask what it would be.
 * So the buttons step it and the readout is a percentage of the range, which is
 * the only honest thing to call it.
 *
 * There is no pinch. `expo-camera` has no gesture of its own, so pinching would
 * mean a multi-touch responder and a hand-rolled scale, and two buttons you can
 * hit without looking are worth more on a camera than a gesture that fights the
 * swipe between pages.
 */
const ZOOM_STEP = 0.1;

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
  const [zoom, setZoom] = useState(0);

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
  const [problem, setProblem] = useState<string | null>(null);
  /**
   * Which way the phone is being held, while the interface stays portrait.
   *
   * State rather than a ref because the controls turn with it, and a value the
   * render depends on lives in state by rule. It costs a re-render per quarter
   * turn of the phone, which is not a rate anything needs protecting from.
   */
  const [orientation, setOrientation] = useState<CaptureOrientation>('portrait');

  /**
   * Where the current recording started, and how the phone was held for it.
   *
   * A ref, and this is the second attempt: both of these were `useState`, and
   * as state they could not work. `recordAsync` resolves only when recording
   * stops, so the call that hands the clip over is running inside the closure
   * that *started* it — a closure created before the position ever arrived. It
   * read `null` every time, and every video was stored with no position at all
   * while the reading sat in state one render away. The failure was silent:
   * nothing errors, a pin simply never appears.
   *
   * Nothing renders either value, which is what the refs rule cares about —
   * same as the camera handle above. Read at the end of a recording, written at
   * the start of one, and never during a render.
   */
  const started = useRef<{ at: Fix | null; orientation: CaptureOrientation | null }>({ at: null, orientation: null });

  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [microphonePermission, requestMicrophone] = useMicrophonePermissions();

  // The camera handle is imperative by nature — `takePictureAsync` is a method
  // on the view. Nothing rendered reads it, which is what the refs rule cares
  // about.
  const camera = useRef<CameraView | null>(null);

  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);

  const needsCamera = mode !== 'voice';
  const needsMicrophone = mode !== 'photo';

  /**
   * A capture stores where it was taken, and Core Location will not say without
   * being asked. Requested when the tab appears rather than at the shutter: the
   * dialog is a wait, and a photograph should not be waiting behind one.
   *
   * Foreground only. The background upgrade is offered once per install and
   * belongs to the tracking switch, which is the thing that actually records
   * while the app is closed.
   */
  useEffect(() => {
    if (!visible) return;
    void ensureForegroundPermission();
  }, [visible]);

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
    async (
      uri: string | null | undefined,
      kind: MediaKind,
      durationMs: number | null,
      at: Fix | null,
      heldAs: CaptureOrientation | null,
    ) => {
      setState('saving');
      setProgress(0);
      try {
        if (!uri) {
          setProblem('Nothing was captured.');
          return;
        }
        const stored = await media.keep(uri, kind, {
          durationMs,
          at,
          orientation: heldAs,
          onProgress: setProgress,
        });
        setProblem(stored ? null : 'That capture could not be stored, so it was not kept.');
      } finally {
        setState('idle');
        setSince(null);
        setProgress(0);
        started.current = { at: null, orientation: null };
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
    // Read now rather than after the await: the shutter is the moment, and a
    // phone put down while the picture is written was not how it was taken.
    await store(picture?.uri, 'photo', null, at, orientation);
  }, [orientation, store]);

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
    // Known at once; the reading has to be waited for.
    started.current = { at: null, orientation };
    // Not awaited: the recording starts now, and the reading lands a moment
    // later without holding up the shutter. It lands in the ref rather than in
    // state because this closure is still running when the clip finishes, and
    // a closure cannot see a state update made after it started.
    void askPosition().then((at) => {
      started.current = { ...started.current, at };
    });

    const clip = await camera.current?.recordAsync({ maxDuration: MAX_VIDEO_SECONDS });
    await store(clip?.uri, 'video', null, started.current.at, started.current.orientation);
  }, [orientation, state, store]);

  const toggleVoice = useCallback(async () => {
    if (state === 'recording') {
      const startedAt = since ?? readNow();
      setState('saving');
      await recorder.stop();
      // Null, not the phone's orientation: a voice note has no picture, and an
      // orientation on it would be a fact about nothing.
      await store(recorder.uri, 'audio', readNow() - startedAt, started.current.at, null);
      return;
    }

    await recorder.prepareToRecordAsync();
    recorder.record();
    setElapsedMs(0);
    setSince(readNow());
    setState('recording');
    // A voice note has no picture, so only the place is worth keeping.
    started.current = { at: null, orientation: null };
    void askPosition().then((at) => {
      started.current = { ...started.current, at };
    });
  }, [recorder, since, state, store]);

  const missingPermission =
    (needsCamera && cameraPermission?.granted === false) ||
    (needsMicrophone && microphonePermission?.granted === false);

  /**
   * The controls turn *and* cross over, so they read the right way up and sit
   * along the top of what you are looking at.
   *
   * Turning alone is what the iOS camera settles for, and it leaves the mode
   * rail along the bottom edge half the time — the half where the phone was
   * turned the other way. The rails move instead: the modes take whichever edge
   * is uppermost, zoom takes the other, and the flip button swaps ends of the
   * shutter row so it stays on the same side as the modes.
   *
   * Both the angle and the edge come from one function each, over the same
   * fact. "Undo the phone being turned" is a single idea and the glyphs, the
   * rails and a stored photograph are three readings of it.
   */
  const upright = { transform: [{ rotate: `${uprightRotationFor(orientation)}deg` }] };
  const modesEdge = topEdgeFor(orientation);
  const zoomEdge = oppositeEdge(modesEdge);

  return (
    <View style={styles.screen}>
      {/* The viewfinder is the screen, not a panel on it. */}
      {needsCamera && visible ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          zoom={zoom}
          mode={mode === 'video' ? 'video' : 'picture'}
          /**
           * `"off"` is continuous autofocus. Read that twice, because the
           * naming is a trap and this app fell in it.
           *
           * `expo-camera`'s `FocusMode` is documented as: `"on"` — focus once
           * and then **lock**; `"off"` — focus automatically **when needed**.
           * So `"on"` is the manual one. It was set here with a comment saying
           * it meant continuous focus, which is how the camera came to focus
           * once as it mounted and then hold that plane for as long as the tab
           * was open: point it at something else and nothing happened.
           *
           * There is no built-in tap-to-focus in this SDK — no point of
           * interest, no focus callback — so a tap would mean a gesture and a
           * hand-rolled toggle. Continuous focus is what a tap would have been
           * asking for anyway.
           */
          autofocus="off"
          /**
           * The device's own orientation, while the interface stays locked to
           * portrait.
           *
           * This is the signal iOS already computes for the status bar, not a
           * sensor this app reads: it needs no permission and no
           * `expo-sensors`, which was deliberately removed and is not worth
           * bringing back for one value.
           *
           * What it is used for is deliberately narrow. The capture is stamped
           * with how the phone was held and the controls turn to stay upright;
           * the file is written exactly as the camera produces it, and the
           * gallery turns the picture at the moment it draws it.
           */
          responsiveOrientationWhenOrientationLocked
          onResponsiveOrientationChanged={(event) => setOrientation(event.orientation)}
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

      {state === 'recording' && needsCamera ? (
        <View style={styles.topBar} pointerEvents="box-none">
          <View style={[styles.recordingBadge, upright]}>
            <View style={styles.recordingDot} />
            <Text style={styles.recordingText}>{formatDuration(Math.max(0, elapsedMs))}</Text>
          </View>
        </View>
      ) : null}

      {/* Down the left edge, mirroring the modes: the two things you adjust
          while holding the phone, one under each thumb. Hidden for a voice
          note, which has no picture to make larger. */}
      {needsCamera ? (
        <View style={[styles.zoomRail, styles[zoomEdge]]}>
          <Pressable
            onPress={() => setZoom((current) => Math.min(1, current + ZOOM_STEP))}
            disabled={zoom >= 1}
            accessibilityRole="button"
            accessibilityLabel="Zoom in"
            style={({ pressed }) => [
              styles.zoomButton,
              upright,
              zoom >= 1 && styles.zoomDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="add" size={24} color={colors.textPrimary} />
          </Pressable>

          {/* Only once it is doing something. A camera sitting at 0% is a
              camera, and saying so is noise over the picture. */}
          {zoom > 0 ? <Text style={[styles.zoomText, upright]}>{Math.round(zoom * 100)}%</Text> : null}

          <Pressable
            onPress={() => setZoom((current) => Math.max(0, current - ZOOM_STEP))}
            disabled={zoom <= 0}
            accessibilityRole="button"
            accessibilityLabel="Zoom out"
            style={({ pressed }) => [
              styles.zoomButton,
              upright,
              zoom <= 0 && styles.zoomDisabled,
              pressed && styles.pressed,
            ]}
          >
            <Ionicons name="remove" size={24} color={colors.textPrimary} />
          </Pressable>
        </View>
      ) : null}

      {/* Down the right edge and vertically centred, where a thumb already is.
          Icons only: the name is what a screen reader says, not what the glass
          shows — the same trade the tab bar makes, and here it buys the
          viewfinder the width back. */}
      <View style={[styles.rail, styles[modesEdge]]}>
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
              style={({ pressed }) => [
                styles.modeButton,
                upright,
                selected && styles.modeButtonOn,
                pressed && styles.pressed,
              ]}
            >
              <Ionicons name={option.icon} size={26} color={selected ? colors.onAccent : colors.textPrimary} />
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

        {/* Reversed rather than repositioned: the shutter stays dead centre
            under the thumb either way, and the flip button crosses to the same
            side the mode rail went to. */}
        <View style={[styles.controls, modesEdge === 'left' && styles.controlsReversed]}>
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

          {/* Bottom-right, under the mode rail rather than beside it: the rail
              is vertically centred, so the corner is clear, and both things a
              right hand reaches for are now on the same side. */}
          {needsCamera ? (
            <Pressable
              onPress={() => {
                setFacing(facing === 'back' ? 'front' : 'back');
                // The two lenses do not have the same range, so carrying a
                // position across means the front camera opens somewhere you
                // did not choose.
                setZoom(0);
              }}
              accessibilityRole="button"
              accessibilityLabel={facing === 'back' ? 'Switch to front camera' : 'Switch to back camera'}
              style={({ pressed }) => [styles.secondary, upright, pressed && styles.pressed]}
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
    left: 0,
    right: 0,
    alignItems: 'center',
  },
  /**
   * Vertically centred on the left edge: `top: 0, bottom: 0` and centred
   * content, so the rail sits where the thumb is however tall the phone is,
   * rather than at a hard offset that lands mid-screen on one device and under
   * the shutter on another.
   */
  rail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    gap: spacing.md,
  },
  /**
   * Which side each rail is pinned to, chosen at render from the orientation.
   *
   * Both offsets are set on every rail, one of them to `auto`: leaving the
   * other side merely unset keeps the value from the previous render in place,
   * so a rail that crossed over once ends up pinned to both edges and stretched
   * across the viewfinder.
   */
  left: { left: spacing.md, right: 'auto' },
  right: { right: spacing.md, left: 'auto' },
  modeButton: {
    width: 56,
    height: 56,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    // Its own backing, because what is behind it is a live image and an icon
    // alone disappears against a bright sky.
    backgroundColor: 'rgba(11,15,20,0.55)',
  },
  modeButtonOn: { backgroundColor: colors.manual },
  zoomRail: {
    position: 'absolute',
    top: 0,
    bottom: 0,
    justifyContent: 'center',
    alignItems: 'center',
    gap: spacing.sm,
  },
  zoomButton: {
    width: 52,
    height: 52,
    borderRadius: radius.pill,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: 'rgba(11,15,20,0.55)',
  },
  zoomDisabled: { opacity: 0.35 },
  zoomText: {
    ...typography.caption,
    color: colors.textPrimary,
    fontVariant: ['tabular-nums'],
    backgroundColor: 'rgba(11,15,20,0.55)',
    borderRadius: radius.pill,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    overflow: 'hidden',
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
  voiceStage: { alignItems: 'center', justifyContent: 'center', gap: spacing.sm },
  voiceTime: { ...typography.clock, color: colors.textSecondary },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingVertical: spacing.sm,
  },
  controlsReversed: { flexDirection: 'row-reverse' },
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
