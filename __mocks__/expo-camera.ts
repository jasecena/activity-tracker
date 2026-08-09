/**
 * The camera, off-device.
 *
 * Permissions default to granted, like the location mock, because that is the
 * state most tests want to start from. `takePictureAsync` and `recordAsync`
 * return URIs into the mock filesystem so the capture path can be followed all
 * the way into the media store without a real file existing anywhere.
 */
import { createElement, type Ref } from 'react';
import { View } from 'react-native';

export interface MockCameraView {
  takePictureAsync: (options?: unknown) => Promise<{ uri: string; width: number; height: number }>;
  recordAsync: (options?: unknown) => Promise<{ uri: string }>;
  stopRecording: () => void;
  getAvailableLensesAsync: () => Promise<string[]>;
}

/**
 * Three back lenses, like a recent phone.
 *
 * Settable, because "one lens" is the case where the rail should not be drawn
 * at all — the front camera on every phone — and a mock that could only be a
 * Pro model would never exercise it.
 */
let lenses: string[] = ['builtInWideAngleCamera', 'builtInUltraWideCamera', 'builtInTelephotoCamera'];

export const getAvailableLensesAsync = jest.fn(async () => lenses);

export function __setLenses(next: string[]): void {
  lenses = next;
}

let captureCount = 0;

export const takePictureAsync = jest.fn(async () => ({
  uri: `file:///mock/cache/capture-${++captureCount}.jpg`,
  width: 1440,
  height: 1920,
}));

/**
 * Resolves when recording *stops*, never before — which is the whole contract.
 *
 * A mock that resolved immediately is why a real bug shipped: the screen
 * awaited this promise and cleared its "recording" flag in a `finally`, so the
 * button stayed lit for the entire time the clip was being sealed. On a phone
 * that is seconds of a Stop button that looks dead. Modelling the real
 * behaviour is what lets a test see it.
 */
let finishRecording: ((clip: { uri: string }) => void) | null = null;

export const recordAsync = jest.fn(
  () =>
    new Promise<{ uri: string }>((resolve) => {
      finishRecording = resolve;
    }),
);

export const stopRecording = jest.fn(() => {
  finishRecording?.({ uri: `file:///mock/cache/capture-${++captureCount}.mov` });
  finishRecording = null;
});

export const CameraView = jest.fn((props: Record<string, unknown> & { ref?: Ref<MockCameraView> }) => {
  const { ref, ...rest } = props;
  if (typeof ref === 'function') ref({ takePictureAsync, recordAsync, stopRecording, getAvailableLensesAsync });
  else if (ref && typeof ref === 'object') {
    (ref as { current: MockCameraView | null }).current = {
      takePictureAsync,
      recordAsync,
      stopRecording,
      getAvailableLensesAsync,
    };
  }
  return createElement(View, { accessibilityLabel: 'Camera preview', ...rest }, null);
});

const GRANTED = { status: 'granted', granted: true, canAskAgain: true, expires: 'never' as const };

export const useCameraPermissions = jest.fn(() => [
  GRANTED,
  jest.fn(async () => GRANTED),
  jest.fn(async () => GRANTED),
]);
export const useMicrophonePermissions = jest.fn(() => [
  GRANTED,
  jest.fn(async () => GRANTED),
  jest.fn(async () => GRANTED),
]);

export function __reset(): void {
  captureCount = 0;
  finishRecording = null;
  lenses = ['builtInWideAngleCamera', 'builtInUltraWideCamera', 'builtInTelephotoCamera'];
}
