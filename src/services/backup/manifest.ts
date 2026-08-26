import { utf8ToBytes } from '@noble/ciphers/utils.js';

import { KDF } from './seal';

/**
 * What a bucket is told about itself, in plaintext.
 *
 * The salt, so a laptop — or the machine at home — can put the passphrase its
 * owner typed through the same scrypt and arrive at the same key. Without it up
 * there nothing in the bucket can ever be opened again, and the bucket is a
 * receipt rather than a backup.
 *
 * **One builder for both buckets, and that is the point.** This used to be two
 * private copies, one in `useBackup` and one in `usePlanSync`, differing only in
 * which salt they read. Two functions claiming to write the same document is the
 * drift that ends with one bucket's manifest carrying a `kdf` the other stopped
 * using — and a manifest that disagrees with the bytes beside it fails at the
 * far end, on somebody's laptop, months later.
 *
 * The salt is a parameter rather than a `Settings` read for the same reason the
 * fingerprint is one in `plansToSend`: which salt belongs to which bucket is the
 * caller's business, and getting it wrong is exactly the mistake worth making
 * hard to write. `usePlanSync` says in full why publishing the backup's salt in
 * the plans bucket would be the wrong kind of harmless.
 */
export function manifestBytes(saltHex: string): Uint8Array {
  return utf8ToBytes(JSON.stringify({ version: 1, salt: saltHex, kdf: KDF }, null, 2));
}

/** Where it goes, in either bucket. Fixed: every reader agrees on it. */
export const MANIFEST_KEY = 'manifest.json';
