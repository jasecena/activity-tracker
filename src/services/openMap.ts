import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { directionsUrl, mapsUrl } from '@/core/geo';
import type { LatLon } from '@/core/geo/types';

/**
 * Opening a map, or the planner, without leaving the app.
 *
 * **`SFSafariViewController`, not the browser and not a hand-off.** The page
 * arrives over the top of whatever you were reading and a Done button puts you
 * back where you were — rather than the app switcher, and whatever screen this
 * app happens to restore to. That matters most on the one journey this exists
 * for: look at where a stop was, come back, look at the next one.
 *
 * **It is still not this app making the request, and the distinction survives
 * the move.** The view controller runs out of process, with its own cookies and
 * its own storage; this app can neither read what it loads nor see where it
 * goes next. What changed is that the page appears in front of you here rather
 * than in another app — which reads differently to somebody looking at it, so
 * the Settings paragraph says so in those words.
 *
 * **The cost, stated: an in-app browser never hands off to the Google Maps
 * app.** A universal link opens an installed app only from the system browser,
 * so a map opened here is the website, with its own "open in the app" banner.
 * That is the trade that was asked for — staying put beats the native map — and
 * it is written down because the way back is one line.
 */

export type OpenMapOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: 'no-coordinate' | 'failed'; readonly detail?: string };

/**
 * Dark, because everything else here is.
 *
 * The bars take the app's own surface colour rather than the default white,
 * which otherwise arrives as a bright band over a dark screen. `src/theme` is
 * not imported — that is UI and this is a service — so two literals are the
 * price of the boundary, and this is the only place in the app that pays it.
 */
const CHROME = {
  toolbarColor: '#151C24',
  controlsColor: '#38BDF8',
  // A sheet rather than a full-screen push: the app stays visible behind it,
  // which is the whole point of not leaving.
  presentationStyle: WebBrowser.WebBrowserPresentationStyle.PAGE_SHEET,
} as const;

async function show(url: string): Promise<OpenMapOutcome> {
  try {
    await WebBrowser.openBrowserAsync(url, CHROME);
    return { ok: true };
  } catch (error) {
    // **Hands it over rather than failing.** The in-app browser is the nicer of
    // two ways to read a web page, not the only one, and a device that will not
    // present one should still be able to look at a map.
    try {
      await Linking.openURL(url);
      return { ok: true };
    } catch {
      return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : undefined };
    }
  }
}

/**
 * One coordinate, on a map.
 *
 * Null in, or a coordinate that is not one, and nothing opens: a NaN formats
 * into a perfectly valid URL that lands in the middle of the ocean, which on
 * screen is indistinguishable from the app being confidently wrong about where
 * you were. Callers hide the control instead.
 */
export async function openInMaps(at: LatLon | null | undefined): Promise<OpenMapOutcome> {
  const url = mapsUrl(at);
  if (!url) return { ok: false, reason: 'no-coordinate' };
  return show(url);
}

/**
 * The route between two points.
 *
 * Separate from `openInMaps` rather than an optional second argument: a caller
 * either has one coordinate or two, and a function that quietly does something
 * different depending on whether an argument was null is one whose behaviour
 * has to be read rather than known.
 */
export async function openRouteInMaps(
  from: LatLon | null | undefined,
  to: LatLon | null | undefined,
): Promise<OpenMapOutcome> {
  const url = directionsUrl(from, to);
  if (!url) return { ok: false, reason: 'no-coordinate' };
  return show(url);
}

/**
 * The planner's own page, on the VPN.
 *
 * Opens the same way a map does, which is why it is here rather than in a file
 * of its own: this module is what it says it is, the one place that puts a web
 * page in front of somebody.
 *
 * It fails in the ordinary way when the phone is not on the VPN — a browser
 * saying it cannot reach the site — which is not something this app can
 * usefully pre-empt.
 */
export async function openPlanner(url: string): Promise<OpenMapOutcome> {
  const trimmed = url.trim();
  // https only. The value comes out of a text box in Settings, and the two
  // schemes worth refusing outright are `javascript:` and `file:` — neither is
  // a website, and both are things a browser would otherwise be asked to do.
  if (!/^https:\/\//i.test(trimmed)) return { ok: false, reason: 'no-coordinate' };
  return show(trimmed);
}
