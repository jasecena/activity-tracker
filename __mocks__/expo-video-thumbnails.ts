import { File, Paths } from 'expo-file-system';

/**
 * Pulling a frame out of a video, off-device.
 *
 * Writes a stand-in frame into the mock filesystem so the thumbnail path can
 * be followed end to end without a video decoder.
 */
export const getThumbnailAsync = jest.fn(async (sourceUri: string) => {
  const frame = new File(Paths.cache, `frame-${sourceUri.split('/').pop() ?? 'clip'}.jpg`);
  frame.write(new Uint8Array([9, 9, 9, 9]));
  return { uri: frame.uri, width: 1920, height: 1080 };
});
