import { describeCameras } from '../../modules/camera-optics';

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
 * **Reading is all it does.** The module used to set the zoom on the device as
 * well, by factor and with a hardware ramp, because that is how the built-in
 * camera makes zoom feel like glass moving. That went with the wheel it was
 * built for: three buttons drive `expo-camera`'s own `zoom` prop through
 * `zoomPropFor`, and nothing asks the device for anything but its description.
 * The argument for writing to the device is in the git history if a gesture
 * ever wants it back.
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
