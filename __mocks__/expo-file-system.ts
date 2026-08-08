/**
 * An in-memory filesystem, just enough for the CSV export and the media store.
 *
 * Contents are held as bytes and exposed as text too, because the two callers
 * want different things: the export writes a CSV whose exact bytes are asserted
 * in a test, and the media store writes a sealed binary container it must be
 * able to read back chunk by chunk.
 *
 * `open()` returns a real cursor over those bytes rather than a stub. The whole
 * point of the media format is that a chunked write and a chunked read agree
 * about lengths and offsets, and a mock that ignored the cursor would let a
 * format bug through untouched.
 */
const written = new Map<string, Uint8Array>();
const directories = new Set<string>();

const encoder = new TextEncoder();
const decoder = new TextDecoder();

/**
 * Join path parts with exactly one separator, leaving the scheme alone.
 *
 * The `file:///` triple slash is load-bearing: collapsing it makes the URI a
 * caller passes in ("the file the camera just wrote") a different string from
 * the one this mock stored it under, and every read comes back empty while
 * every existence check agrees it is missing.
 */
function join(parts: (string | File | Directory)[]): string {
  const [head = '', ...rest] = parts.map((part) => (typeof part === 'string' ? part : part.uri));
  const tail = rest.map((part) => part.replace(/^\/+|\/+$/g, '')).filter((part) => part.length > 0);
  return [head.replace(/\/+$/, ''), ...tail].join('/');
}

export enum FileMode {
  ReadWrite = 'rw',
  ReadOnly = 'r',
  WriteOnly = 'w',
  Append = 'wa',
  Truncate = 'wt',
}

export class FileHandle {
  offset = 0;

  constructor(
    private readonly uri: string,
    mode: FileMode,
  ) {
    // Opening for writing truncates, as it does on a device. Without this a
    // rewritten capture appends to the one it was meant to replace.
    if (mode === FileMode.WriteOnly || mode === FileMode.Truncate) written.set(uri, new Uint8Array());
  }

  get size(): number {
    return written.get(this.uri)?.length ?? 0;
  }

  readBytes(length: number): Uint8Array {
    const all = written.get(this.uri) ?? new Uint8Array();
    const slice = all.slice(this.offset, this.offset + length);
    this.offset += slice.length;
    return slice;
  }

  writeBytes(bytes: Uint8Array): void {
    const all = written.get(this.uri) ?? new Uint8Array();
    const next = new Uint8Array(all.length + bytes.length);
    next.set(all);
    next.set(bytes, all.length);
    written.set(this.uri, next);
    this.offset = next.length;
  }

  close(): void {
    this.offset = 0;
  }
}

export class Directory {
  readonly uri: string;

  constructor(...parts: (string | File | Directory)[]) {
    this.uri = `${join(parts).replace(/\/$/, '')}/`;
  }

  get exists(): boolean {
    return directories.has(this.uri);
  }

  create(_options?: { intermediates?: boolean }): void {
    directories.add(this.uri);
  }

  delete(): void {
    directories.delete(this.uri);
    for (const key of [...written.keys()]) {
      if (key.startsWith(this.uri)) written.delete(key);
    }
  }

  list(): (Directory | File)[] {
    return [...written.keys()].filter((key) => key.startsWith(this.uri)).map((key) => new File(key));
  }
}

export const Paths = {
  cache: new Directory('file:///mock/cache'),
  document: new Directory('file:///mock/documents'),
};

// The two roots always exist, as they do on a device.
directories.add(Paths.cache.uri);
directories.add(Paths.document.uri);

export class File {
  readonly uri: string;

  constructor(...parts: (string | File | Directory)[]) {
    this.uri = join(parts);
  }

  get exists(): boolean {
    return written.has(this.uri);
  }

  get size(): number {
    return written.get(this.uri)?.length ?? 0;
  }

  /** File name including the extension, as the real one reports it. */
  get name(): string {
    return this.uri.slice(this.uri.lastIndexOf('/') + 1);
  }

  /**
   * Move, as a rename. Both media directories live in the same container on a
   * device, so this is what staging a capture actually costs: nothing.
   */
  moveSync(destination: File | Directory): void {
    const target = destination instanceof Directory ? new File(destination, this.name) : destination;
    const bytes = written.get(this.uri);
    if (bytes !== undefined) written.set(target.uri, bytes);
    written.delete(this.uri);
  }

  create(): void {
    written.set(this.uri, new Uint8Array());
  }

  write(contents: string | Uint8Array): void {
    written.set(this.uri, typeof contents === 'string' ? encoder.encode(contents) : contents);
  }

  delete(): void {
    written.delete(this.uri);
  }

  text(): string {
    const bytes = written.get(this.uri);
    return bytes ? decoder.decode(bytes) : '';
  }

  bytesSync(): Uint8Array {
    return written.get(this.uri) ?? new Uint8Array();
  }

  async bytes(): Promise<Uint8Array> {
    return this.bytesSync();
  }

  open(mode: FileMode = FileMode.ReadWrite): FileHandle {
    return new FileHandle(this.uri, mode);
  }
}

/** Test-only: what the app actually wrote, by URI, as text. */
export function __written(): Map<string, string> {
  return new Map([...written].map(([key, value]) => [key, decoder.decode(value)]));
}

/** Test-only: seed a file the OS would have produced, e.g. a camera capture. */
export function __seed(uri: string, bytes: Uint8Array): void {
  written.set(uri, bytes);
}

export function __reset(): void {
  written.clear();
  directories.clear();
  directories.add(Paths.cache.uri);
  directories.add(Paths.document.uri);
}
