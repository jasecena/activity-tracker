import {
  CAMERA_WRITES_UPRIGHT_PIXELS,
  displayRotationFor,
  dragUpBy,
  isCaptureOrientation,
  isQuarterTurn,
  oppositeEdge,
  stageSizeFor,
  topEdgeFor,
  uprightRotationFor,
  zoomFromDrag,
  ZOOM_TRAVEL_POINTS,
  type CaptureOrientation,
} from '../orientation';

const SCREEN = { width: 390, height: 844 };

describe('isCaptureOrientation', () => {
  it('accepts the four the camera can report', () => {
    for (const value of ['portrait', 'portraitUpsideDown', 'landscapeLeft', 'landscapeRight']) {
      expect(isCaptureOrientation(value)).toBe(true);
    }
  });

  it('rejects anything else, including the shapes a stored index can hold', () => {
    for (const value of ['landscape', 'PORTRAIT', '', 90, null, undefined, {}, ['portrait']]) {
      expect(isCaptureOrientation(value)).toBe(false);
    }
  });
});

describe('uprightRotationFor', () => {
  it('leaves an upright phone alone', () => {
    expect(uprightRotationFor('portrait')).toBe(0);
  });

  it('turns an upside-down phone half way round', () => {
    expect(uprightRotationFor('portraitUpsideDown')).toBe(180);
  });

  /**
   * The one property that holds whichever way iOS means "landscape left".
   *
   * Which of the two gets 90 and which gets 270 is a coin toss until a phone
   * settles it, so asserting the specific values here would be asserting the
   * guess. What cannot be wrong is that they are opposite quarter turns: the
   * two ways of lying down are 180° apart, in every convention there is.
   */
  it('turns the two landscapes by opposite quarters', () => {
    const left = uprightRotationFor('landscapeLeft');
    const right = uprightRotationFor('landscapeRight');

    expect(isQuarterTurn(left)).toBe(true);
    expect(isQuarterTurn(right)).toBe(true);
    expect((left + 180) % 360).toBe(right);
  });

  it('treats an unrecorded orientation as upright, so an old library is untouched', () => {
    expect(uprightRotationFor(null)).toBe(0);
  });
});

describe('displayRotationFor', () => {
  it('matches the upright rotation while the camera writes what it sees', () => {
    // Guarded rather than asserted outright: the constant is the single switch
    // a device check flips, and this test states what each setting means rather
    // than pinning the setting itself.
    if (CAMERA_WRITES_UPRIGHT_PIXELS) {
      expect(displayRotationFor('landscapeLeft')).toBe(0);
    } else {
      expect(displayRotationFor('landscapeLeft')).toBe(uprightRotationFor('landscapeLeft'));
    }
  });

  it('never turns an upright capture, on either setting', () => {
    expect(displayRotationFor('portrait')).toBe(0);
    expect(displayRotationFor(null)).toBe(0);
  });
});

describe('stageSizeFor', () => {
  it('swaps the sides for a quarter turn, so a turned capture fills the screen', () => {
    expect(stageSizeFor(SCREEN, 90)).toEqual({ width: 844, height: 390 });
    expect(stageSizeFor(SCREEN, 270)).toEqual({ width: 844, height: 390 });
  });

  it('leaves them alone for no turn and for half a turn', () => {
    expect(stageSizeFor(SCREEN, 0)).toEqual(SCREEN);
    // The half turn is the case that "swap unless the angle is zero" gets
    // wrong: upside down is the same shape as the right way up.
    expect(stageSizeFor(SCREEN, 180)).toEqual(SCREEN);
  });

  it('round-trips: turning twice by the same quarter is the original shape', () => {
    const once = stageSizeFor(SCREEN, 90);
    expect(stageSizeFor(once, 90)).toEqual(SCREEN);
  });
});

describe('topEdgeFor', () => {
  it('leaves the rail where it is when the phone is upright', () => {
    expect(topEdgeFor('portrait')).toBe('right');
    expect(topEdgeFor(null)).toBe('right');
  });

  it('crosses to the other edge when the phone is upside down', () => {
    expect(topEdgeFor('portraitUpsideDown')).toBe('left');
  });

  /**
   * Again the property rather than the guess: whichever landscape is which, the
   * two of them cannot both put the rail on the same side — they are opposite
   * turns, so one has the right edge uppermost and the other has the left.
   */
  it('puts the rail on opposite edges for the two landscapes', () => {
    expect(topEdgeFor('landscapeLeft')).not.toBe(topEdgeFor('landscapeRight'));
  });

  it('agrees with the rotation it is derived from', () => {
    const all: readonly CaptureOrientation[] = ['portrait', 'portraitUpsideDown', 'landscapeLeft', 'landscapeRight'];
    for (const orientation of all) {
      const turned = uprightRotationFor(orientation);
      expect(topEdgeFor(orientation)).toBe(turned < 180 ? 'right' : 'left');
    }
  });
});

describe('oppositeEdge', () => {
  it('is its own inverse, so the two rails can never share a side', () => {
    expect(oppositeEdge('left')).toBe('right');
    expect(oppositeEdge('right')).toBe('left');
    expect(oppositeEdge(oppositeEdge('left'))).toBe('left');
  });
});

describe('the whole set', () => {
  it('gives every orientation a rotation that is a multiple of a quarter turn', () => {
    const all: readonly CaptureOrientation[] = ['portrait', 'portraitUpsideDown', 'landscapeLeft', 'landscapeRight'];
    for (const orientation of all) {
      expect([0, 90, 180, 270]).toContain(uprightRotationFor(orientation));
    }
  });

  it('gives the four of them four different rotations', () => {
    const all: readonly CaptureOrientation[] = ['portrait', 'portraitUpsideDown', 'landscapeLeft', 'landscapeRight'];
    const rotations = new Set(all.map(uprightRotationFor));
    expect(rotations.size).toBe(4);
  });
});

/**
 * Zooming by sliding a finger, which has to mean the same thing however the
 * phone is held. A zoom wired to `-dy` reverses itself the moment you turn the
 * phone sideways, or stops responding at all.
 */
describe('dragUpBy', () => {
  it('reads a slide towards the top of an upright phone as up', () => {
    // Screen coordinates: y grows downwards, so "up" is negative.
    expect(dragUpBy('portrait', 0, -100)).toBe(100);
    expect(dragUpBy('portrait', 0, 100)).toBe(-100);
  });

  it('ignores the sideways component while upright', () => {
    // `toBeCloseTo`, because negating a zero gives `-0` and `toBe` compares
    // with `Object.is`, which holds that the two zeroes are different numbers.
    // Nothing downstream can tell them apart — the arithmetic that follows
    // treats them identically — so this is about the assertion, not the value.
    expect(dragUpBy('portrait', 250, 0)).toBeCloseTo(0);
  });

  it('reads a slide along the glass as up once the phone is turned', () => {
    const left = dragUpBy('landscapeLeft', 100, 0);
    const right = dragUpBy('landscapeRight', 100, 0);

    // Whichever landscape is which, the same physical movement cannot mean the
    // same thing in both — they are opposite turns.
    expect(left).toBe(-right);
    expect(Math.abs(left)).toBe(100);
  });

  it('turns the axis over when the phone is upside down', () => {
    expect(dragUpBy('portraitUpsideDown', 0, 100)).toBe(100);
  });

  it('agrees with the edge the rails moved to', () => {
    // Both read the same fact: whichever edge is uppermost is where "up" is.
    for (const orientation of ['portrait', 'portraitUpsideDown', 'landscapeLeft', 'landscapeRight'] as const) {
      const rightEdgeIsUp = topEdgeFor(orientation) === 'right';
      const alongX = dragUpBy(orientation, 100, 0);
      if (isQuarterTurn(uprightRotationFor(orientation))) {
        expect(alongX > 0).toBe(rightEdgeIsUp);
      }
    }
  });

  it('treats an unknown orientation as upright', () => {
    expect(dragUpBy(null, 0, -50)).toBe(50);
  });
});

describe('zoomFromDrag', () => {
  it('starts from where the gesture began rather than from zero', () => {
    expect(zoomFromDrag(0.5, 0)).toBe(0.5);
  });

  it('crosses the whole range over the documented travel', () => {
    expect(zoomFromDrag(0, ZOOM_TRAVEL_POINTS)).toBe(1);
    expect(zoomFromDrag(0, ZOOM_TRAVEL_POINTS / 2)).toBeCloseTo(0.5, 9);
  });

  it('stops at both ends rather than running past them', () => {
    expect(zoomFromDrag(0.9, ZOOM_TRAVEL_POINTS)).toBe(1);
    expect(zoomFromDrag(0.1, -ZOOM_TRAVEL_POINTS)).toBe(0);
  });

  /**
   * Measured from the start of the gesture, never accumulated. Adding deltas
   * drifts, and it means letting go and repeating the same movement from the
   * same place gives a different answer the second time.
   */
  it('is a pure function of where it started and how far the finger went', () => {
    expect(zoomFromDrag(0.2, 100)).toBe(zoomFromDrag(0.2, 100));
    expect(zoomFromDrag(0.2, 100)).not.toBe(zoomFromDrag(0.3, 100));
  });
});
