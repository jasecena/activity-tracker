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
}

let captureCount = 0;

export const takePictureAsync = jest.fn(async () => ({
  uri: `file:///mock/cache/capture-${++captureCount}.jpg`,
  width: 1440,
  height: 1920,
}));

export const recordAsync = jest.fn(async () => ({ uri: `file:///mock/cache/capture-${++captureCount}.mov` }));

export const stopRecording = jest.fn(() => undefined);

export const CameraView = jest.fn((props: Record<string, unknown> & { ref?: Ref<MockCameraView> }) => {
  const { ref, ...rest } = props;
  if (typeof ref === 'function') ref({ takePictureAsync, recordAsync, stopRecording });
  else if (ref && typeof ref === 'object') {
    (ref as { current: MockCameraView | null }).current = { takePictureAsync, recordAsync, stopRecording };
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
}
