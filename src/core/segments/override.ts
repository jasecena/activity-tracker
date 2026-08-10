import type { ActivityMode, JourneyLabel } from './index';

/**
 * Saying what a journey really was, when the classifier could not.
 *
 * Mode is inferred from speed alone — Core Motion's activity classifier has no
 * Expo binding — so a slow cycle and a fast walk are genuinely hard to tell
 * apart, and the app gets one of them wrong sometimes. This is the correction,
 * and it is deliberately not a new kind of record: a `JourneyLabel` already
 * carries a mode that overrules the classifier for a stretch of time, so
 * choosing one is writing a label that has a mode and nothing else.
 *
 * That matters more than it sounds. A label is stored as a **time range**, so
 * it is re-cut against whatever the day looks like now, and re-deriving the day
 * under a different preset cannot orphan it. A mode written onto a segment
 * would be a derived value with something stored on top of it, which is the one
 * shape this engine does not have anywhere.
 *
 * **Reverting is the absence of the override, not another one.** The detected
 * mode is never stored, so it cannot be lost — it is re-derived from the fixes
 * every time the day is folded, and taking the label away is enough to get it
 * back. There is no "original" to keep a copy of.
 */

/**
 * The label that expresses "this stretch was a `mode`", or `null` to say
 * nothing and let the classifier speak again.
 *
 * An existing name is carried through untouched: naming a journey and
 * correcting its mode are two different sentences about the same stretch, and
 * neither should quietly undo the other.
 *
 * Returning `null` rather than a label with `mode: null` is what makes revert
 * complete. A nameless, modeless label is not a neutral record — it is exactly
 * the shape a merge had, so it says nothing, survives nothing, and would sit in
 * the store as a row that means "no opinion".
 */
export function overrideFor(
  span: { readonly startedAt: number; readonly endedAt: number },
  mode: ActivityMode | null,
  existing: JourneyLabel | undefined,
  idFor: (startedAt: number) => string,
): JourneyLabel | null {
  const name = existing?.label ?? '';
  if (mode === null && name.length === 0) return null;

  return {
    id: idFor(span.startedAt),
    label: name,
    mode,
    startedAt: span.startedAt,
    endedAt: span.endedAt,
  };
}

/**
 * Whether a stored label still says anything.
 *
 * The load-time sweep that takes apart the merges made by an older build asks
 * this, and it used to ask only about the name. That was right when a mode
 * could only arrive with one — and it is the reason this function exists rather
 * than the one-line filter it replaces: a mode correction has no name by
 * design, so the old rule would have deleted every one of them on the next
 * launch, silently, while the app looked like it had saved them.
 *
 * A merge was nameless *and* modeless, so it still goes.
 */
export function saysSomething(label: JourneyLabel): boolean {
  return label.label.length > 0 || label.mode !== null;
}
