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
 * Widen an existing place to take in a stay that fell outside it.
 *
 * What "this is the same place" means when you say it about a stay 200 m from
 * somewhere already named. The alternative — creating a second place with the
 * same name — leaves the timeline showing two identical rows and the totals
 * split between them.
 *
 * The centre does not move. It came from a visit and is as good as any other;
 * dragging it towards each new stay would let a place wander down the street
 * over a year of visits.
 */
export function widenToInclude(place: Place, stay: StaySegment, marginM = 20): Place {
  const away = distanceM(stay.center, place);
  if (away <= place.radiusM) return place;
  return { ...place, radiusM: away + marginM };
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

export interface PlaceCandidate {
  readonly place: Place;
  readonly distanceM: number;
  /**
   * Inside this place's own radius — meaning `matchPlace` would have picked it
   * automatically, given the chance.
   */
  readonly withinRadius: boolean;
}

/**
 * How far out to offer places that did not match automatically.
 *
 * Wider than a place's own radius on purpose: the useful question when naming a
 * stay is not only "which of these did I match" but "is this the same place as
 * one just outside the circle". A café you named from a visit with good signal
 * can easily be 150 m from the same café recorded from indoors.
 */
export const CANDIDATE_SEARCH_RADIUS_M = 400;

export interface CandidateOptions {
  readonly searchRadiusM?: number;
  readonly limit?: number;
}

/**
 * Every place this stay could plausibly be, nearest first.
 *
 * `matchPlace` answers with one place because the timeline needs a single label
 * for a row. This answers with the whole list, because *naming* a stay is a
 * decision only the person who was there can make: two named places can overlap
 * — a café inside a shopping centre — and the app picking the nearer one is a
 * guess presented as a fact.
 *
 * The result includes places the stay falls outside of, flagged as such. The UI
 * offers them as "or is this the same as…" rather than filtering them out,
 * because a place recorded from indoors and the same place recorded outside can
 * sit a couple of hundred metres apart.
 */
export function rankPlaceCandidates(
  stay: StaySegment,
  places: readonly Place[],
  options: CandidateOptions = {},
): readonly PlaceCandidate[] {
  const searchRadiusM = options.searchRadiusM ?? CANDIDATE_SEARCH_RADIUS_M;

  const candidates: PlaceCandidate[] = [];
  for (const place of places) {
    const away = distanceM(stay.center, place);
    // Either near enough to be worth offering, or inside a place whose own
    // radius is wider than the search — a named shopping centre, say.
    if (away > searchRadiusM && away > place.radiusM) continue;
    candidates.push({ place, distanceM: away, withinRadius: away <= place.radiusM });
  }

  candidates.sort((a, b) => a.distanceM - b.distanceM);
  return options.limit === undefined ? candidates : candidates.slice(0, options.limit);
}

/**
 * Would picking one of these automatically be a guess?
 *
 * True when more than one named place claims this stay. The timeline still has
 * to show something — `matchPlace` takes the nearest — but the naming UI asks
 * rather than assuming, and this is the signal it asks on.
 */
export function isAmbiguous(candidates: readonly PlaceCandidate[]): boolean {
  return candidates.filter((candidate) => candidate.withinRadius).length > 1;
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
