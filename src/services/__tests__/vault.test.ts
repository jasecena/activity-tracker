import * as SecureStore from 'expo-secure-store';

import { destroyKey, open, seal } from '../vault';

/**
 * The real cipher, against an in-memory keychain.
 *
 * Deliberately not mocking the encryption. A test that stubs `seal` to return
 * its input proves the call sites compile and nothing else; the parts worth
 * checking — that a tampered blob is refused, that a lost key means lost data —
 * only exist in the real thing.
 */

describe('the vault', () => {
  it('gives back exactly what it was given', async () => {
    const secret = JSON.stringify({ lat: 0, lon: 0, at: 1_767_000_000_000 });
    expect(await open(await seal(secret))).toBe(secret);
  });

  it('handles an empty string and a large one', async () => {
    expect(await open(await seal(''))).toBe('');
    const big = 'x'.repeat(200_000);
    expect(await open(await seal(big))).toBe(big);
  });

  it('survives characters that are not ASCII', async () => {
    const text = 'Café — 東京 — 🚶';
    expect(await open(await seal(text))).toBe(text);
  });

  // A nonce reused with the same key is the one catastrophic mistake available
  // in an AEAD. Two seals of identical text must not produce identical bytes.
  it('never produces the same ciphertext twice for the same plaintext', async () => {
    const [first, second] = await Promise.all([seal('same'), seal('same')]);
    expect(first).not.toBe(second);
    expect(await open(first)).toBe('same');
    expect(await open(second)).toBe('same');
  });

  describe('refusing what it cannot trust', () => {
    it('returns null for something it did not write', async () => {
      expect(await open('not ours')).toBeNull();
      expect(await open('')).toBeNull();
      expect(await open(JSON.stringify({ lat: 1 }))).toBeNull();
    });

    it('returns null for a truncated envelope', async () => {
      const sealed = await seal('a day of walking');
      expect(await open(sealed.slice(0, 20))).toBeNull();
    });

    // Poly1305 doing its job. Without authentication a flipped byte decrypts to
    // garbage that JSON.parse might still accept.
    it('returns null when a byte has been changed', async () => {
      const sealed = await seal('a day of walking');
      const flipped = `${sealed.slice(0, -1)}${sealed.endsWith('a') ? 'b' : 'a'}`;
      expect(await open(flipped)).toBeNull();
    });
  });

  // What "Erase everything" actually is: 32 bytes removed from the keychain,
  // rather than walking a store and hoping every row really left the flash.
  it('makes everything unreadable once the key is destroyed', async () => {
    const sealed = await seal('somewhere I went');
    expect(await open(sealed)).toBe('somewhere I went');

    await destroyKey();

    // A fresh key is generated on the next use, and it cannot read the old blob.
    expect(await open(sealed)).toBeNull();
  });

  /**
   * A keychain entry that is not a key at all.
   *
   * The failure this prevents is silent and permanent rather than loud: a
   * malformed entry makes `hexToBytes` throw inside `deviceKey`, which `open`
   * swallows into "unreadable" and `seal` does not catch at all — so `writeJson`
   * logs a warning and drops every write, for ever, on an app that looks like a
   * fresh install. Replacing the entry costs nothing that was not already lost:
   * a key that cannot be parsed cannot decrypt anything either.
   */
  describe('an unreadable stored key', () => {
    const KEY_ALIAS = 'activity-tracker.vault-key.v1';

    beforeEach(async () => {
      await destroyKey();
      jest.spyOn(console, 'warn').mockImplementation(() => {});
    });

    afterEach(() => {
      jest.restoreAllMocks();
    });

    it.each([
      ['not hex at all', 'lunchtime'],
      ['hex of the wrong length', 'abcdef'],
      ['empty', ''],
    ])('is replaced rather than kept when it is %s', async (_label, stored) => {
      await SecureStore.setItemAsync(KEY_ALIAS, stored);

      const sealed = await seal('a day of walking');
      expect(await open(sealed)).toBe('a day of walking');
    });

    it('says so, rather than failing quietly', async () => {
      await SecureStore.setItemAsync(KEY_ALIAS, 'lunchtime');
      await seal('anything');

      expect(console.warn).toHaveBeenCalledWith(expect.stringContaining('unreadable'));
    });

    it('leaves a good key alone', async () => {
      const sealed = await seal('somewhere I went');
      const key = await SecureStore.getItemAsync(KEY_ALIAS);

      expect(await open(sealed)).toBe('somewhere I went');
      expect(await SecureStore.getItemAsync(KEY_ALIAS)).toBe(key);
    });
  });
});
