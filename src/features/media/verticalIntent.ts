/**
 * The two vertical gestures on a capture: up for what the app knows about it,
 * down for the grid of every day.
 *
 * Exported and tested directly, the same as `SwipeBackPage`'s decisions and
 * for the same reason — a `PanResponder` cannot be driven faithfully by
 * synthetic events, so testing through the renderer proves the wiring and
 * nothing about the rule, and the rule is the part that can be wrong.
 *
 * The last gesture built on a threshold-guess failed on a real phone. This one
 * has a structural advantage that one lacked: the pager under it scrolls
 * *horizontally*, so a decisively vertical drag has no other claimant — the
 * contest the timeline swipe kept losing does not exist here.
 */

/** How much more vertical than horizontal a drag must be before it is claimed. */
const DOMINANCE = 1.4;

/** Far enough to mean it, once let go. */
const COMMIT_Y = 56;

/** Or fast enough: a flick is short but unmistakable. */
const FLICK_VELOCITY = 0.6;

export function isVerticalDrag(dx: number, dy: number): boolean {
  return Math.abs(dy) > Math.abs(dx) * DOMINANCE && Math.abs(dy) > 8;
}

/**
 * What letting go means: `info` for up, `grid` for down, null for a drag that
 * never got far enough to be either.
 */
export function releasedIntent(dy: number, vy: number): 'info' | 'grid' | null {
  if (dy < -COMMIT_Y || vy < -FLICK_VELOCITY) return 'info';
  if (dy > COMMIT_Y || vy > FLICK_VELOCITY) return 'grid';
  return null;
}

/** What is covering the capture, if anything. */
export type Panel = 'none' | 'info' | 'grid';

/**
 * Whether the capture on this page should be open and playing.
 *
 * A panel over the capture means you are not looking at the capture, so a clip
 * must stop — the same rule as "nothing plays behind another tab", and the
 * same fault when it is missed: v0.2.15 shipped a video that carried on
 * playing under the grid.
 */
export function isCaptureLive(panel: Panel, position: number, current: number): boolean {
  return panel === 'none' && position === current;
}

/**
 * Whether the filmstrip and the counter belong on screen.
 *
 * Both belong to the capture rather than to anything covering it. The grid is
 * the filmstrip's job done properly; showing both at once is two lists arguing
 * about which one is the list, which is exactly what was reported.
 */
export function showsCaptureChrome(panel: Panel): boolean {
  return panel === 'none';
}
