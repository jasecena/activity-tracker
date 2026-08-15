import { dayKeyOf, type TzOffsetMinutes } from '../day';
import type { LatLon } from '../geo';
import { positionAt, type Position, type Track } from '../replay';
import { isStoredFileName } from './fileName';
import { isCaptureOrientation, type CaptureOrientation } from './orientation';

export { isStoredFileName } from './fileName';
export {
  CAMERA_WRITES_UPRIGHT_PIXELS,
  displayRotationFor,
  isCaptureOrientation,
  isQuarterTurn,
  stageSizeFor,
  topEdgeFor,
  uprightRotationFor,
} from './orientation';
export type { CaptureOrientation, Degrees, Edge, Size } from './orientation';
export {
  deviceFactorFor,
  dialSpecFor,
  focalLength35mm,
  formatDisplayFactor,
  pickDialCamera,
  zoomPropFor,
} from './optics';
export type { CameraDescription, DialSpec, DialStop, LensDescription } from './optics';

/**
 * Photos, video and voice notes, as the engine sees them.
 *
 * A capture is **a timestamp, some bytes, and where it was taken**.
 *
 * The position is recorded twice, deliberately, and with the same reading in
 * both places: on the item here, and appended to the fix stream. Each answers a
 * different question. The copy on the item is what the media screen shows, and
 * it survives the day being re-derived, the fixes being pruned, or tracking
 * having been off entirely. The fix in the stream is what puts you on the
 * timeline at that moment, so a photo taken during a stationary afternoon
 * leaves a mark on the day rather than none.
 *
 * This revises the note that used to stand here — that a capture stores a time
 * and never a position, deriving where from the fix stream. Deriving was the
 * right instinct and the wrong outcome: a phone that does not move produces no
 * fixes, so a photo taken while sitting still had nowhere to be placed, and
 * with tracking off it had nothing to derive from at all.
 *
 * The tracking switch governs what the app records **on its own**. Pressing the
 * shutter is not the app acting on its own.
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
  /**
   * Where it was taken, or null if the platform would not say.
   *
   * Null is a real answer — a basement, a denied permission — and better than
   * the last position that happened to be lying around.
   */
  readonly at: LatLon | null;
  /**
   * A caption, from the detail page that no longer exists. **Superseded.**
   *
   * Writing about a capture is a `DayNote` with a `mediaId` on it now — a real
   * diary entry, filed under its day beside everything else written that day,
   * with a title, a recording and a life of its own. This was a string on the
   * media row, visible in one place and in no list, export or search.
   *
   * Kept rather than dropped, and only for as long as it takes something to
   * carry them over: `useAdoptVoiceCaptures` already reads it when it turns an
   * old voice capture into a note, and deleting the field would silently
   * discard whatever an early build's owner typed here. Nothing writes it any
   * more. **Do not build on it** — a second way to attach words to a picture is
   * two things to keep in step and one of them always slightly wrong, which is
   * the reasoning that retired `MediaScreen` in the first place.
   */
  readonly note: string;
  /**
   * Which way the phone was held, or null if nothing said.
   *
   * Null on every capture taken before this was recorded, and on anything the
   * camera could not report it for — a state to handle rather than a value to
   * invent, the same as `thumbFileName`. It is a record of the capture, not an
   * instruction: nothing rewrites the file, and `displayRotationFor` turns the
   * picture only at the moment of looking at it.
   */
  readonly orientation: CaptureOrientation | null;
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

function isLatLon(candidate: unknown): candidate is LatLon {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { lat, lon } = candidate as Partial<LatLon>;
  return typeof lat === 'number' && Number.isFinite(lat) && typeof lon === 'number' && Number.isFinite(lon);
}

/** What an older build wrote for a five-second capture, before that was removed. */
const RETIRED_LIVE_KIND = 'live';

function isMediaKind(candidate: unknown): candidate is MediaKind {
  return candidate === 'photo' || candidate === 'video' || candidate === 'audio';
}

/**
 * Kinds an older build could have written, read as what they are now.
 *
 * A five-second "live" capture was a clip and a still on disk — which is what a
 * video is — so it reads back as a video and keeps playing. Dropping the kind
 * without this would have dropped the row: `normalizeMedia` deletes what it does
 * not recognise, and the file would then be swept as an orphan on the next
 * launch. Somebody's capture, gone, for a feature being withdrawn.
 */
function readableKind(candidate: unknown): MediaKind | null {
  if (candidate === RETIRED_LIVE_KIND) return 'video';
  return isMediaKind(candidate) ? candidate : null;
}

function isMediaItem(candidate: unknown): candidate is MediaItem {
  if (typeof candidate !== 'object' || candidate === null) return false;
  const { id, kind, capturedAt, fileName } = candidate as Partial<MediaItem>;
  if (typeof id !== 'string' || readableKind(kind) === null) return false;
  if (typeof capturedAt !== 'number' || !Number.isFinite(capturedAt)) return false;
  return isStoredFileName(fileName);
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
      // Never `item.kind` directly: a retired kind has to arrive as what it is
      // now, or every later read has to know about a feature that no longer
      // exists.
      kind: readableKind(item.kind) ?? item.kind,
      capturedAt: item.capturedAt,
      durationMs: typeof item.durationMs === 'number' && Number.isFinite(item.durationMs) ? item.durationMs : null,
      fileName: item.fileName,
      // Absent on anything written before thumbnails existed, which is a state
      // the app has to handle rather than a value to invent — and the same
      // state a name that is not a name collapses to, since a missing thumbnail
      // is drawn as a blank square and a bad one must not be opened at all.
      thumbFileName: isStoredFileName(item.thumbFileName) ? item.thumbFileName : null,
      byteLength: typeof item.byteLength === 'number' && item.byteLength >= 0 ? item.byteLength : 0,
      at: isLatLon(item.at) ? { lat: item.at.lat, lon: item.at.lon } : null,
      note: typeof item.note === 'string' ? item.note : '',
      orientation: isCaptureOrientation(item.orientation) ? item.orientation : null,
    }))
    .sort((a, b) => a.capturedAt - b.capturedAt);
}

/**
 * The captures — everything the gallery, the map and the day's filmstrip show.
 *
 * **A voice note is not one of them, and this is what says so.** It was: a
 * recording used to be filed here beside the photographs, listed in the Media
 * tab, pinned on the map. It is a diary entry now — `core/day/notes.ts` — and
 * lives on the note it belongs to, so the gallery must not draw it as well.
 * Two places showing one thing is two things to keep in step and one of them
 * always slightly wrong, which is the reasoning that retired `MediaScreen`.
 *
 * The kind survives in the index rather than being deleted, because a library
 * written by an earlier build still has audio rows in it until
 * `useAdoptVoiceCaptures` has moved them across. This filter is what makes that
 * window invisible instead of showing a recording that is about to move.
 */
export function capturesOnly(items: readonly MediaItem[]): readonly MediaItem[] {
  return items.filter((item) => item.kind !== 'audio');
}

export interface MediaDay {
  readonly key: string;
  /** The instant of the newest capture in the day, for a title. */
  readonly newestAt: number;
  readonly items: readonly MediaItem[];
}

/**
 * Every capture, gathered into local calendar days, newest day first.
 *
 * What the grid draws. Newest first in both directions — days and the items
 * within one — because the thing you are looking for is overwhelmingly the
 * thing you captured most recently, and a grid that opens on last March is a
 * grid that gets scrolled past every time.
 */
export function groupMediaByDay(items: readonly MediaItem[], tzOffsetMinutes: TzOffsetMinutes): readonly MediaDay[] {
  const days = new Map<string, MediaItem[]>();
  for (const item of items) {
    const key = dayKeyOf(item.capturedAt, tzOffsetMinutes);
    const day = days.get(key);
    if (day) day.push(item);
    else days.set(key, [item]);
  }

  return [...days.entries()]
    .map(([key, dayItems]) => {
      const sorted = [...dayItems].sort((a, b) => b.capturedAt - a.capturedAt);
      return { key, newestAt: sorted[0]?.capturedAt ?? 0, items: sorted };
    })
    .sort((a, b) => b.newestAt - a.newestAt);
}

/** Everything captured on one local calendar day, oldest first. */
export function mediaForDay(
  items: readonly MediaItem[],
  dayKey: string,
  tzOffsetMinutes: TzOffsetMinutes,
): readonly MediaItem[] {
  return items.filter((item) => dayKeyOf(item.capturedAt, tzOffsetMinutes) === dayKey);
}

export interface PlacedMedia {
  readonly item: MediaItem;
  /** Null when the day has no idea where you were at that instant. */
  readonly at: Position | null;
}

/**
 * Where each item goes on the map.
 *
 * The position stored with the capture wins: it was read at the shutter, so it
 * is the most direct answer there is. The track is the fallback for anything
 * captured before positions were stored — and `positionAt` returns null inside
 * a hole, which is carried through rather than smoothed away.
 */
export function placeMedia(track: Track, items: readonly MediaItem[]): readonly PlacedMedia[] {
  return items.map((item) => ({
    item,
    at: item.at
      ? { ...item.at, at: item.capturedAt, speedMps: null, segmentId: '', kind: 'stay' as const }
      : positionAt(track, item.capturedAt),
  }));
}

/** Total bytes on disk, for the "what is stored" list. */
export function totalBytes(items: readonly MediaItem[]): number {
  return items.reduce((sum, item) => sum + item.byteLength, 0);
}
