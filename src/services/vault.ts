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
 * Bumped by `destroyKey`, so a key generation already in flight when the store
 * is erased cannot publish its result afterwards. See there for why.
 */
let keyGeneration = 0;

/**
 * What is in the keychain, if it is a key at all.
 *
 * `hexToBytes` throws on a malformed string and the ciphers throw on a
 * wrong-length key, and neither throw is caught anywhere useful: `open` would
 * swallow it and report every stored value as unreadable, while `seal` has no
 * `try` around `deviceKey` at all, so `writeJson` would log a warning and drop
 * every write. The app would look like a fresh install that silently refuses to
 * record anything, for ever, with no way back but deleting it.
 *
 * So the value is checked rather than trusted. Exactly 64 hex characters, which
 * is the only thing this function has ever written.
 */
function keyFromStored(value: string): Uint8Array | null {
  if (!/^[0-9a-fA-F]{64}$/.test(value)) return null;

  try {
    const bytes = hexToBytes(value);
    return bytes.length === KEY_BYTES ? bytes : null;
  } catch {
    return null;
  }
}

/**
 * The device key, created on first use.
 *
 * Requests are coalesced through `keyRequest`. Without it, the first render and
 * the background task can race into generating two keys, the second overwriting
 * the first — and everything written before that moment becomes permanently
 * unreadable.
 *
 * **An unreadable key is replaced rather than kept.** That is a destructive act
 * taken automatically, so it is worth being exact about what it costs: a key
 * that cannot be parsed cannot decrypt anything either, so there is nothing
 * behind it left to lose. Keeping it protects no data and guarantees the app
 * records none. Replacing it costs whatever was written under the real key,
 * which is already gone by the time we are here.
 *
 * This is the interim answer. Key handling gets revisited properly when the S3
 * sync lands and there is somewhere to re-encrypt *to* — see
 * the backlog’s § 12.
 */
async function deviceKey(): Promise<Uint8Array> {
  if (cachedKey) return cachedKey;
  if (keyRequest) return keyRequest;

  const generation = keyGeneration;

  keyRequest = (async () => {
    const existing = await SecureStore.getItemAsync(KEY_ALIAS, {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });

    const recovered = existing === null ? null : keyFromStored(existing);
    if (recovered) {
      if (generation === keyGeneration) cachedKey = recovered;
      return recovered;
    }

    if (existing !== null) {
      console.warn(
        'The stored vault key is unreadable; generating a new one. Anything sealed under the old key is lost.',
      );
    }

    const fresh = Crypto.getRandomBytes(KEY_BYTES);
    await SecureStore.setItemAsync(KEY_ALIAS, bytesToHex(fresh), {
      keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
    });
    // Not if the store was erased while this was in flight: publishing here
    // would leave "erase everything" with a live key in memory.
    if (generation === keyGeneration) cachedKey = fresh;
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
 *
 * **The generation counter is what makes this safe against a key request in
 * flight.** Clearing `cachedKey` alone was not enough: a `deviceKey` call that
 * had already begun would finish afterwards and assign its result, leaving a
 * live key in memory immediately after an erase — and every value written next
 * sealed under a key the keychain no longer has, which is unreadable on the
 * very next launch. Bumping the generation first means that assignment is
 * skipped. The caller still receives the key it asked for, which cannot be
 * taken back; what matters is that nothing else picks it up.
 *
 * Everything is cleared *before* the delete is awaited, so nothing reads a
 * stale key during it.
 */
export async function destroyKey(): Promise<void> {
  keyGeneration += 1;
  keyRequest = null;
  cachedKey = null;

  await SecureStore.deleteItemAsync(KEY_ALIAS, {
    keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK_THIS_DEVICE_ONLY,
  });
  cachedKey = null;
}
