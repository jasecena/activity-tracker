/**
 * A deterministic stand-in for the system CSPRNG.
 *
 * Counter bytes, not random ones — the point of a test is to be repeatable, and
 * nothing under test depends on the values being unpredictable. What it *does*
 * preserve is that every call returns different bytes, which is what makes a
 * nonce-reuse bug visible here rather than only on a device.
 */
let counter = 0;

export function getRandomBytes(byteCount: number): Uint8Array {
  const bytes = new Uint8Array(byteCount);
  for (let i = 0; i < byteCount; i += 1) {
    counter = (counter + 1) % 256;
    bytes[i] = counter;
  }
  return bytes;
}

export async function getRandomBytesAsync(byteCount: number): Promise<Uint8Array> {
  return getRandomBytes(byteCount);
}
