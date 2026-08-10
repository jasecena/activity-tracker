/**
 * Recording and playback, off-device.
 *
 * The recorder is a small state machine rather than a bag of no-ops, because
 * the thing worth asserting about a voice note is the order: prepare, record,
 * stop, and only then is there a `uri` to hand to the media store.
 */
export const RecordingPresets = {
  HIGH_QUALITY: { extension: '.m4a', sampleRate: 44100, bitRate: 128000 },
  LOW_QUALITY: { extension: '.m4a', sampleRate: 22050, bitRate: 64000 },
};

let recordingCount = 0;

export interface MockAudioRecorder {
  uri: string | null;
  isRecording: boolean;
  prepareToRecordAsync: () => Promise<void>;
  record: () => void;
  stop: () => Promise<void>;
}

export const useAudioRecorder = jest.fn((): MockAudioRecorder => recorder);

const recorder: MockAudioRecorder = {
  uri: null,
  isRecording: false,
  prepareToRecordAsync: jest.fn(async () => {
    recorder.uri = null;
  }),
  record: jest.fn(() => {
    recorder.isRecording = true;
  }),
  stop: jest.fn(async () => {
    recorder.isRecording = false;
    recorder.uri = `file:///mock/cache/voice-${++recordingCount}.m4a`;
  }),
};

export const useAudioRecorderState = jest.fn(() => ({
  isRecording: recorder.isRecording,
  durationMillis: recorder.isRecording ? 1_000 : 0,
}));

export const useAudioPlayer = jest.fn(() => ({
  play: jest.fn(),
  pause: jest.fn(),
  seekTo: jest.fn(async () => undefined),
  remove: jest.fn(),
  playing: false,
  duration: 0,
  currentTime: 0,
}));

export const setAudioModeAsync = jest.fn(async () => undefined);

export const AudioModule = {
  requestRecordingPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
  getRecordingPermissionsAsync: jest.fn(async () => ({ status: 'granted', granted: true })),
};

export function __reset(): void {
  recordingCount = 0;
  recorder.uri = null;
  recorder.isRecording = false;
}
