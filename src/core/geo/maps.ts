import type { LatLon } from './types';

/**
 * A link that opens one coordinate on a map.
 *
 * **Pure, and here rather than beside the `Linking` call, because the awkward
 * part is the string.** Handing a URL to iOS is one line and cannot fail
 * usefully; deciding what that URL says — how many decimal places, what happens
 * to a NaN — is the part with answers that can be wrong, so it lives where it
 * can be tested on plain Node.
 *
 * **Google Maps, through the documented Maps URLs form.** `?api=1` is the
 * contract Google publishes and undertakes to keep; the older
 * `maps.google.com/?q=` shapes work and are specified nowhere, which is a poor
 * foundation for a link this app builds every time it draws a list.
 *
 * `https://` rather than a `comgooglemaps://` scheme, and that matters more
 * than it used to: these open in an in-app browser, which never sees an app
 * scheme at all. It is also a working link anywhere else — in a screenshot, in
 * a message to somebody, on a laptop — where a scheme URL is a dead string.
 */

/**
 * Six decimal places, which is about eleven centimetres.
 *
 * More precision than the fix that produced it could possibly justify, and that
 * is deliberate: this number is not a claim about accuracy, it is the address of
 * a pin. Rounding it to something "honest" would move the pin away from the
 * coordinate the app actually stored, which is the one thing somebody opening
 * this link is trying to see.
 */
const DECIMALS = 6;

function usable(value: number, limit: number): boolean {
  return Number.isFinite(value) && Math.abs(value) <= limit;
}

/**
 * The link, or null when there is no coordinate worth opening.
 *
 * **Null rather than a link to nowhere.** A NaN latitude formats as the string
 * "NaN" and produces a URL Maps will happily open at the middle of the ocean —
 * which is indistinguishable, on the screen, from the app being confidently
 * wrong about where you were. The same reasoning `normalizePlaces` uses when it
 * drops an unusable place instead of repairing one: a caller that gets null can
 * hide the button, and a caller that gets a link can trust it.
 */
export function mapsUrl(at: LatLon | null | undefined): string | null {
  if (!at) return null;
  if (!usable(at.lat, 90) || !usable(at.lon, 180)) return null;

  // `search` with a coordinate drops a pin on it. **There is no label**, and
  // that is Google's API rather than an omission here: `query` takes either a
  // place to search for or a coordinate to mark, and a name attached to a
  // coordinate is not something the documented form expresses. The undocumented
  // `?q=lat,lon(Name)` does it and is not specified anywhere, which is a poor
  // thing to build on. The screen the link came from says which stay it was.
  const ll = `${at.lat.toFixed(DECIMALS)},${at.lon.toFixed(DECIMALS)}`;
  return `https://www.google.com/maps/search/?api=1&query=${ll}`;
}

/**
 * A link that opens the route between two points.
 *
 * **A journey is not a pin.** Opening one at its midpoint answers nothing —
 * what you want to see is where it went, and Google will draw that from a start
 * and an end. It is Google's idea of the route rather than the one actually
 * walked, which is a real difference and an acceptable one: the fixes behind it
 * are gone once the day is frozen, and this is for orienting yourself rather
 * than for evidence.
 *
 * `travelmode=walking` for the same reason a `dirflg` did before it: not
 * because every journey was walked, but because walking follows paths rather
 * than roads, so a route through a park comes out looking like the one you took
 * instead of a detour round it by car.
 */
export function directionsUrl(from: LatLon | null | undefined, to: LatLon | null | undefined): string | null {
  if (!from || !to) return null;
  if (!usable(from.lat, 90) || !usable(from.lon, 180)) return null;
  if (!usable(to.lat, 90) || !usable(to.lon, 180)) return null;

  const start = `${from.lat.toFixed(DECIMALS)},${from.lon.toFixed(DECIMALS)}`;
  const end = `${to.lat.toFixed(DECIMALS)},${to.lon.toFixed(DECIMALS)}`;
  return `https://www.google.com/maps/dir/?api=1&origin=${start}&destination=${end}&travelmode=walking`;
}
