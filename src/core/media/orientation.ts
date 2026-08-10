/**
 * Which way the phone was held, and what to do about it.
 *
 * The app is locked to portrait, so the interface never turns — and neither
 * does the frame the camera writes. Hold the phone sideways and you get a
 * portrait-shaped file with the world lying on its side, which is exactly what
 * was on the screen at the time and exactly not what you meant.
 *
 * Nothing here rewrites a capture. The bytes on disk stay as they were written;
 * a rotation is a property of *looking*, applied at the point of display and
 * nowhere else. That is the same instinct as the rest of the engine: the
 * timeline is never stored either, because a derived value that gets written
 * down is a value that can be wrong later.
 *
 * The same arithmetic turns the capture controls. A glyph on a portrait-locked
 * screen appears to lie on its side the moment the phone does, so it is turned
 * back by the same angle a photograph would be. One idea, one function, two
 * callers.
 */

/**
 * As `expo-camera` reports it, via `onResponsiveOrientationChanged`.
 *
 * This is the device's own orientation — the same signal the system status bar
 * uses — and it arrives even though the interface is locked. It is not a
 * gyroscope reading and needs no sensor permission, which is why this app can
 * have it without bringing `expo-sensors` back for one value.
 */
export type CaptureOrientation = 'portrait' | 'portraitUpsideDown' | 'landscapeLeft' | 'landscapeRight';

/** Clockwise, because that is the direction React Native's `rotate` turns. */
export type Degrees = 0 | 90 | 180 | 270;

const ORIENTATIONS: readonly CaptureOrientation[] = [
  'portrait',
  'portraitUpsideDown',
  'landscapeLeft',
  'landscapeRight',
];

export function isCaptureOrientation(candidate: unknown): candidate is CaptureOrientation {
  return typeof candidate === 'string' && (ORIENTATIONS as readonly string[]).includes(candidate);
}

/**
 * How far to turn something to undo the phone being turned.
 *
 * **The two landscape rows are a coin toss until a phone settles them.** iOS
 * has meant opposite things by "landscape left" in different frameworks —
 * `UIDeviceOrientation` names it for where the *home button* went,
 * `AVCaptureVideoOrientation` for where the top of the frame points — and the
 * documentation for this prop names neither. Swapping the two values below is
 * the whole fix if a sideways photograph comes out upside down, and
 * `orientation.test.ts` asserts only what stays true either way: that they are
 * opposite quarter turns.
 *
 * Everything else is not a guess. Upside-down is half a turn whichever
 * convention applies, and upright is no turn at all.
 */
const UPRIGHT: Readonly<Record<CaptureOrientation, Degrees>> = {
  portrait: 0,
  portraitUpsideDown: 180,
  landscapeLeft: 90,
  landscapeRight: 270,
};

/**
 * Null is upright, deliberately.
 *
 * Every capture taken before this was recorded has no orientation on it, and
 * the overwhelming majority of them were taken the normal way up. Treating
 * "unknown" as "portrait" leaves those exactly as they are today; treating it
 * as anything else would turn a library of correct photographs sideways.
 */
export function uprightRotationFor(orientation: CaptureOrientation | null): Degrees {
  return orientation ? UPRIGHT[orientation] : 0;
}

/**
 * `expo-camera` turns the pixels itself. Settled on a phone, not guessed.
 *
 * The documentation would not answer it — `responsiveOrientationWhenOrientationLocked`
 * is described as making the camera "responsive" while the interface is
 * locked, and a note elsewhere on the same page says photos are rotated to
 * match the device, without saying whether that survives the lock. Jest mocks
 * every native module and Expo Go will not run this app, so the only way to
 * know was to take a photograph sideways and look at it.
 *
 * What that photograph showed: the picture came out **ninety degrees** off,
 * not a hundred and eighty. That distinction is the whole answer. A hundred
 * and eighty would have meant the two landscape rows below were the wrong way
 * round; ninety means the rotation was applied to a file that was already
 * upright — so the camera had done it, and we did it again.
 *
 * With this `true` the display turns nothing. The orientation is still
 * recorded, because it is a fact about the capture worth having, and the
 * controls still turn, because the *screen* is locked whatever the file does.
 */
export const CAMERA_WRITES_UPRIGHT_PIXELS = true;

/** How far to turn a stored capture when showing it, and never when storing it. */
export function displayRotationFor(orientation: CaptureOrientation | null): Degrees {
  return CAMERA_WRITES_UPRIGHT_PIXELS ? 0 : uprightRotationFor(orientation);
}

export function isQuarterTurn(degrees: Degrees): boolean {
  return degrees === 90 || degrees === 270;
}

/** Which side of a portrait-locked screen something should be pinned to. */
export type Edge = 'left' | 'right';

/**
 * The edge that is uppermost once the phone is turned.
 *
 * The capture controls live down the two long edges, and turning the phone
 * turns those edges into the top and the bottom. Which is which follows
 * directly from the rotation: the screen's right-hand edge points upward when
 * the phone has been turned anticlockwise, and downward when it has been turned
 * clockwise, so the rail crosses to the other side to stay on top.
 *
 * Upside-down portrait is the same argument with both edges swapped, which is
 * why the rule is "less than half a turn" rather than a special case for
 * landscape.
 *
 * This inherits the landscape coin toss above, and that is a feature: if the
 * rails end up on the bottom edge on a real phone, the same one-line swap in
 * `UPRIGHT` fixes the rails and the photographs together, because there is only
 * one fact here and both read it.
 */
export function topEdgeFor(orientation: CaptureOrientation | null): Edge {
  const turned = uprightRotationFor(orientation);
  return turned === 0 || turned === 90 ? 'right' : 'left';
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

/**
 * The box to draw a capture in before turning it.
 *
 * A quarter turn happens about the centre and does not resize anything, so a
 * portrait-shaped view rotated 90° is a portrait-shaped view lying down — tall
 * where the screen is narrow, and letterboxed to a ribbon down the middle.
 * Handing it the screen's dimensions the other way round first is what makes
 * the turned result fill the screen properly.
 *
 * A half turn needs none of this, which is why it is not simply "swap when the
 * angle is not zero".
 */
export function stageSizeFor(screen: Size, degrees: Degrees): Size {
  return isQuarterTurn(degrees) ? { width: screen.height, height: screen.width } : screen;
}
