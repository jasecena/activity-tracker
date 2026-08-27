/**
 * Geodesy and fix hygiene.
 *
 * The bottom layer of the engine: it knows how far apart two points are and
 * whether a reading is worth believing, and nothing whatsoever about days,
 * activities or the app.
 */
export { bearingDeg, centroid, distanceM, EARTH_RADIUS_M, pathLengthM } from './distance';
export { judgeFix } from './filter';
export { directionsUrl, mapsUrl } from './maps';
export type { FixFilterConfig, FixVerdict, RejectionReason } from './filter';
export {
  boundsOf,
  centerOf,
  niceScaleMetres,
  padBounds,
  projectToBox,
  spanMetresOf,
  unionBounds,
  zoomForBounds,
} from './project';
export type { Bounds, Box, Point } from './project';
export type { Fix, LatLon, PathPoint } from './types';
