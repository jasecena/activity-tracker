import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * The JavaScript face of the local Swift module in `ios/`.
 *
 * `requireOptionalNativeModule`, not `requireNativeModule`: under Jest there is
 * no native runtime at all, and the app must render a viewfinder without a
 * dial rather than crash on import. Everything here degrades to "the phone
 * would not say" — which the dial already has to handle, because a simulator
 * has no cameras either.
 */

export interface ConstituentLens {
  readonly localizedName: string;
  readonly deviceType: string;
  /** Horizontal field of view, degrees, from the lens's active format. */
  readonly fieldOfViewDeg: number;
}

export interface DeviceDescription {
  readonly localizedName: string;
  readonly deviceType: string;
  /** True for the multi-lens devices that switch between real lenses as the zoom moves. */
  readonly isVirtual: boolean;
  readonly videoMaxZoomFactor: number;
  /** Where a virtual device changes lens, in its own zoom-factor space. Empty for a physical lens. */
  readonly switchOverFactors: readonly number[];
  readonly constituents: readonly ConstituentLens[];
}

interface CameraOpticsNative {
  describe(position: 'back' | 'front'): Promise<DeviceDescription[]>;
  setZoomFactor(localizedName: string, factor: number, ramped: boolean): Promise<void>;
  getZoomFactor(localizedName: string): Promise<number>;
}

const native = requireOptionalNativeModule<CameraOpticsNative>('CameraOptics');

export async function describeCameras(position: 'back' | 'front'): Promise<readonly DeviceDescription[]> {
  if (!native) return [];
  try {
    return await native.describe(position);
  } catch {
    return [];
  }
}

/** Set the zoom by factor, ramped so it moves like glass rather than stepping. */
export async function setZoomFactor(localizedName: string, factor: number, ramped = true): Promise<void> {
  if (!native) return;
  try {
    await native.setZoomFactor(localizedName, factor, ramped);
  } catch {
    // A zoom that did not move is visible on the glass; a crash over it would
    // take the viewfinder down with it.
  }
}

export async function getZoomFactor(localizedName: string): Promise<number | null> {
  if (!native) return null;
  try {
    return await native.getZoomFactor(localizedName);
  } catch {
    return null;
  }
}
