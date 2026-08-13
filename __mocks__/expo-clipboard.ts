/**
 * The pasteboard, off-device.
 *
 * Only `setStringAsync` exists here because it is the only thing the app calls:
 * `services/clipboard.ts` writes and never reads, so a mock with a reader would
 * be inventing a capability the app deliberately does not have.
 */
export const setStringAsync = jest.fn(async (_text: string) => true);
