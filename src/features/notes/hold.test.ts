import { HOLD_MS, holdFraction, ringDashOffset } from './hold';

/**
 * The two decisions behind the hold, tested directly rather than through the
 * control — the precedent `SwipeBackPage` and `verticalIntent` set, and for the
 * same reason: what a ring looked like at 400 ms is not something a rendered
 * assertion can see, and it is exactly what can be wrong without anybody
 * noticing.
 */

describe('how full the ring is', () => {
  it('is empty before the finger has been down for any time at all', () => {
    expect(holdFraction(0)).toBe(0);
  });

  it('is halfway at half the hold', () => {
    expect(holdFraction(HOLD_MS / 2)).toBeCloseTo(0.5);
  });

  it('is full exactly when the recording starts', () => {
    expect(holdFraction(HOLD_MS)).toBe(1);
  });

  /**
   * A timer fires late on a real phone, and the wall clock is corrected under
   * it. Neither may draw an arc longer than the circle or one going backwards.
   */
  it('clamps a tick that arrived late', () => {
    expect(holdFraction(HOLD_MS * 3)).toBe(1);
  });

  it('clamps a clock that moved backwards under it', () => {
    expect(holdFraction(-200)).toBe(0);
    expect(holdFraction(Number.NaN)).toBe(0);
  });

  it('treats an instant hold as already finished rather than dividing by zero', () => {
    expect(holdFraction(0.5, 0)).toBe(1);
  });
});

describe('drawing it', () => {
  const RADIUS = 20;
  const CIRCUMFERENCE = 2 * Math.PI * RADIUS;

  it('hides the whole stroke at rest, so a button not being held has no ring', () => {
    expect(ringDashOffset(0, RADIUS)).toBeCloseTo(CIRCUMFERENCE);
  });

  it('hides none of it at the moment recording begins', () => {
    expect(ringDashOffset(1, RADIUS)).toBe(0);
  });

  /**
   * A ring that reads full at three-quarters is an instruction to let go too
   * early, which is the one way this can be wrong and look fine.
   */
  it('hides exactly the part not yet held for', () => {
    expect(ringDashOffset(0.75, RADIUS)).toBeCloseTo(CIRCUMFERENCE * 0.25);
  });
});
