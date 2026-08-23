import { chacha20poly1305 } from '@noble/ciphers/chacha.js';
import { concatBytes } from '@noble/ciphers/utils.js';
import { scrypt } from '@noble/hashes/scrypt.js';
import { sha256 } from '@noble/hashes/sha2.js';

/**
 * The format that leaves the phone.
 *
 * **Written here and read nowhere.** There is no unseal in this file and there
 * should never be one: the backup is one way, so the app produces this format
 * and cannot open it. That is not an omission to be filled in later — it means
 * there is no decrypt path on the device to be wrong, and a stolen phone with
 * the bucket credentials still cannot read a single object it uploaded.
 *
 * What opens it is `scripts/unseal_backup.py`, on a laptop, with the passphrase.
 * **Every choice below is constrained by what that script can do without
 * exotic dependencies**, and one of them was changed after checking rather than
 * reasoning: XChaCha20-Poly1305 was the obvious pick because `services/vault.ts`
 * uses it, and it needs PyNaCl, which is not in an ordinary Python and could not
 * be installed on the machine this was written on without first finding `pip`.
 * IETF ChaCha20-Poly1305 is in `cryptography`, which is. That friction must not
 * exist on the day somebody is opening a backup, which is by definition a bad
 * day already.
 *
 * So: `hashlib` and `cryptography` on the laptop, `@noble/*` and `expo-crypto`
 * on the phone, and no new dependency on either side.
 */

/** Marks the format and is part of every chunk's AAD, so a file cannot be re-labelled. */
export const MAGIC = new Uint8Array([0x41, 0x54, 0x42, 0x31]); // "ATB1"
export const VERSION = 1;

/**
 * A megabyte at a time.
 *
 * Big enough that the per-chunk overhead is nothing, small enough that a phone
 * can hold one chunk of plaintext and one of ciphertext at once without the
 * allocation being interesting. The size is written into the header rather than
 * assumed, so it can change without orphaning what is already uploaded.
 */
export const CHUNK_BYTES = 1024 * 1024;

const SALT_BYTES = 16;
const NONCE_BYTES = 12;
const TAG_BYTES = 16;

/**
 * scrypt parameters, in the manifest so the laptop uses the same ones.
 *
 * N=2^15 with r=8 is 32 MB of memory and about a second of pure JavaScript on a
 * phone — paid **once**, when the passphrase is first entered, because what is
 * kept afterwards is the derived key rather than the phrase. A cost that would
 * be intolerable per upload is unnoticeable per lifetime.
 */
export const KDF = { name: 'scrypt', N: 32768, r: 8, p: 1, dkLen: 32 } as const;

/** The passphrase, turned into the only key that matters. Once, ever. */
export function backupKeyFrom(passphrase: string, salt: Uint8Array): Uint8Array {
  return scrypt(new TextEncoder().encode(passphrase.normalize('NFKC')), salt, {
    N: KDF.N,
    r: KDF.r,
    p: KDF.p,
    dkLen: KDF.dkLen,
  });
}

/**
 * A key per object, so the nonce can be a counter.
 *
 * `SHA-256(backupKey || fileSalt)`, which is a sound derivation given the backup
 * key is 32 uniformly random bytes out of scrypt — and which costs nothing on
 * either side, being `hashlib.sha256` there and a digest here. It is what makes
 * the 12-byte IETF nonce safe: counters are only dangerous when a key is reused
 * across files, and no key here is used for more than one.
 */
export function fileKeyFrom(backupKey: Uint8Array, fileSalt: Uint8Array): Uint8Array {
  return sha256(concatBytes(backupKey, fileSalt));
}

/** The counter, in the low eight bytes. Never stored — it is where the chunk is. */
function nonceFor(index: number): Uint8Array {
  const nonce = new Uint8Array(NONCE_BYTES);
  new DataView(nonce.buffer).setBigUint64(NONCE_BYTES - 8, BigInt(index));
  return nonce;
}

/**
 * What each chunk is authenticated against, and the part not to leave out.
 *
 * Without the index a chunk can be moved and still decrypt; without the final
 * flag a file can be truncated and still decrypt cleanly, to something shorter
 * than what was uploaded. Both failures are silent, and a backup that fails
 * silently is worse than one that fails.
 */
function aadFor(index: number, final: boolean): Uint8Array {
  const tail = new Uint8Array(9);
  new DataView(tail.buffer).setBigUint64(0, BigInt(index));
  tail[8] = final ? 1 : 0;
  return concatBytes(MAGIC, new Uint8Array([VERSION]), tail);
}

function header(fileSalt: Uint8Array): Uint8Array {
  const fixed = new Uint8Array(5 + 4);
  fixed.set(MAGIC, 0);
  fixed[4] = VERSION;
  new DataView(fixed.buffer).setUint32(5, CHUNK_BYTES);
  return concatBytes(fixed, fileSalt);
}

/**
 * Seal one object, with the salt handed in.
 *
 * **This file imports nothing the phone owns**, which is what lets
 * `scripts/check-backup-format.mjs` run the real thing rather than a copy of
 * it: the check seals with this function and opens the result with
 * `unseal_backup.py`, so the two languages are tested against each other rather
 * than each against its own idea of the format. A check that re-implements its
 * subject can agree with a typo.
 *
 * The salt being a parameter is the whole trick, and it is also the risk: reuse
 * one and you reuse a file key, which reuses a counter nonce, which is the one
 * way to lose everything this construction gives you. `sealObject` in `index.ts` is the
 * only caller the app has, and it draws a fresh one.
 *
 * `plaintext` in memory is deliberate for what v1 carries: a day of notes is
 * kilobytes and a recording is a megabyte or two. The framing is already
 * chunked so v2 can stream a forty-megabyte video through the same format
 * without changing a byte of it — the phone's limits change, the bucket's
 * contents do not.
 */
export function sealWithSalt(backupKey: Uint8Array, plaintext: Uint8Array, fileSalt: Uint8Array): Uint8Array {
  if (fileSalt.length !== SALT_BYTES) throw new Error(`A file salt is ${SALT_BYTES} bytes`);
  const fileKey = fileKeyFrom(backupKey, fileSalt);

  const parts: Uint8Array[] = [header(fileSalt)];

  // An empty object still gets one chunk, so that "final" is always somewhere
  // and an empty file cannot be confused with a truncated one.
  const chunks = Math.max(1, Math.ceil(plaintext.length / CHUNK_BYTES));

  for (let index = 0; index < chunks; index += 1) {
    const slice = plaintext.subarray(index * CHUNK_BYTES, (index + 1) * CHUNK_BYTES);
    const final = index === chunks - 1;
    const sealed = chacha20poly1305(fileKey, nonceFor(index), aadFor(index, final)).encrypt(slice);

    const length = new Uint8Array(4);
    new DataView(length.buffer).setUint32(0, sealed.length);
    parts.push(length, sealed);
  }

  return concatBytes(...parts);
}

/**
 * Open one object, or say why it cannot be opened.
 *
 * **This is the unseal path the app deliberately did not have, and adding it
 * narrowed a guarantee.** `docs/BACKLOG.md` § 12 chose one-way precisely so a
 * stolen phone could add to the backup and open none of it, and "the app has no
 * unseal path at all" was half of what made that true — the other half being the
 * bucket policy. The agenda channel needs the phone to read *something*, so what
 * is left is the policy alone: the phone may `GetObject` on `agenda/` and
 * nothing else, and that `Condition` block is now load-bearing rather than tidy.
 *
 * Written down rather than discovered later, in the tradition this file's
 * neighbours have earned. What has **not** changed: no key is added to the
 * device — the agenda is sealed under the same key the phone already seals with
 * — and nothing here can reach an object the policy does not permit.
 *
 * **It throws rather than returning something plausible.** Every check is a case
 * where the bytes are not what they claim, and the two that matter are
 * authenticated rather than merely parsed: a chunk carries its index, so it
 * cannot be moved, and it carries whether it is the last, so the object cannot
 * be truncated into a shorter one that still opens cleanly.
 */
export function unsealWithKey(backupKey: Uint8Array, sealed: Uint8Array): Uint8Array {
  if (sealed.length < 5 + 4 + SALT_BYTES) throw new Error('Too short to hold a header');
  if (!MAGIC.every((byte, at) => sealed[at] === byte)) throw new Error('Not an activity-tracker object');
  if (sealed[4] !== VERSION) throw new Error(`Version ${sealed[4]} is newer than this build understands`);

  const view = new DataView(sealed.buffer, sealed.byteOffset, sealed.byteLength);
  const fileSalt = sealed.subarray(9, 9 + SALT_BYTES);
  const fileKey = fileKeyFrom(backupKey, fileSalt);

  // The frames are read before any chunk is opened, so "is this the last one" is
  // known going in. That flag is authenticated, so it has to be right rather
  // than discovered on the way out.
  const frames: Uint8Array[] = [];
  let at = 9 + SALT_BYTES;
  while (at < sealed.length) {
    if (at + 4 > sealed.length) throw new Error('A chunk length runs off the end');
    const length = view.getUint32(at);
    at += 4;
    if (at + length > sealed.length) throw new Error('A chunk runs off the end — the object is truncated');
    frames.push(sealed.subarray(at, at + length));
    at += length;
  }
  if (frames.length === 0) throw new Error('No chunks at all');

  const opened = frames.map((frame, index) => {
    const final = index === frames.length - 1;
    try {
      return chacha20poly1305(fileKey, nonceFor(index), aadFor(index, final)).decrypt(frame);
    } catch {
      // The wrong key and altered bytes are indistinguishable here, and neither
      // is worth guessing between.
      throw new Error(`Chunk ${index} failed to authenticate — wrong key, or the object was altered`);
    }
  });

  return concatBytes(...opened);
}

/** What an object will weigh once sealed, without sealing it. For the counts on screen. */
export function sealedLength(plaintextLength: number): number {
  const chunks = Math.max(1, Math.ceil(plaintextLength / CHUNK_BYTES));
  return 5 + 4 + SALT_BYTES + chunks * (4 + TAG_BYTES) + plaintextLength;
}
