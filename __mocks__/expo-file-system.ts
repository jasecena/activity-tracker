/**
 * An in-memory filesystem, just enough for the CSV export path.
 *
 * The export writes a file and hands its URI to the share sheet. What is worth
 * testing is that the right bytes were written under the right name — so the
 * written contents are kept and readable from a test, rather than discarded.
 */
const written = new Map<string, string>();

export class Directory {
  constructor(public readonly uri: string) {}
}

export const Paths = {
  cache: new Directory('file:///mock/cache/'),
  document: new Directory('file:///mock/documents/'),
};

export class File {
  readonly uri: string;

  constructor(...parts: (string | File | Directory)[]) {
    this.uri = parts
      .map((part) => (typeof part === 'string' ? part : part.uri))
      .join('')
      .replace(/\/+/g, '/')
      .replace(':/', '://');
  }

  get exists(): boolean {
    return written.has(this.uri);
  }

  create(): void {
    written.set(this.uri, '');
  }

  write(contents: string): void {
    written.set(this.uri, contents);
  }

  delete(): void {
    written.delete(this.uri);
  }

  text(): string {
    return written.get(this.uri) ?? '';
  }
}

/** Test-only: what the app actually wrote, by URI. */
export function __written(): Map<string, string> {
  return written;
}

export function __reset(): void {
  written.clear();
}
