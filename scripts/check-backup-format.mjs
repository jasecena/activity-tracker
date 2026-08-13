/**
 * The one check that proves "readable from a laptop" is a property rather than
 * an intention.
 *
 * The app's own sealing code writes fixtures; `unseal_backup.py` opens them with
 * nothing but `hashlib` and `cryptography`; the bytes have to match. Anything
 * less tests the format against itself, which is exactly the failure mode of a
 * backup only its author can read.
 *
 * A Node script rather than a Jest test, deliberately. The `core` project may
 * not import `@noble/*`, and the `app` project runs under a React Native preset
 * where shelling out to Python is a fight — while what is being tested here is
 * two *processes* agreeing, which is a thing a test runner is the wrong shape
 * for. Run by `npm run verify:backup`.
 *
 * **It imports the app's own `seal.ts`**, stripped of its types by Node itself.
 * That is why the salt is a parameter to `sealWithSalt` and the entropy lives a
 * file away: this check runs the real implementation rather than a restatement
 * of it, and a check that restates its subject can agree with a typo in it.
 *
 * The cases are the ones where a format goes wrong quietly: an empty object, a
 * chunk boundary landing exactly on the end, and more than one chunk. The
 * tamper cases matter just as much — a truncated or reordered file that opens
 * cleanly is the failure nobody notices until it is needed.
 */
import { execFileSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { randomBytes } from 'node:crypto';

import { backupKeyFrom, sealWithSalt, sealedLength, CHUNK_BYTES, KDF, VERSION } from '../src/services/backup/seal.ts';

const PASSPHRASE = 'correct horse battery staple';
const salt = new Uint8Array(randomBytes(16));
const backupKey = backupKeyFrom(PASSPHRASE, salt);
const seal = (key, plaintext) => sealWithSalt(key, plaintext, new Uint8Array(randomBytes(16)));

const root = mkdtempSync(join(tmpdir(), 'backup-format-'));
const source = join(root, 'sealed');
const destination = join(root, 'plain');
mkdirSync(source, { recursive: true });
writeFileSync(
  join(source, 'manifest.json'),
  JSON.stringify({ version: VERSION, salt: Buffer.from(salt).toString('hex'), kdf: KDF }),
);

const cases = {
  'days/2026-01-05': Buffer.from(JSON.stringify({ notes: ['a Tuesday'], segments: [] })),
  'note-audio/empty': Buffer.alloc(0),
  // Exactly one chunk, to the byte: the boundary an off-by-one lands on.
  'note-audio/exactly-one-chunk': randomBytes(CHUNK_BYTES),
  // Three chunks and a remainder, so ordering and the final flag both matter.
  'media/multi-chunk': randomBytes(CHUNK_BYTES * 2 + 4096),
};

let failures = 0;
const fail = (message) => {
  console.error(`FAIL ${message}`);
  failures += 1;
};

for (const [name, plaintext] of Object.entries(cases)) {
  const target = join(source, name);
  mkdirSync(join(target, '..'), { recursive: true });
  const sealed = seal(backupKey, new Uint8Array(plaintext));
  writeFileSync(target, sealed);

  // The Data screen predicts what a backup will weigh before doing it, and a
  // prediction that drifts from the truth is a progress bar that lies.
  if (sealed.length !== sealedLength(plaintext.length)) {
    fail(`${name}: sealedLength said ${sealedLength(plaintext.length)}, sealing produced ${sealed.length}`);
  }
}

// `getpass` reads the terminal, so the passphrase goes in on stdin.
try {
  execFileSync('python3', [join(import.meta.dirname, 'unseal_backup.py'), source, destination], {
    input: `${PASSPHRASE}\n`,
    stdio: ['pipe', 'inherit', 'inherit'],
  });
} catch {
  fail('the script exited non-zero');
}

for (const [name, plaintext] of Object.entries(cases)) {
  const got = readFileSync(join(destination, name));
  if (!got.equals(Buffer.from(plaintext))) fail(`${name} did not round-trip (${got.length} vs ${plaintext.length})`);
  else console.log(`ok   ${name} (${plaintext.length} bytes)`);
}

/** Damage an object and require the script to refuse it rather than open it. */
function mustRefuse(label, damage) {
  const broken = join(root, 'broken');
  rmSync(broken, { recursive: true, force: true });
  mkdirSync(join(broken, 'days'), { recursive: true });
  writeFileSync(join(broken, 'manifest.json'), readFileSync(join(source, 'manifest.json')));
  writeFileSync(join(broken, 'days/x'), damage(readFileSync(join(source, 'days/2026-01-05'))));

  try {
    execFileSync('python3', [join(import.meta.dirname, 'unseal_backup.py'), broken, join(root, 'out')], {
      input: `${PASSPHRASE}\n`,
      stdio: ['pipe', 'ignore', 'ignore'],
    });
    fail(`${label} was opened, and should not have been`);
  } catch {
    console.log(`ok   refused: ${label}`);
  }
}

mustRefuse('a flipped byte in the ciphertext', (bytes) => {
  const copy = Buffer.from(bytes);
  copy[copy.length - 20] ^= 0xff;
  return copy;
});
mustRefuse('a truncated object', (bytes) => bytes.subarray(0, bytes.length - 8));
mustRefuse('a wrong magic', (bytes) => {
  const copy = Buffer.from(bytes);
  copy[0] = 0x42;
  return copy;
});

// And the wrong passphrase must not quietly produce something.
try {
  execFileSync('python3', [join(import.meta.dirname, 'unseal_backup.py'), source, join(root, 'nope')], {
    input: 'the wrong passphrase\n',
    stdio: ['pipe', 'ignore', 'ignore'],
  });
  fail('the wrong passphrase opened the backup');
} catch {
  console.log('ok   refused: the wrong passphrase');
}

rmSync(root, { recursive: true, force: true });
if (failures > 0) {
  console.error(`\n${failures} failure(s): the phone and the laptop do not agree on the format.`);
  process.exit(1);
}
console.log('\nThe format the phone writes is the format the laptop reads.');
