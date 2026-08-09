import { isVerticalDrag, releasedIntent } from './verticalIntent';

/**
 * The decisions, not the plumbing — a `PanResponder` cannot be driven
 * faithfully by synthetic events, so the rules are what get tested.
 *
 * The structural point worth stating: the pager under this gesture scrolls
 * horizontally, so a decisively vertical drag has no other claimant. The
 * timeline swipe that failed on a real phone was fighting a scroller on its
 * own axis; this one is not, which is why it can exist at all.
 */
describe('isVerticalDrag', () => {
  it('claims a decisive pull up or down', () => {
    expect(isVerticalDrag(4, -80)).toBe(true);
    expect(isVerticalDrag(4, 80)).toBe(true);
  });

  it('leaves a page swipe alone, which is the pager underneath', () => {
    expect(isVerticalDrag(80, 4)).toBe(false);
    expect(isVerticalDrag(60, 40)).toBe(false);
  });

  it('waits for real movement rather than trembling fingers', () => {
    expect(isVerticalDrag(0, 5)).toBe(false);
  });
});

describe('releasedIntent', () => {
  it('reads far enough up as asking about the capture', () => {
    expect(releasedIntent(-60, 0)).toBe('info');
  });

  it('reads far enough down as asking for the grid', () => {
    expect(releasedIntent(60, 0)).toBe('grid');
  });

  // A flick is short but unmistakable: distance is not the only way to mean it.
  it('honours a flick that never went far', () => {
    expect(releasedIntent(-20, -0.9)).toBe('info');
    expect(releasedIntent(20, 0.9)).toBe('grid');
  });

  it('does nothing for a drag that was let go halfway', () => {
    expect(releasedIntent(-30, -0.1)).toBeNull();
    expect(releasedIntent(30, 0.1)).toBeNull();
  });
});
