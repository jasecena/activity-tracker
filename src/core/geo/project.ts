import { distanceM, EARTH_RADIUS_M } from './distance';
import type { LatLon } from './types';

/**
 * Putting coordinates on a screen.
 *
 * Equirectangular, with longitude scaled by the cosine of the mean latitude.
 * That is the right projection for exactly the reason a better one would be
 * wrong here: everything this app draws fits inside a day's travel, where the
 * error of treating the earth as flat is far below the width of the line, and
 * where the property that actually matters is that the *shape* is right. Skip
 * the cosine and a route at 55° comes out nearly twice as wide as it was, which
 * turns a walk round a square block into a walk round a rectangle.
 *
 * This lives in `core` and not in the component that draws, because two things
 * draw now — the offline canvas and the sparkline — and a second copy of this
 * arithmetic would drift from the first without anything failing.
 */

const DEG_TO_RAD = Math.PI / 180;

/** One degree of latitude, at the mean earth radius the rest of `geo` uses. */
const METRES_PER_DEGREE_LAT = DEG_TO_RAD * EARTH_RADIUS_M;

/** A rectangle in degrees. Not a viewport: the *content*, before any fitting. */
export interface Bounds {
  readonly minLat: number;
  readonly maxLat: number;
  readonly minLon: number;
  readonly maxLon: number;
}

/** A rectangle in whatever units the caller draws in. Pixels, usually. */
export interface Box {
  readonly width: number;
  readonly height: number;
  /** Kept clear on all four sides, so a route never runs into the edge. */
  readonly padding?: number;
}

export interface Point {
  readonly x: number;
  readonly y: number;
}

/** The smallest rectangle containing every point, or null for none. */
export function boundsOf(points: readonly LatLon[]): Bounds | null {
  const first = points[0];
  if (!first) return null;

  let minLat = first.lat;
  let maxLat = first.lat;
  let minLon = first.lon;
  let maxLon = first.lon;

  for (const point of points) {
    if (point.lat < minLat) minLat = point.lat;
    if (point.lat > maxLat) maxLat = point.lat;
    if (point.lon < minLon) minLon = point.lon;
    if (point.lon > maxLon) maxLon = point.lon;
  }

  return { minLat, maxLat, minLon, maxLon };
}

/** The union of two rectangles — how several routes end up framed together. */
export function unionBounds(a: Bounds | null, b: Bounds | null): Bounds | null {
  if (!a) return b;
  if (!b) return a;
  return {
    minLat: Math.min(a.minLat, b.minLat),
    maxLat: Math.max(a.maxLat, b.maxLat),
    minLon: Math.min(a.minLon, b.minLon),
    maxLon: Math.max(a.maxLon, b.maxLon),
  };
}

export function centerOf(bounds: Bounds): LatLon {
  return { lat: (bounds.minLat + bounds.maxLat) / 2, lon: (bounds.minLon + bounds.maxLon) / 2 };
}

/**
 * Grow a rectangle so it covers at least `metres` in both directions.
 *
 * What stops a stay — a dot with a couple of metres of jitter around it — from
 * being drawn at a zoom level where the jitter fills the screen and the app
 * appears to claim you walked in circles for two hours.
 */
export function padBounds(bounds: Bounds, metres: number): Bounds {
  const span = spanMetresOf(bounds);
  const center = centerOf(bounds);

  const latPad = Math.max(0, metres - span.northSouth) / 2 / METRES_PER_DEGREE_LAT;
  // Guarded against a pole, where a degree of longitude is worth nothing and
  // the division would run away.
  const metresPerDegreeLon = Math.max(1, METRES_PER_DEGREE_LAT * Math.cos(center.lat * DEG_TO_RAD));
  const lonPad = Math.max(0, metres - span.eastWest) / 2 / metresPerDegreeLon;

  return {
    minLat: bounds.minLat - latPad,
    maxLat: bounds.maxLat + latPad,
    minLon: bounds.minLon - lonPad,
    maxLon: bounds.maxLon + lonPad,
  };
}

/** How wide and how tall a rectangle is on the ground, in metres. */
export function spanMetresOf(bounds: Bounds): { readonly eastWest: number; readonly northSouth: number } {
  const midLat = (bounds.minLat + bounds.maxLat) / 2;
  return {
    eastWest: distanceM({ lat: midLat, lon: bounds.minLon }, { lat: midLat, lon: bounds.maxLon }),
    northSouth: distanceM({ lat: bounds.minLat, lon: bounds.minLon }, { lat: bounds.maxLat, lon: bounds.minLon }),
  };
}

/**
 * Project points into a box, preserving aspect ratio and centring what is left
 * over.
 *
 * Two details that are easy to get wrong and both visible immediately:
 *
 * - **y is flipped.** Screen coordinates grow downward and north does not.
 * - **A zero span is centred, not divided by.** A route can be a dead straight
 *   line, or a stay can be a single point, and either would otherwise scale by
 *   infinity.
 */
export function projectToBox(points: readonly LatLon[], bounds: Bounds, box: Box): Point[] {
  const padding = box.padding ?? 0;
  const innerWidth = Math.max(1, box.width - padding * 2);
  const innerHeight = Math.max(1, box.height - padding * 2);

  const lonScale = Math.cos(((bounds.minLat + bounds.maxLat) / 2) * DEG_TO_RAD);

  const spanX = (bounds.maxLon - bounds.minLon) * lonScale;
  const spanY = bounds.maxLat - bounds.minLat;

  // One scale for both axes, so a square block stays square. When a span is
  // zero the other axis decides the scale; when both are, the fallback of 1
  // simply puts everything in the middle.
  const scaleX = spanX > 0 ? innerWidth / spanX : Infinity;
  const scaleY = spanY > 0 ? innerHeight / spanY : Infinity;
  const scale = Number.isFinite(Math.min(scaleX, scaleY)) ? Math.min(scaleX, scaleY) : 1;

  const offsetX = padding + (innerWidth - spanX * scale) / 2;
  const offsetY = padding + (innerHeight - spanY * scale) / 2;

  return points.map((point) => ({
    x: offsetX + (point.lon * lonScale - bounds.minLon * lonScale) * scale,
    y: box.height - (offsetY + (point.lat - bounds.minLat) * scale),
  }));
}

/**
 * The zoom level that frames `bounds` in a box of `width` points.
 *
 * MapKit's zoom is the web-mercator tile convention that `expo-maps` exposes:
 * level 0 puts the whole world in 256 points, and every level doubles it. The
 * app works out its own rather than letting the map fit the overlay, so a route
 * is framed the same whether or not the map imagery is switched on — flipping
 * that setting should change what is *under* the line, not where the line sits.
 */
export function zoomForBounds(bounds: Bounds, box: Box): number {
  const TILE = 256;
  const padding = box.padding ?? 0;
  const innerWidth = Math.max(1, box.width - padding * 2);
  const innerHeight = Math.max(1, box.height - padding * 2);

  const lonSpan = Math.max(bounds.maxLon - bounds.minLon, 1e-6);
  const latSpan = Math.max(bounds.maxLat - bounds.minLat, 1e-6);

  const zoomX = Math.log2((innerWidth / TILE) * (360 / lonSpan));
  // Latitude compressed the mercator way, which is what the tile grid does.
  const zoomY = Math.log2((innerHeight / TILE) * (180 / latSpan));

  // Clamped: past 20 the imagery has nothing more to show, and below 1 the map
  // is a globe with a dot on it.
  return Math.max(1, Math.min(20, Math.min(zoomX, zoomY)));
}

/**
 * A round number of metres that is at most `maxMetres`, for a scale bar.
 *
 * 1-2-5 rather than anything the span happens to be: "437 m" under a bar tells
 * you the author did not round, not that the map is precise.
 */
export function niceScaleMetres(maxMetres: number): number {
  if (!Number.isFinite(maxMetres) || maxMetres <= 0) return 1;
  const magnitude = 10 ** Math.floor(Math.log10(maxMetres));
  for (const step of [5, 2, 1]) {
    if (magnitude * step <= maxMetres) return magnitude * step;
  }
  return magnitude / 2;
}
