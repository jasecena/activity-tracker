import { Ionicons } from '@expo/vector-icons';
import { CameraView, useCameraPermissions, useMicrophonePermissions, type CameraType } from 'expo-camera';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { formatDuration } from '@/core/format';
import {
  dialSpecFor,
  formatDisplayFactor,
  pickDialCamera,
  zoomPropFor,
  topEdgeFor,
  uprightRotationFor,
  type CaptureOrientation,
  type DialSpec,
  type MediaKind,
} from '@/core/media';
import type { Fix } from '@/core/geo';
import { now as readNow } from '@/services/clock';
import { ensureForegroundPermission } from '@/services/location';
import { describeBackCameras, describeFrontCameras } from '@/services/optics';
import { askPosition } from '@/services/position';
import { holdScreenAwake, releaseScreenAwake } from '@/services/wakefulness';
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
 * A minute, and the reason has changed.
 *
 * It used to be the encryption: the bytes were sealed on the way in and
 * decrypted again to play, and both passes are something you would wait for at
 * ten minutes. Neither pass exists now — a capture is a rename. What is left is
 * a diary's own judgement about what a capture is for, a clip attached to a
 * moment rather than a recording session, plus a disk budget with no ceiling if
 * nothing bounds it. That is a weaker argument than the old one and
 * `docs/ARCHITECTURE.md` § 12b says so; it is the one to revisit if the segment
 * model in `docs/BACKLOG.md` is built, since pause and resume make "how long is
 * one clip" a different question.
 */
const MAX_VIDEO_SECONDS = 60;

/**
 * Two, and the third has moved rather than gone.
 *
 * A voice note lives on the Day screen now, beside the button for writing one.
 * Saying something aloud about a day and typing it are the same act with
 * different hands, and a voice note has no viewfinder — putting it here meant
 * opening a camera you were going to ignore and then finding a third mode
 * behind it. `useVoiceNote` holds what this screen used to.
 */
type Mode = 'photo' | 'video';

const MODES: readonly { readonly key: Mode; readonly label: string; readonly icon: keyof typeof Ionicons.glyphMap }[] =
  [
    { key: 'photo', label: 'Photo', icon: 'camera-outline' },
    { key: 'video', label: 'Video', icon: 'videocam-outline' },
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

  /**
   * What the cameras on this side of the phone actually are, and where the
   * zoom is in *display* space — the space where the main lens is 1× and the
   * ultra-wide is 0.5×, which is the only space a person thinks in.
   *
   * Null spec means the phone would not say: a simulator, a test, or the
   * module missing. The viewfinder still works; there is simply no wheel.
   */
  const [dial, setDial] = useState<DialSpec | null>(null);
  /** Which stop the camera is on, in display space — 0.5, 1 or 3. */
  const [displayZoom, setDisplayZoom] = useState(1);
  const [cameraPermission, requestCamera] = useCameraPermissions();
  const [microphonePermission, requestMicrophone] = useMicrophonePermissions();

  // The camera handle is imperative by nature — `takePictureAsync` is a method
  // on the view. Nothing rendered reads it, which is what the refs rule cares
  // about.
  const camera = useRef<CameraView | null>(null);

  const needsCamera = true;
  const needsMicrophone = mode === 'video';

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

  /**
   * What the cameras on this side of the phone are, asked from AVFoundation.
   *
   * The dial's camera is the *virtual* device — Triple on a Pro, Dual Wide on
   * the rest — because that is the one that changes lens as the factor crosses
   * a switch-over, which is what makes 0.5× to 6× one continuous drag. The
   * default device is the plain wide lens, which cannot reach the ultra-wide
   * at all; selecting the virtual one is the difference between this dial and
   * a crop slider.
   *
   * Zoom starts at 1×, the main lens, whatever the device's own space calls
   * it. Flipping the camera re-describes and lands back at 1× for the same
   * reason it always reset: the two sides do not share a range.
   */
  useEffect(() => {
    if (!visible || !needsCamera) return;
    let live = true;
    void (async () => {
      const cameras = facing === 'back' ? await describeBackCameras() : await describeFrontCameras();
      if (!live) return;
      const spec = dialSpecFor(pickDialCamera(cameras));
      setDial(spec);
      // Back to the main lens: the two sides do not share a range.
      setDisplayZoom(1);
    })();
    return () => {
      live = false;
    };
    // `mode` is in here because photo and video run different capture formats,
    // and `activeFormat.videoMaxZoomFactor` is the base of the exponent the
    // zoom prop is raised to. Read it under one format and apply it under
    // another and the glass lands somewhere the label does not claim —
    // reported as a wheel reading 3 while the picture looked like 2.8.
  }, [visible, needsCamera, facing, mode]);

  /**
   * The screen stays on while a capture is in progress.
   *
   * Reported from a phone: start recording, put it down, and half a minute
   * later the display sleeps, the phone locks and the clip is cut off. Nothing
   * about a camera preview counts as user activity, so a recording made without
   * touching the screen looks to iOS exactly like a phone left alone.
   *
   * `busy` rather than the state itself, so moving from recording to sealing
   * does not drop the lock and take it again — the pause between the two is
   * precisely where the phone would lock. Sealing is covered for the same
   * reason it warns you to keep the app open: suspension mid-write leaves the
   * capture staged rather than stored.
   */
  const busy = state !== 'idle';
  useEffect(() => {
    if (!busy) return;
    void holdScreenAwake();
    return () => {
      void releaseScreenAwake();
    };
  }, [busy]);

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
    // Nothing else to do here. `recordAsync` resolves once the hardware has
    // stopped, and the `store` that follows clears the clock in its `finally` —
    // which is also why this is not the place to clear it: the app has not
    // stopped recording until the camera says so.
  }, [visible, state]);

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

  return (
    <View style={styles.screen}>
      {/* The viewfinder is the screen, not a panel on it. */}
      {needsCamera && visible ? (
        <CameraView
          ref={camera}
          style={StyleSheet.absoluteFill}
          facing={facing}
          /**
           * The zoom, through the camera's own prop and never past it.
           *
           * The first build wrote the factor to the device natively — exact,
           * rampable, and wrong: expo-camera resets the device's zoom every
           * time the session configures, and the session queue races direct
           * writes in between. Reported from a phone as a wheel that shook
           * without zooming. The prop's mapping is exponential and the module
           * reports its base, so `zoomPropFor` inverts it exactly — the camera
           * applies our factor itself, on its own queue, on the device its
           * session actually holds, including at every reconfigure.
           */
          zoom={dial ? zoomPropFor(dial, displayZoom) : 0}
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
          /**
           * The virtual multi-lens camera, chosen from AVFoundation's own
           * description. The default device is the bare wide lens, which
           * cannot reach the ultra-wide at all — selecting the virtual one is
           * what makes the wheel's 0.5× end exist.
           */
          selectedLens={dial?.cameraName ?? undefined}
          /**
           * Re-described once the session runs: the zoom prop's exponent base
           * is the *running* format's ceiling, and the value read before the
           * session existed can differ from it. The stops are recomputed from
           * the live answer so tapping "3" lands on the telephoto, not near it.
           */
          onCameraReady={() => {
            void (async () => {
              const cameras = facing === 'back' ? await describeBackCameras() : await describeFrontCameras();
              const spec = dialSpecFor(pickDialCamera(cameras));
              if (spec) setDial(spec);
            })();
          }}
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

        {/* Each real lens, as a stop the wheel snaps to — the built-in
            camera's pills. Tap 0.5, 1 or 3 and the glass ramps there; the
            wheel is the fine control between them. These replace the named
            lens rail: with the virtual camera driving, "which lens" and
            "how far in" are the same dial, and the phone changes lens itself
            as the factor crosses a hand-off.

            Not locked while recording. The virtual device switches lenses
            without rebuilding the session, which is precisely what it is for
            — the built-in camera does the same mid-clip. */}
        {needsCamera && dial && dial.stops.length > 1 ? (
          <View style={styles.stopRow}>
            {dial.stops.map((stop) => {
              const chosen = Math.abs(displayZoom - stop.display) < 0.05;
              return (
                <Pressable
                  key={stop.deviceType}
                  onPress={() => setDisplayZoom(stop.display)}
                  accessibilityRole="button"
                  accessibilityLabel={`Zoom to ${formatDisplayFactor(stop.display)}x, ${stop.mm} millimetres`}
                  style={({ pressed }) => [
                    styles.stopPill,
                    upright,
                    chosen && styles.stopPillOn,
                    pressed && styles.pressed,
                  ]}
                >
                  <Text style={[styles.stopText, chosen && styles.stopTextOn]}>
                    {formatDisplayFactor(stop.display)}x
                  </Text>
                </Pressable>
              );
            })}
          </View>
        ) : null}

        {/* Reversed rather than repositioned: the shutter stays dead centre
            under the thumb either way, and the flip button crosses to the same
            side the mode rail went to. */}
        <View style={[styles.controls, modesEdge === 'left' && styles.controlsReversed]}>
          <View style={styles.secondaryPlaceholder} />

          <Pressable
            onPress={() => {
              if (mode === 'photo') void takePhoto();
              else void toggleVideo();
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
                // The describe effect re-runs on the new facing and lands the
                // dial back at 1× — the two sides do not share a range, so
                // carrying a factor across would open somewhere nobody chose.
                setFacing(facing === 'back' ? 'front' : 'back');
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
  return state === 'recording' ? 'Stop video' : 'Start video';
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
  stopRow: { flexDirection: 'row', justifyContent: 'center', gap: spacing.xs, paddingBottom: spacing.xs },
  stopPill: {
    minWidth: 40,
    paddingHorizontal: spacing.sm,
    paddingVertical: 6,
    borderRadius: radius.pill,
    alignItems: 'center',
    backgroundColor: 'rgba(11,15,20,0.55)',
  },
  stopPillOn: { backgroundColor: 'rgba(11,15,20,0.8)' },
  stopText: { ...typography.caption, color: colors.textPrimary, fontVariant: ['tabular-nums'] },
  stopTextOn: { color: colors.manual, fontWeight: '700' },
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
