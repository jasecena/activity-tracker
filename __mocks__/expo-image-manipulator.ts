import { File, Paths } from 'expo-file-system';

/**
 * Image scaling, off-device.
 *
 * There is no image pipeline on a Linux runner, so this records what was asked
 * for and writes a small file at the destination. That is enough for the only
 * question a test here can answer: did a thumbnail get made, sealed, and kept
 * apart from the capture it came from.
 */
export enum SaveFormat {
  JPEG = 'jpeg',
  PNG = 'png',
  WEBP = 'webp',
}

let count = 0;

export const ImageManipulator = {
  manipulate: jest.fn((uri: string) => ({
    uri,
    resize: jest.fn(function (this: unknown) {
      return this;
    }),
    rotate: jest.fn(function (this: unknown) {
      return this;
    }),
    renderAsync: jest.fn(async () => ({
      saveAsync: jest.fn(async () => {
        const scaled = new File(Paths.cache, `scaled-${++count}.jpg`);
        // Deliberately not empty: a zero-byte thumbnail would seal and open
        // without complaint and prove nothing.
        scaled.write(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]));
        return { uri: scaled.uri, width: 240, height: 180 };
      }),
    })),
  })),
};

export function __reset(): void {
  count = 0;
}
