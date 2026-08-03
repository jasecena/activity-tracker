import { distanceM } from '../geo';
import type { Segment, StaySegment } from '../segments';

/**
 * Places you have been, by the name you gave them.
 *
 * There is no geocoder here and no lookup service, and that is the point: this
 * app never asks a third party where you are. So a place has no name until you
 * type one, and once you have, every future stay within its radius is
 * recognised as the same place. "abc restaurant, 2h 04m" is produced entirely
 * from a coordinate you named once and a stay that happened near it.
 *
 * The cost is that the first visit anywhere is an unnamed dot. The benefit is
 * that the list of everywhere you go exists on exactly one device.
 */

export interface Place {
  /**
   * Derived from the rounded coordinate, not generated.
   *
   * Five decimal places is about a metre, so a place has a stable identity
   * across restarts and re-derivations, and naming the same spot twice updates
   * one entry rather than accumulating two.
   */
  readonly id: string;
  readonly name: string;
  readonly lat: number;
  readonly lon: number;
  /** How close a stay has to be to count as having happened here. */
  readonly radiusM: number;
}

/**
 * Generous by default.
 *
 * A stay's centre is the mean of fixes taken indoors, where accuracy is at its
 * worst — the same café can come out 80 m apart on two visits. Too tight a
 * radius and you name the same restaurant every week.
 */
export const DEFAULT_PLACE_RADIUS_M = 120;

export function placeIdFor(lat: number, lon: number): string {
  return `place-${Math.round(lat * 1e5)}-${Math.round(lon * 1e5)}`;
}

/** Name a stay, turning it into a place you will be recognised at next time. */
export function placeFromStay(stay: StaySegment, name: string, radiusM = DEFAULT_PLACE_RADIUS_M): Place {
  return {
    id: placeIdFor(stay.center.lat, stay.center.lon),
    name: name.trim(),
    lat: stay.center.lat,
    lon: stay.center.lon,
    radiusM,
  };
}

/**
 * Which place a stay happened at, if any.
 *
 * Nearest wins. Overlapping radii are normal — a café inside a shopping centre
 * you also named — and "first in the list" would make the answer depend on the
 * order you happened to name them in.
 */
export function matchPlace(stay: StaySegment, places: readonly Place[]): Place | null {
  let best: Place | null = null;
  let bestDistance = Number.POSITIVE_INFINITY;

  for (const place of places) {
    const away = distanceM(stay.center, place);
    if (away <= place.radiusM && away < bestDistance) {
      best = place;
      bestDistance = away;
    }
  }
  return best;
}

/** Add a place, or replace the one already at that spot. */
export function upsertPlace(places: readonly Place[], place: Place): readonly Place[] {
  const without = places.filter((existing) => existing.id !== place.id);
  return [...without, place];
}

export function removePlace(places: readonly Place[], id: string): readonly Place[] {
  return places.filter((place) => place.id !== id);
}

export interface PlaceVisits {
  readonly place: Place;
  /** Every stay that matched, oldest first. */
  readonly visits: readonly StaySegment[];
  readonly totalMs: number;
}

/**
 * How long you spent at each named place across a timeline, longest first.
 *
 * This is the answer to "how long was I at the restaurant": one stay usually,
 * but two if you stepped outside for long enough to break it, and summing them
 * is more useful than showing the longest.
 */
export function visitsByPlace(segments: readonly Segment[], places: readonly Place[]): readonly PlaceVisits[] {
  const byPlace = new Map<string, { place: Place; visits: StaySegment[]; totalMs: number }>();

  for (const segment of segments) {
    if (segment.kind !== 'stay') continue;
    const place = matchPlace(segment, places);
    if (!place) continue;

    const entry = byPlace.get(place.id) ?? { place, visits: [], totalMs: 0 };
    entry.visits.push(segment);
    entry.totalMs += segment.endedAt - segment.startedAt;
    byPlace.set(place.id, entry);
  }

  return [...byPlace.values()].sort((a, b) => b.totalMs - a.totalMs);
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

/**
 * The trust boundary for the place list.
 *
 * Anything that fails to be a usable place is dropped rather than repaired: a
 * place with a NaN coordinate matches nothing, silently, and would be
 * indistinguishable from the app having forgotten where your home is.
 */
export function normalizePlaces(input: unknown): readonly Place[] {
  if (!Array.isArray(input)) return [];

  const out: Place[] = [];
  for (const candidate of input) {
    if (typeof candidate !== 'object' || candidate === null) continue;
    const { name, lat, lon, radiusM } = candidate as Partial<Place>;
    if (typeof name !== 'string' || name.trim().length === 0) continue;
    if (!isFiniteNumber(lat) || !isFiniteNumber(lon)) continue;
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) continue;

    out.push({
      id: placeIdFor(lat, lon),
      name: name.trim(),
      lat,
      lon,
      radiusM: isFiniteNumber(radiusM) && radiusM > 0 ? radiusM : DEFAULT_PLACE_RADIUS_M,
    });
  }
  return out;
}
