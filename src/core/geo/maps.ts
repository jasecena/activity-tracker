import type { LatLon } from './types';

/**
 * A link that opens one coordinate in the Maps app.
 *
 * **Pure, and here rather than beside the `Linking` call, because the awkward
 * part is the string.** Handing a URL to iOS is one line and cannot fail
 * usefully; deciding what that URL says — how many decimal places, what happens
 * to a NaN, what a Persian place name does to a query string — is the part with
 * answers that can be wrong, so it lives where it can be tested on plain Node.
 *
 * `https://maps.apple.com/` rather than the `maps://` scheme. Both open the
 * Maps app on a device, and the https one is also a working link anywhere else
 * — in a screenshot, in a note to somebody, on a laptop. A scheme URL in those
 * places is a dead string.
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
export function mapsUrl(at: LatLon | null | undefined, label = ''): string | null {
  if (!at) return null;
  if (!usable(at.lat, 90) || !usable(at.lon, 180)) return null;

  const ll = `${at.lat.toFixed(DECIMALS)},${at.lon.toFixed(DECIMALS)}`;
  const url = `https://maps.apple.com/?ll=${ll}`;

  // **`q` with `ll` is what drops a pin**, rather than merely centring the map
  // there. Without it the map opens on the right spot with nothing marked, and
  // "where exactly was this stay" is precisely the question being asked.
  //
  // Encoded, because a place name here is frequently Persian and may contain
  // anything somebody typed into a rename field — including the `&` that would
  // otherwise end the parameter and start a new one.
  const name = label.trim();
  return name ? `${url}&q=${encodeURIComponent(name)}` : url;
}

/**
 * A link that opens the route between two points.
 *
 * **A journey is not a pin.** Opening one at its midpoint answers nothing —
 * what you want to see is where it went, and Apple Maps will draw that from a
 * start and an end. It is the Maps app's own idea of the route rather than the
 * one actually walked, which is a real difference and an acceptable one: the
 * fixes behind it are gone once the day is frozen, and this is for orienting
 * yourself rather than for evidence.
 *
 * `dirflg=w` asks for walking directions. Not because every journey was walked,
 * but because it is the mode that follows paths rather than roads, so a route
 * through a park comes out looking like the one you took instead of a detour
 * round it.
 */
export function directionsUrl(from: LatLon | null | undefined, to: LatLon | null | undefined): string | null {
  if (!from || !to) return null;
  if (!usable(from.lat, 90) || !usable(from.lon, 180)) return null;
  if (!usable(to.lat, 90) || !usable(to.lon, 180)) return null;

  const start = `${from.lat.toFixed(DECIMALS)},${from.lon.toFixed(DECIMALS)}`;
  const end = `${to.lat.toFixed(DECIMALS)},${to.lon.toFixed(DECIMALS)}`;
  return `https://maps.apple.com/?saddr=${start}&daddr=${end}&dirflg=w`;
}
