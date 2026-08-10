import { requireOptionalNativeModule } from 'expo-modules-core';

/**
 * The JavaScript face of the local Swift module in `ios/`.
 *
 * `requireOptionalNativeModule`, like `camera-optics`: under Jest there is no
 * native runtime to bind to, and a media store that cannot be imported off a
 * device would take the whole test suite with it.
 *
 * Nothing here throws and nothing returns a promise. A capture must not fail
 * because a filesystem attribute could not be written — the honest outcome of
 * that is a photo that is backed up when it should not be, which is a privacy
 * regression and not a lost photograph. The two are not close in severity, and
 * the caller is written on that basis.
 */

interface FileBackupNative {
  setExcluded(uri: string, excluded: boolean): boolean;
}

const native = requireOptionalNativeModule<FileBackupNative>('FileBackup');

/**
 * Keep a directory and everything under it out of iCloud and iTunes backups.
 *
 * Returns whether the flag is set — `false` off a device, and `false` if the
 * path does not exist. Create it first.
 */
export function excludeFromBackup(uri: string): boolean {
  if (!native) return false;

  try {
    return native.setExcluded(uri, true);
  } catch {
    return false;
  }
}
