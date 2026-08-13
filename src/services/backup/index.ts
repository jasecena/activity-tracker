import * as Crypto from 'expo-crypto';

import { sealWithSalt } from './seal';

export { backupKeyFrom, sealedLength, CHUNK_BYTES, KDF, MAGIC, VERSION } from './seal';

/**
 * Seal one object for the bucket, with a salt nothing else will ever see.
 *
 * The one place entropy enters this feature, and the reason `seal.ts` takes the
 * salt as a parameter rather than drawing it: that file then imports nothing
 * belonging to the phone, so the format check can run the real implementation
 * against the real Python script instead of a copy of each.
 *
 * A fresh salt per object is not a nicety. Reusing one reuses the file key,
 * which reuses the counter nonces inside it, which is the single mistake that
 * would unravel every guarantee here — so it is drawn in exactly one place and
 * never passed around.
 */
export function sealObject(backupKey: Uint8Array, plaintext: Uint8Array): Uint8Array {
  return sealWithSalt(backupKey, plaintext, Crypto.getRandomBytes(16));
}
