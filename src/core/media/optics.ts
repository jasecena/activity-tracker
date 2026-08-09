/**
 * Turning what AVFoundation says about the cameras into a zoom dial.
 *
 * The input is a plain description — zoom factors, switch-over points, fields
 * of view — produced by the native module and typed here independently, so this
 * file stays pure TypeScript and the arithmetic is testable on a machine with
 * no camera at all.
 *
 * Two number spaces, and the distinction runs through everything:
 *
 * - **Device factors** are what AVFoundation speaks: 1.0 is the widest lens of
 *   whichever device is running, and a virtual camera's switch-overs are in
 *   this space.
 * - **Display factors** are what the person holding the phone means: 1× is the
 *   main lens, the ultra-wide is 0.5×, the telephoto is 3× or 5×. The built-in
 *   camera prints these.
 *
 * On a virtual device whose first lens is the ultra-wide, the two differ by
 * exactly the wide lens's switch-over factor. Confusing them puts every number
 * on the dial out by 2×, which is why the conversion lives here, named, twice.
 */

export interface LensDescription {
  readonly localizedName: string;
  readonly deviceType: string;
  readonly fieldOfViewDeg: number;
}

export interface CameraDescription {
  readonly localizedName: string;
  readonly deviceType: string;
  readonly isVirtual: boolean;
  readonly videoMaxZoomFactor: number;
  readonly switchOverFactors: readonly number[];
  readonly constituents: readonly LensDescription[];
}

/** One position on the dial worth naming: a real lens, at its hand-off point. */
export interface DialStop {
  /** In display space: 0.5, 1, 3 — what the button says. */
  readonly display: number;
  /** In device space: what to ask AVFoundation for. */
  readonly factor: number;
  /** 35 mm-equivalent focal length, the `13MM` under the number. */
  readonly mm: number;
  readonly deviceType: string;
}

export interface DialSpec {
  /** The camera to hand to `selectedLens`, or null to leave the system's choice alone. */
  readonly cameraName: string | null;
  readonly stops: readonly DialStop[];
  /** Display-space bounds of the whole dial. */
  readonly minDisplay: number;
  readonly maxDisplay: number;
  /** Device-space factor per display unit — the wide lens's device factor. */
  readonly wideFactor: number;
}

/**
 * 35 mm-equivalent focal length from a horizontal field of view.
 *
 * The full-frame reference is 36 mm wide, so f = (36/2) / tan(fov/2). This is
 * the definition of the number printed on every camera spec sheet, which is
 * why it can be derived rather than looked up — and why it is right on phone
 * models that do not exist yet.
 */
export function focalLength35mm(fieldOfViewDeg: number): number {
  if (!Number.isFinite(fieldOfViewDeg) || fieldOfViewDeg <= 0 || fieldOfViewDeg >= 180) return 0;
  const radians = (fieldOfViewDeg * Math.PI) / 180;
  return 18 / Math.tan(radians / 2);
}

/**
 * The camera the dial should drive: the virtual device with the most lenses.
 *
 * A virtual device is the whole point — it changes lens as the factor crosses
 * a switch-over, which is what makes 0.5× to 6× one continuous drag. Preferring
 * the most constituents picks Triple over DualWide over Dual, whatever
 * combination this phone has. A phone with no virtual device (the front camera,
 * old hardware) falls back to whatever came first, and the dial simply has one
 * stop.
 */
export function pickDialCamera(cameras: readonly CameraDescription[]): CameraDescription | null {
  if (cameras.length === 0) return null;
  const virtual = cameras
    .filter((camera) => camera.isVirtual)
    .sort((a, b) => b.constituents.length - a.constituents.length);
  return virtual[0] ?? cameras[0] ?? null;
}

/**
 * Where each real lens takes over, in both number spaces.
 *
 * The first constituent is device factor 1 by definition; each later one
 * begins at the corresponding switch-over. The wide lens — display 1× — is the
 * first constituent whose device type is not the ultra-wide, which holds on
 * every arrangement Apple has shipped: the constituents of a virtual device
 * are ordered widest first.
 */
export function dialSpecFor(camera: CameraDescription | null): DialSpec | null {
  if (!camera) return null;

  const factors = camera.constituents.map((_, index) => (index === 0 ? 1 : (camera.switchOverFactors[index - 1] ?? 1)));

  const wideIndex = camera.constituents.findIndex((lens) => !lens.deviceType.includes('UltraWide'));
  const wideFactor = wideIndex > 0 ? (factors[wideIndex] ?? 1) : 1;

  const stops = camera.constituents.map((lens, index) => ({
    display: (factors[index] ?? 1) / wideFactor,
    factor: factors[index] ?? 1,
    mm: Math.round(focalLength35mm(lens.fieldOfViewDeg)),
    deviceType: lens.deviceType,
  }));

  return {
    cameraName: camera.localizedName,
    stops,
    minDisplay: 1 / wideFactor,
    // The hardware's ceiling is digital and enormous — 16× crops of a crop.
    // The dial ends at twice the last real lens instead: everything beyond it
    // is reachable but nothing beyond it is worth marking, and a dial whose
    // last labelled stop sits a tenth of the way along is unreadable.
    maxDisplay: Math.min(camera.videoMaxZoomFactor / wideFactor, 2 * (stops[stops.length - 1]?.display ?? 1)),
    wideFactor,
  };
}

/** Display space to device space: what to ask the hardware for. */
export function deviceFactorFor(spec: DialSpec, display: number): number {
  const clamped = Math.max(spec.minDisplay, Math.min(spec.maxDisplay, display));
  return clamped * spec.wideFactor;
}

/**
 * Where a drag lands, in display space, moving logarithmically.
 *
 * Logarithmic because that is how zoom feels linear: the step from 1× to 2×
 * and the step from 2× to 4× are the same size of change to the eye, and the
 * built-in camera spaces its dial exactly this way. A linear dial spends half
 * its length between the last two stops.
 *
 * Measured from where the gesture began, like the old dial and for the same
 * reason: accumulating per-move deltas drifts, and letting go and repeating
 * the same movement should give the same answer.
 */
export function displayFromDrag(spec: DialSpec, startedAtDisplay: number, dragBy: number, travel: number): number {
  const span = Math.log(spec.maxDisplay / spec.minDisplay);
  if (span <= 0) return spec.minDisplay;
  const startLog = Math.log(startedAtDisplay / spec.minDisplay) / span;
  const position = Math.max(0, Math.min(1, startLog + dragBy / travel));
  return spec.minDisplay * Math.exp(position * span);
}

/** The fraction of the dial's length where a display factor sits, 0 to 1. */
export function dialPositionOf(spec: DialSpec, display: number): number {
  const span = Math.log(spec.maxDisplay / spec.minDisplay);
  if (span <= 0) return 0;
  const clamped = Math.max(spec.minDisplay, Math.min(spec.maxDisplay, display));
  return Math.log(clamped / spec.minDisplay) / span;
}

/**
 * The focal length to print beside an arbitrary display factor.
 *
 * Between stops the phone is cropping, and a crop multiplies the equivalent
 * focal length linearly: 2× on the 24 mm main lens reads 48 mm, which is
 * exactly what the built-in camera prints there. The governing lens is the
 * last stop at or below the factor, so just past the telephoto hand-off the
 * number runs on from 77 rather than from 24.
 */
export function mmAt(spec: DialSpec, display: number): number {
  const governing = [...spec.stops].reverse().find((stop) => stop.display <= display) ?? spec.stops[0];
  if (!governing || governing.mm <= 0) return 0;
  return Math.round(governing.mm * (display / governing.display));
}

/**
 * What the big number on the dial says.
 *
 * The built-in camera's convention: below 1× one decimal ("0.5"), above it one
 * decimal until 10 then none, and the trailing ".0" never printed — "2", not
 * "2.0", because the decimal is information only when it is not zero.
 */
export function formatDisplayFactor(display: number): string {
  const rounded = display < 10 ? Math.round(display * 10) / 10 : Math.round(display);
  return `${rounded}`.replace(/\.0$/, '');
}
