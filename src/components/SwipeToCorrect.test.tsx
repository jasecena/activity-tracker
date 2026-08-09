import { isLeftwardSwipe, shouldCommit } from './SwipeToCorrect';

/**
 * The decisions, not the plumbing.
 *
 * A `PanResponder` cannot be driven faithfully by synthetic events, so firing
 * them through the renderer would prove the wiring and nothing about the rule —
 * the same reason `SwipeBackPage` exports its two decisions and tests them
 * here rather than through a render.
 */
describe('isLeftwardSwipe', () => {
  it('claims a decisive pull to the left', () => {
    expect(isLeftwardSwipe(-80, 4)).toBe(true);
  });

  it('ignores a pull to the right, which is the back gesture', () => {
    expect(isLeftwardSwipe(80, 4)).toBe(false);
  });

  /**
   * The one that matters on a timeline. The day scrolls vertically, and a row
   * that grabs anything with sideways movement in it turns every flick down the
   * list into a jitter — no finger travels in a straight line.
   */
  it('leaves a scroll alone even when the finger wanders sideways', () => {
    expect(isLeftwardSwipe(-12, 90)).toBe(false);
    expect(isLeftwardSwipe(-40, 40)).toBe(false);
    expect(isLeftwardSwipe(-30, 20)).toBe(false);
  });

  it('claims it once the sideways part clearly dominates', () => {
    expect(isLeftwardSwipe(-40, 10)).toBe(true);
  });

  it('does nothing at rest', () => {
    expect(isLeftwardSwipe(0, 0)).toBe(false);
  });
});

describe('shouldCommit', () => {
  it('needs a real pull rather than a nudge', () => {
    expect(shouldCommit(-10)).toBe(false);
    expect(shouldCommit(-63)).toBe(false);
  });

  it('commits once the row has been pulled far enough', () => {
    expect(shouldCommit(-64)).toBe(true);
    expect(shouldCommit(-200)).toBe(true);
  });

  it('never commits on a rightward drag, however far', () => {
    expect(shouldCommit(200)).toBe(false);
  });
});
