import { Linking } from 'react-native';

import { directionsUrl, mapsUrl } from '@/core/geo';
import type { LatLon } from '@/core/geo/types';

/**
 * Handing one coordinate to the Maps app.
 *
 * **The second place data leaves this app on purpose, and the smaller of the
 * two.** `services/exportFile.ts` hands a whole file to the share sheet; this
 * hands over a single pair of numbers and the name you gave the spot. Both are
 * the same shape of decision: the app stops being responsible for a copy the
 * moment somebody chooses to make one.
 *
 * **It is still not a network request by this app**, and the distinction is
 * worth keeping straight because the Settings paragraph depends on it. Nothing
 * here opens a socket. iOS is asked to open a URL; Maps does whatever Maps
 * does, including talking to Apple — which it would do anyway the moment you
 * opened it yourself. That is a different claim from `mapsEnabled`, which
 * governs this app fetching map tiles into its own screens, and is why this is
 * not behind that switch: one is the app reaching out, the other is you leaving.
 *
 * Every call is a deliberate press. Nothing here runs on its own.
 */

export type OpenMapOutcome =
  { readonly ok: true } | { readonly ok: false; readonly reason: 'no-coordinate' | 'failed'; readonly detail?: string };

export async function openInMaps(at: LatLon | null | undefined, label = ''): Promise<OpenMapOutcome> {
  const url = mapsUrl(at, label);
  // A stay with no usable centre has nowhere to open. The caller hides the
  // control rather than offering one that apologises, so reaching here means
  // something changed underneath — say which of the two failures it was.
  if (!url) return { ok: false, reason: 'no-coordinate' };

  try {
    await Linking.openURL(url);
    return { ok: true };
  } catch (error) {
    // `canOpenURL` is deliberately not consulted first. For an https link it
    // answers yes on any device with a browser, so it would refuse nothing and
    // cost a round trip through the bridge to learn it — and on iOS it needs
    // the scheme declared in `LSApplicationQueriesSchemes` to answer usefully
    // at all. Trying and reporting the failure is both simpler and truer.
    return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : undefined };
  }
}

/**
 * The route between two points, handed to Maps the same way.
 *
 * Separate from `openInMaps` rather than an optional second argument: a caller
 * either has one coordinate or two, and a function that quietly does something
 * different depending on whether an argument was null is a function whose
 * behaviour has to be read rather than known.
 */
export async function openRouteInMaps(
  from: LatLon | null | undefined,
  to: LatLon | null | undefined,
): Promise<OpenMapOutcome> {
  const url = directionsUrl(from, to);
  if (!url) return { ok: false, reason: 'no-coordinate' };
  try {
    await Linking.openURL(url);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : undefined };
  }
}

/**
 * Open a page in the browser.
 *
 * **Here rather than in a file of its own**, because this module is already
 * what it says it is: the one place that hands something to another app. A
 * second module for a second URL would be a boundary around one caller.
 *
 * The planner is on the VPN, so this fails in the ordinary way when the phone
 * is not on it — which is a browser saying it cannot reach the site, not
 * something this app can usefully pre-empt.
 */
export async function openPlanner(url: string): Promise<OpenMapOutcome> {
  const trimmed = url.trim();
  // https only. A settings field is a text box, and the two schemes worth
  // refusing outright are `javascript:` and `file:` — neither is a website, and
  // both are things `openURL` would otherwise be asked to do.
  if (!/^https:\/\//i.test(trimmed)) return { ok: false, reason: 'no-coordinate' };
  try {
    await Linking.openURL(trimmed);
    return { ok: true };
  } catch (error) {
    return { ok: false, reason: 'failed', detail: error instanceof Error ? error.message : undefined };
  }
}
