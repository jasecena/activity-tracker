/**
 * The physical lenses on the back of the phone.
 *
 * `expo-camera` reports them as Apple's own device-type strings —
 * `builtInUltraWideCamera` and the rest — and takes one back as `selectedLens`.
 * They are opaque identifiers, so everything here is translation and ordering:
 * what to call one on a button, and which order they belong in.
 *
 * **They are not magnifications.** Apple's names say what a lens *is*, not what
 * it multiplies by, and the multiplier differs between phones — the telephoto
 * is 2×, 3× or 5× depending on the model, and nothing in the API says which.
 * Printing "2×" would be printing a guess as a fact, which is the same reason
 * the zoom dial reads a percentage.
 */

/**
 * What to call each lens, in the order they belong on a rail.
 *
 * Widest first, which is how every camera app lays them out and how the phone
 * is physically arranged. The virtual devices — the dual and triple cameras
 * that switch between the real ones for you — come last, because choosing one
 * is choosing *not* to choose.
 */
const KNOWN: readonly { readonly id: string; readonly label: string }[] = [
  { id: 'builtInUltraWideCamera', label: 'Ultra wide' },
  { id: 'builtInWideAngleCamera', label: 'Wide' },
  { id: 'builtInTelephotoCamera', label: 'Tele' },
  { id: 'builtInDualWideCamera', label: 'Dual wide' },
  { id: 'builtInDualCamera', label: 'Dual' },
  { id: 'builtInTripleCamera', label: 'Triple' },
  { id: 'builtInTrueDepthCamera', label: 'TrueDepth' },
  { id: 'builtInLiDARDepthCamera', label: 'LiDAR' },
];

/**
 * A readable name for a lens, including one nobody has heard of yet.
 *
 * Apple adds device types with new phones, and a rail that shows a raw
 * `builtInSomethingNewCamera` is worse than one that shows "Something new" —
 * but dropping an unknown lens entirely would hide a real camera on a phone
 * this build has never seen. So the fallback un-camel-cases it and moves on.
 */
export function lensLabel(id: string): string {
  const known = KNOWN.find((lens) => lens.id === id);
  if (known) return known.label;

  const stripped = id.replace(/^builtIn/, '').replace(/Camera$/, '');
  if (stripped.length === 0) return id;

  const spaced = stripped.replace(/([a-z])([A-Z])/g, '$1 $2');
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

/**
 * The lenses in the order a rail should show them, widest first.
 *
 * Anything unrecognised keeps its position relative to the other unknowns and
 * goes after everything known — a lens this build cannot place is still a lens,
 * and guessing where it sits in the sequence would be worse than putting it at
 * the end.
 */
export function orderLenses(ids: readonly string[]): readonly string[] {
  const rank = (id: string) => {
    const index = KNOWN.findIndex((lens) => lens.id === id);
    return index === -1 ? KNOWN.length : index;
  };
  return [...ids].sort((a, b) => rank(a) - rank(b));
}

/**
 * Whether a rail is worth drawing at all.
 *
 * One lens is not a choice, and the front camera usually has exactly one. A
 * control that cannot change anything is furniture over the viewfinder.
 */
export function worthOffering(ids: readonly string[]): boolean {
  return ids.length > 1;
}
