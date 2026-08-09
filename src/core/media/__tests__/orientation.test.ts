import {
  CAMERA_WRITES_UPRIGHT_PIXELS,
  displayRotationFor,
  isCaptureOrientation,
  isQuarterTurn,
  oppositeEdge,
  stageSizeFor,
  topEdgeFor,
  uprightRotationFor,
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
