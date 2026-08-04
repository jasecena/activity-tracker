/** The iOS share sheet, off-device. Available by default; records what was shared. */
const shared: { uri: string; options?: unknown }[] = [];

export const isAvailableAsync = jest.fn(async () => true);

export const shareAsync = jest.fn(async (uri: string, options?: unknown) => {
  shared.push({ uri, options });
});

/** Test-only. */
export function __shared(): readonly { uri: string; options?: unknown }[] {
  return shared;
}

export function __reset(): void {
  shared.length = 0;
}
