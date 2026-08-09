import { describeCameras, getZoomFactor, setZoomFactor } from '../../modules/camera-optics';

import type { CameraDescription } from '@/core/media';

/**
 * The cameras as they actually are, from the local Swift module.
 *
 * The first native code in this repository, and it lives in `modules/` rather
 * than in a package because it is one file answering one question. Everything
 * numeric — which lens is 1×, where the switch-overs sit, what 24 mm means —
 * happens in `core/media/optics.ts` where it can be tested; this file only
 * ferries plain descriptions across and re-asks when the session changes.
 *
 * Everything degrades to "the phone would not say": a simulator has no
 * cameras, Jest has no native runtime, and the dial already treats an empty
 * answer as a dial with nothing on it.
 */

export async function describeBackCameras(): Promise<readonly CameraDescription[]> {
  return describeCameras('back');
}

export async function describeFrontCameras(): Promise<readonly CameraDescription[]> {
  return describeCameras('front');
}

/**
 * Set the zoom on a named camera, as a device-space factor.
 *
 * Ramped: the hardware moves the zoom like glass rather than stepping it,
 * which is the feel the built-in camera has and a `zoom` prop cannot give.
 * Writing to the device `expo-camera` is running is safe by design —
 * `AVCaptureDevice` instances are per-hardware singletons and
 * `lockForConfiguration` is the documented handshake.
 */
export async function rampZoomTo(cameraName: string, deviceFactor: number): Promise<void> {
  return setZoomFactor(cameraName, deviceFactor, true);
}

/** Where the zoom actually is, for settling the dial after a ramp. */
export async function readZoomFactor(cameraName: string): Promise<number | null> {
  return getZoomFactor(cameraName);
}
