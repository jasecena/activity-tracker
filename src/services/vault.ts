import { xchacha20poly1305 } from '@noble/ciphers/chacha.js';
import { bytesToHex, bytesToUtf8, concatBytes, hexToBytes, utf8ToBytes } from '@noble/ciphers/utils.js';
import * as Crypto from 'expo-crypto';
import * as SecureStore from 'expo-secure-store';

/**
 * Encryption at rest, for a file that is a record of everywhere its owner goes.
 *
 * The threat this addresses is not a determined attacker with the unlocked
 * phone in their hand — against that, nothing an app does helps. It is the
 * ordinary ways a file leaks: an iCloud or iTunes backup, a device handed on, a
 * forensic extraction, a future bug in some other app that can read the
 * container. A year of location history is the most sensitive thing most people
 * carry, and it should not sit in a plaintext JSON blob under Documents.
 *
 * **The key never leaves this device and is never derived from anything
 * guessable.** Thirty-two bytes from the system CSPRNG on first launch, stored
 * in the iOS keychain. `THIS_DEVICE_ONLY` keeps it out of every backup, which
 * means a restored backup of this app contains ciphertext and no way to read
 * it. That is the intended outcome: the diary does not travel.
 *
 * **`AFTER_FIRST_UNLOCK`, deliberately, not `WHEN_UNLOCKED`.** Location arrives
 * in the background while the phone is locked in a pocket — which is most of
 * what this app records. A key that is unreadable while locked would mean the
 * background task cannot write, and the day would have a hole in it for every
 * hour the phone was not in your hand. After-first-unlock is the strongest
 * class that is actually compatible with background capture.
 *
 * **XChaCha20-Poly1305**, from `@noble/ciphers`: audited, pure TypeScript, and
 * therefore no native module in the build. Its 24-byte nonce is large enough to
 * be drawn at random for every single write without birthday-bound worries,
 * which removes the one thing implementations of AES-GCM most often get wrong.
 * Poly1305 also makes it authenticated: a truncated or tampered file fails to
 * decrypt rather than parsing into something that looks like a day.
 */

const KEY_ALIAS = 'activity-tracker.vault-key.v1';
const KEY_BYTES = 32;
const NONCE_BYTES = 24;

/** Marks a stored blob as ours, and which format it is in. */
const ENVELOPE_PREFIX = 'v1:';

let cachedKey: Uint8Array | null = null;
let keyRequest: Promise<Uint8Array> | null = null;

/**
 * The device key, created on first use.
 *
 * Requests are coalesced through `keyRequest`. Without it, the first render and
 * the background task can race into generating two keys, the second overwriting
 * the first — and everything written before that moment becomes permanently
 * unreadable.
 */
async function deviceKey(): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;
  if (keyRequest) return keyRequest;

  keyRequest = (async () => {
    const existing = await SecureStore.getItemAsync(KEY_ALIAS, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    if (existing) {
      cachedKey = hexToBytes(existing);
      return cachedKey;
    }

    const fresh = Crypto.getRandomBytes(KEY_BYTES);
    await SecureStore.setItemAsync(KEY_ALIAS, bytesToHex(fresh), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    cachedKey = fresh;
    return fresh;
  })();

  try {
    return await keyRequest;
  } finally {
    keyRequest = null;
  }
}

/**
 * Encrypt a string for storage. Output is `v1:<hex nonce||ciphertext>`.
 *
 * Hex rather than base64. It costs 50% more bytes on disk, and it does not
 * depend on `btoa`/`atob` existing as globals — which they do in some React
 * Native runtimes and not others, and a missing one here would be a crash on
 * first launch rather than a test failure.
 */
export async function seal(plaintext: string): Promise<string> {
  const key = await deviceKey();
  // A fresh nonce for every write. Reusing one with the same key is the single
  // catastrophic mistake available in an AEAD, and at 24 bytes random is safe.
  const nonce = Crypto.getRandomBytes(NONCE_BYTES);
  const ciphertext = xchacha20poly1305(key, nonce).encrypt(utf8ToBytes(plaintext));

  return `${ENVELOPE_PREFIX}${bytesToHex(concatBytes(nonce, ciphertext))}`;
}

/**
 * Seal raw bytes: `nonce || ciphertext`, and no envelope prefix.
 *
 * The string form above is for values that go through `JSON.stringify` into
 * AsyncStorage, where hex and a version tag are worth their cost. This one is
 * for a photo or a minute of video, where hex would add 50% to a file measured
 * in megabytes and there is a container — `services/mediaStore.ts` — that
 * already carries the version.
 *
 * A fresh nonce per call, as ever. Sealing 1 MiB chunks of one video means
 * several nonces for the same key in a few milliseconds, which is exactly the
 * situation XChaCha's 24-byte nonce exists to make safe.
 */
export async function sealBytes(plaintext: Uint8Array): Promise<Uint8Array> {
  const key = await deviceKey();
  const nonce = Crypto.getRandomBytes(NONCE_BYTES);
  return concatBytes(nonce, xchacha20poly1305(key, nonce).encrypt(plaintext));
}

/** Open bytes sealed by `sealBytes`, or null if they cannot be read. */
export async function openBytes(sealed: Uint8Array): Promise<Uint8Array | null> {
  if (sealed.length <= NONCE_BYTES) return null;
  try {
    const key = await deviceKey();
    const nonce = sealed.subarray(0, NONCE_BYTES);
    return xchacha20poly1305(key, nonce).decrypt(sealed.subarray(NONCE_BYTES));
  } catch {
    // A bad Poly1305 tag. The authentication working, not an error to surface.
    return null;
  }
}

/**
 * Decrypt a stored string, or null if it cannot be read.
 *
 * Null covers three different situations on purpose — not ours, tampered with,
 * or encrypted under a key this device no longer has (a restored backup). The
 * caller treats all three the same way it treats a missing value, because the
 * only sane response to "this data is unreadable" is to carry on with none.
 */
export async function open(envelope: string): Promise<string | null> {
  if (!envelope.startsWith(ENVELOPE_PREFIX)) return null;

  try {
    const key = await deviceKey();
    const bytes = hexToBytes(envelope.slice(ENVELOPE_PREFIX.length));
    if (bytes.length <= NONCE_BYTES) return null;

    const nonce = bytes.subarray(0, NONCE_BYTES);
    const ciphertext = bytes.subarray(NONCE_BYTES);
    return bytesToUtf8(xchacha20poly1305(key, nonce).decrypt(ciphertext));
  } catch {
    // Poly1305 throws on a bad tag. That is the authentication working, not an
    // error worth surfacing — and the message could leak what failed.
    return null;
  }
}

/**
 * Destroy the key, making every stored byte permanently unreadable.
 *
 * This is what "Delete all data" is: erasing 32 bytes from the keychain rather
 * than walking a store and hoping every row was really overwritten on flash.
 * Irreversible by design — there is no copy of this key anywhere.
 */
export async function destroyKey(): Promise<void> {
  await SecureStore.deleteItemAsync(KEY_ALIAS, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  cachedKey = null;
}
