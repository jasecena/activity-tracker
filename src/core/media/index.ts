import { dayKeyOf, type TzOffsetMinutes } from '../day';
import type { Segment } from '../segments';
import { positionAt, type Position, type Track } from '../replay';

/**
 * Photos, video and voice notes, as the engine sees them.
 *
 * A capture is a **timestamp and some bytes**. It carries no coordinate of its
 * own, and that is the same decision manual recording made: there is one fix
 * stream, always, and where a photo was taken is answered by asking the day
 * where you were at that instant. Taking a fresh reading at the shutter would
 * mean a second consumer of Core Location, a second answer to "where was I",
 * and a photo whose position disagrees with the route drawn under it.
 *
 * It also means a photo taken in a lift with no signal has no position, which
 * is the honest answer rather than the last one that happened to be lying
 * around.
 *
 * Nothing here touches a file. The bytes live in `services/mediaStore.ts`,
 * sealed under the vault key; this module owns only the index and the
 * arithmetic of putting an item on a timeline.
 */

export type MediaKind = 'photo' | 'video' | 'audio';

export interface MediaItem {
  /**
   * Derived from `capturedAt`, never generated.
   *
   * The same rule as segment ids and manual window ids, and it earns its place
   * the same way: re-reading the index twice, or merging one written by a
   * crashed write, updates the same row rather than accumulating two.
   */
  readonly id: string;
  readonly kind: MediaKind;
  /** Epoch ms at the shutter, the record button, or the start of the clip. */
  readonly capturedAt: number;
  /** Length of a video or voice note in ms; null for a photo. */
  readonly durationMs: number | null;
  /** Name of the sealed file in the media directory. Opaque — the plaintext never has a name. */
  readonly fileName: string;
  /**
   * A small sealed image for the filmstrip, or null if there is none.
   *
   * Null for a voice note, which has nothing to show, and for anything
   * captured before thumbnails existed — those get one the first time they are
   * looked at rather than by rewriting the whole store.
   *
   * It exists because a filmstrip of full captures would decrypt every photo
   * to draw a row of 60-point squares, which is the same whole-file cost as
   * playing a video, multiplied by everything you have ever taken.
   */
  readonly thumbFileName: string | null;
  /** Size on disk, ciphertext included. What the Data screen reports. */
  readonly byteLength: number;
  /** Whatever you typed, or empty. */
  readonly note: string;
}

const ID_PREFIX = 'm-';

export function mediaIdFor(capturedAt: number): string {
  return `${ID_PREFIX}${capturedAt}`;
}

/**
 * The instant back out of the id, or null if that is not one of ours.
 *
 * The inverse exists because a capture interrupted mid-seal is recovered from
 * a file named after its id and nothing else — there is no index entry yet, by
 * definition. Deriving the id from the instant is what makes the instant
 * recoverable from the id, which is the same property that lets a segment be
 * re-derived: encode, do not generate.
 */
export function capturedAtFromMediaId(id: string): number | null {
  if (!id.startsWith(ID_PREFIX)) return null;
  const at = Number(id.slice(ID_PREFIX.length));
  return Number.isFinite(at) && at > 0 ? at : null;
}

function isMediaKind(candidate: unknown): candidate is MediaKind {
  return candidate === 'photo' || candidate === 'video' || candidate === 'audio';
}

function isMediaItem(candidate: unknown): candidate is MediaItem {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { id, kind, capturedAt, fileName } = candidate as Partial<MediaItem>;
  if (typeof id !== 'string' || !isMediaKind(kind)) return false;
  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt)) return false;
  return typeof fileName === 'string' && fileName.length > 0;
}

/**
 * The trust boundary for the index.
 *
 * Anything unrecognisable is dropped rather than repaired, like every other
 * `normalize*` in this app. An entry pointing at a file that no longer exists
 * is *not* dropped here — that is a question about the filesystem, and `core`
 * has no business having an opinion about it.
 */
export function normalizeMedia(input: unknown): MediaItem[] {
  if (!Array.isArray(input)) return [];
  return input
    .filter(isMediaItem)
    .map((item) => ({
      id: item.id,
      kind: item.kind,
      capturedAt: item.capturedAt,
      durationMs: typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) ? item.durationMs : null,
      fileName: item.fileName,
      // Absent on anything written before thumbnails existed, which is a state
      // the app has to handle rather than a value to invent.
      thumbFileName:
        typeof item.thumbFileName === 'string' && item.thumbFileName.length > 0 ? item.thumbFileName : null,
      byteLength: typeof item.byteLength === 'number' && item.byteLength >= 0 ? item.byteLength : 0,
      note: typeof item.note === 'string' ? item.note : '',
    }))
    .sort((a, b) => a.capturedAt - b.capturedAt);
}

/** Everything captured on one local calendar day, oldest first. */
export function mediaForDay(
  items: readonly MediaItem[],
  dayKey: string,
  tzOffsetMinutes: TzOffsetMinutes,
): readonly MediaItem[] {
  return items.filter((item) => dayKeyOf(item.capturedAt, tzOffsetMinutes) === dayKey);
}

/**
 * Which timeline row each item belongs to.
 *
 * Derived on read and never written back onto a segment — the same shape as
 * `applyManualWindows`. It is what lets the engine re-fold a day, produce
 * byte-identical segments, and find every photo still attached to the right
 * one. Storing the link the other way round would leave a photo orphaned the
 * first time a day was re-derived under a different config.
 *
 * An item captured in a hole belongs to no segment and appears in no bucket.
 */
export function attachToSegments(
  segments: readonly Segment[],
  items: readonly MediaItem[],
): ReadonlyMap<string, readonly MediaItem[]> {
  const buckets = new Map<string, MediaItem[]>();

  for (const item of items) {
    const owner = segments.find(
      (segment) => item.capturedAt >= segment.startedAt && item.capturedAt <= segment.endedAt,
    );
    if (!owner) continue;

    const bucket = buckets.get(owner.id);
    if (bucket) bucket.push(item);
    else buckets.set(owner.id, [item]);
  }

  for (const bucket of buckets.values()) bucket.sort((a, b) => a.capturedAt - b.capturedAt);
  return buckets;
}

export interface PlacedMedia {
  readonly item: MediaItem;
  /** Null when the day has no idea where you were at that instant. */
  readonly at: Position | null;
}

/**
 * Where each item goes on the map.
 *
 * `positionAt` returns null inside a hole, and that null is carried through
 * rather than smoothed away: a photo taken during two hours the app has no
 * fixes for gets a row in the list and no pin, which is the truth.
 */
export function placeMedia(track: Track, items: readonly MediaItem[]): readonly PlacedMedia[] {
  return items.map((item) => ({ item, at: positionAt(track, item.capturedAt) }));
}

/** Total bytes on disk, for the "what is stored" list. */
export function totalBytes(items: readonly MediaItem[]): number {
  return items.reduce((sum, item) => sum + item.byteLength, 0);
}
