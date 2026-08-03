/**
 * Geodesy and fix hygiene.
 *
 * The bottom layer of the engine: it knows how far apart two points are and
 * whether a reading is worth believing, and nothing whatsoever about days,
 * activities or the app.
 */
export { bearingDeg, centroid, distanceM, EARTH_RADIUS_M, pathLengthM } from './distance';
export { judgeFix } from './filter';
export type { FixFilterConfig, FixVerdict, RejectionReason } from './filter';
export type { Fix, LatLon, PathPoint } from './types';
