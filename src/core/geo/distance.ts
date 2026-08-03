import type { LatLon } from './types';

/** IUGG mean earth radius. */
export const EARTH_RADIUS_M = 6_371_008.8;

const DEG_TO_RAD = Math.PI / 180;

/**
 * Great-circle distance in metres.
 *
 * Haversine rather than the flat-earth approximation that is tempting at these
 * scales, and rather than Vincenty which is more precise than a GPS fix
 * deserves. Two properties earn it its place:
 *
 * - It is correct across the antimeridian and at the poles. The obvious
 *   `dlon = b.lon - a.lon` planar formula reports 40,000 km for a step across
 *   longitude 180, which the plausibility filter would then reject as a
 *   teleport, silently ending everyone's activity at that line.
 * - It is numerically stable for the short steps that dominate here. The
 *   spherical law of cosines loses precision below about a metre, and a metre
 *   is exactly the scale of a stationary phone's jitter — the input that
 *   decides "moving" from "still".
 */
export function distanceM(a: LatLon, b: LatLon): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLat = (b.lat - a.lat) * DEG_TO_RAD;
  const dLon = (b.lon - a.lon) * DEG_TO_RAD;

  const sinHalfLat = Math.sin(dLat / 2);
  const sinHalfLon = Math.sin(dLon / 2);

  const h = sinHalfLat * sinHalfLat + Math.cos(lat1) * Math.cos(lat2) * sinHalfLon * sinHalfLon;

  // `Math.min(1, ...)` guards the case where rounding pushes h a hair above 1
  // for antipodal points, which would make asin return NaN.
  return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(Math.min(1, h)));
}

/** Initial bearing from `a` to `b`, in degrees clockwise from true north (0..360). */
export function bearingDeg(a: LatLon, b: LatLon): number {
  const lat1 = a.lat * DEG_TO_RAD;
  const lat2 = b.lat * DEG_TO_RAD;
  const dLon = (b.lon - a.lon) * DEG_TO_RAD;

  const y = Math.sin(dLon) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);

  return (Math.atan2(y, x) / DEG_TO_RAD + 360) % 360;
}

/** Total length of a path, in metres. Zero for a path of fewer than two points. */
export function pathLengthM(path: readonly LatLon[]): number {
  let total = 0;
  for (let i = 1; i < path.length; i += 1) {
    const previous = path[i - 1];
    const current = path[i];
    // Indices are in range by construction; the guard is what
    // `noUncheckedIndexedAccess` asks for and costs nothing.
    if (previous && current) total += distanceM(previous, current);
  }
  return total;
}

/**
 * The mean of a set of points.
 *
 * A plain arithmetic mean of degrees, which is wrong at the antimeridian and
 * meaningless at the poles. That is an accepted limit, not an oversight: this
 * is used for the display centre of a *stay* — a place you stood for minutes,
 * spanning metres. A stay that straddles longitude 180 would need a vector mean
 * over unit vectors, and nothing else in the app would notice the difference.
 */
export function centroid(points: readonly LatLon[]): LatLon | null {
  if (points.length === 0) return null;
  let lat = 0;
  let lon = 0;
  for (const point of points) {
    lat += point.lat;
    lon += point.lon;
  }
  return { lat: lat / points.length, lon: lon / points.length };
}
