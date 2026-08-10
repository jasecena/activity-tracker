import AsyncStorage from '@react-native-async-storage/async-storage';
import * as FileSystem from 'expo-file-system';
import { Directory, File, Paths } from 'expo-file-system';

import { eraseEverything, STORAGE_KEYS } from '../storage';
import { seal } from '../vault';

/** The in-memory filesystem's seeding hook — see the note in `mediaStore.test.ts`. */
const { __seed } = FileSystem as unknown as typeof import('../../../__mocks__/expo-file-system');

/**
 * What "erase everything" has to guarantee, and the one thing about it that is
 * not obvious from reading the function.
 *
 * The order of the three steps is load-bearing, and it is the reverse of what
 * it used to be. While media was sealed under the vault key, destroying the key
 * first meant a crash halfway through left ciphertext. Media is now ordinary
 * files, so destroying the key does nothing to a photograph — the plaintext has
 * to go first, because ordering can only ever protect what is not already
 * protected.
 *
 * Asserting on the *order* rather than only on the end state is the point: both
 * orders erase everything when nothing interrupts them, so a test of the final
 * state passes just as happily with the dangerous one.
 */

const mediaDirectory = () => new Directory(Paths.document, 'media');

describe('erase everything', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    const directory = mediaDirectory();
    if (!directory.exists) directory.create({ intermediates: true });
  });

  it('removes stored rows, the archive and the media directory', async () => {
    await AsyncStorage.setItem(STORAGE_KEYS.settings, await seal('{}'));
    await AsyncStorage.setItem(`${STORAGE_KEYS.fixArchive}2026-08-09`, await seal('[]'));
    __seed(new File(mediaDirectory(), 'm-1.jpg').uri, new Uint8Array([1, 2, 3]));

    await eraseEverything();

    expect(await AsyncStorage.getAllKeys()).toEqual([]);
    expect(mediaDirectory().exists).toBe(false);
  });

  it('deletes the plaintext media before it destroys the key', async () => {
    __seed(new File(mediaDirectory(), 'm-1.jpg').uri, new Uint8Array([1, 2, 3]));

    // The key is what `seal` writes through, so a store write is the cheapest
    // observation point for "the key is still live". Recording whether the
    // media survives at that instant is the whole assertion.
    let mediaStillOnDisk: boolean | null = null;
    const setItem = jest.spyOn(AsyncStorage, 'multiRemove').mockImplementation(async () => {
      mediaStillOnDisk = mediaDirectory().exists;
    });

    await eraseEverything();

    expect(mediaStillOnDisk).toBe(false);
    setItem.mockRestore();
  });

  it('leaves nothing behind when there is nothing to erase', async () => {
    const directory = mediaDirectory();
    if (directory.exists) directory.delete();

    await expect(eraseEverything()).resolves.toBeUndefined();
  });
});
