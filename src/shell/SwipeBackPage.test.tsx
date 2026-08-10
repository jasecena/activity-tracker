import { beganAtEdge, shouldGoBack } from './SwipeBackPage';

/**
 * The two decisions the back gesture makes, tested apart from the gesture.
 *
 * A `PanResponder` cannot be driven faithfully by synthetic events through the
 * test renderer — it computes its own gesture state from a touch history the
 * renderer does not maintain — so a test that fires `responderRelease` proves
 * nothing about what a finger would do. These are the thresholds that decide
 * the behaviour; the plumbing between them and a real touch is a device check.
 */

const WIDTH = 390;

describe('beganAtEdge', () => {
  // Edge-initiated on purpose: a page here holds horizontal scrollers — mode
  // chips, speed buttons, the route table — and a gesture that could start
  // anywhere would fight all of them.
  it('accepts a drag that began at the left edge', () => {
    expect(beganAtEdge(120, 110)).toBe(true);
    expect(beganAtEdge(28, 0)).toBe(true);
  });

  it('refuses one that began in the middle of the page', () => {
    expect(beganAtEdge(220, 100)).toBe(false);
    expect(beganAtEdge(200, 0)).toBe(false);
  });
});

describe('shouldGoBack', () => {
  it('goes back once dragged past a third of the screen', () => {
    expect(shouldGoBack(WIDTH * 0.4, 0, WIDTH)).toBe(true);
    expect(shouldGoBack(WIDTH * 0.2, 0, WIDTH)).toBe(false);
  });

  // Velocity matters as much as distance: a flick is how someone goes back
  // without dragging the whole width of the phone.
  it('goes back on a flick that never travelled far', () => {
    expect(shouldGoBack(40, 1.2, WIDTH)).toBe(true);
  });

  it('stays put for a slow, short drag', () => {
    expect(shouldGoBack(20, 0.1, WIDTH)).toBe(false);
  });

  it('never goes back on a leftward drag', () => {
    expect(shouldGoBack(-200, -2, WIDTH)).toBe(false);
  });
});
