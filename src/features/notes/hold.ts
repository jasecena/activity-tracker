/**
 * How long the microphone has to be held before it starts listening, in ms.
 *
 * **The gesture is the whole point of the number.** Recording and typing are
 * two hands on the same note, and the recorder sits in the sheet next to the
 * field — one tap away from the keyboard, the Save button and the date pickers.
 * A tap that starts a recording there is a tap you make by accident, and the
 * accident is expensive in both directions: a recording nobody wanted, or a
 * double tap that starts and stops one and leaves a second of silence attached
 * to the entry.
 *
 * A second is long enough that no stray touch reaches it and short enough that
 * nobody deliberately holding the button doubts it is working — helped by the
 * ring, which is what turns "nothing has happened yet" into "it has started and
 * you are most of the way there".
 *
 * Stopping stays a tap. The confusion was only ever about beginning something
 * you did not mean to; nobody holds a button for a second to end a recording
 * they are watching the clock of.
 */
export const HOLD_MS = 1000;

/** How often the ring is redrawn while the button is held down. */
export const HOLD_TICK_MS = 40;

/**
 * How much of the ring is filled, from 0 to 1, after `elapsedMs` of holding.
 *
 * Clamped at both ends rather than merely divided: a timer that fires late — and
 * on a phone one always eventually does — would otherwise draw an arc longer
 * than the circle, and a negative elapsed (the wall clock corrected mid-hold)
 * would draw one backwards. Pure, so the arithmetic is asserted directly
 * instead of through an animation nobody can watch in a test.
 */
export function holdFraction(elapsedMs: number, holdMs: number = HOLD_MS): number {
  if (!Number.isFinite(elapsedMs) || elapsedMs <= 0) return 0;
  if (holdMs <= 0) return 1;
  return Math.min(1, elapsedMs / holdMs);
}

/**
 * The stroke offset that draws `fraction` of a circle of radius `r`.
 *
 * `strokeDasharray` is set to the whole circumference and the dash is pushed
 * out of view by this much, so 0 draws nothing and 1 draws the full ring. The
 * arithmetic lives here because it is the one part of the control that can be
 * wrong in a way nobody notices — a ring that reads full at three-quarters is
 * an instruction to let go too early.
 */
export function ringDashOffset(fraction: number, radius: number): number {
  const circumference = 2 * Math.PI * radius;
  return circumference * (1 - holdFraction(fraction, 1));
}
