import {
  deviceFactorFor,
  mmAt,
  dialPositionOf,
  dialSpecFor,
  displayFromDrag,
  focalLength35mm,
  formatDisplayFactor,
  pickDialCamera,
  type CameraDescription,
} from '../optics';

/**
 * A recent Pro phone, in the shape AVFoundation reports it: the triple camera
 * whose device space starts at the ultra-wide, changing lens at 2× and 6×.
 * The fields of view are real ones — 13 mm, 24 mm and 77 mm equivalents.
 */
const TRIPLE: CameraDescription = {
  localizedName: 'Back Triple Camera',
  deviceType: 'AVCaptureDeviceTypeBuiltInTripleCamera',
  isVirtual: true,
  videoMaxZoomFactor: 16,
  switchOverFactors: [2, 6],
  constituents: [
    {
      localizedName: 'Back Ultra Wide Camera',
      deviceType: 'AVCaptureDeviceTypeBuiltInUltraWideCamera',
      fieldOfViewDeg: 108.2,
    },
    { localizedName: 'Back Camera', deviceType: 'AVCaptureDeviceTypeBuiltInWideAngleCamera', fieldOfViewDeg: 73.7 },
    {
      localizedName: 'Back Telephoto Camera',
      deviceType: 'AVCaptureDeviceTypeBuiltInTelephotoCamera',
      fieldOfViewDeg: 26.4,
    },
  ],
};

const WIDE_ONLY: CameraDescription = {
  localizedName: 'Back Camera',
  deviceType: 'AVCaptureDeviceTypeBuiltInWideAngleCamera',
  isVirtual: false,
  videoMaxZoomFactor: 8,
  switchOverFactors: [],
  constituents: [
    { localizedName: 'Back Camera', deviceType: 'AVCaptureDeviceTypeBuiltInWideAngleCamera', fieldOfViewDeg: 73.7 },
  ],
};

describe('focalLength35mm', () => {
  /**
   * The definition, checked against the numbers Apple prints. A 108.2° field
   * of view is the 13 mm ultra-wide; 73.7° is the 24 mm main; 26.4° is the
   * 77 mm telephoto. Derived, not looked up — which is why it will be right on
   * a phone that does not exist yet.
   */
  it('reproduces the numbers on the spec sheet', () => {
    expect(Math.round(focalLength35mm(108.2))).toBe(13);
    expect(Math.round(focalLength35mm(73.7))).toBe(24);
    expect(Math.round(focalLength35mm(26.4))).toBe(77);
  });

  it('refuses a field of view that is not one', () => {
    expect(focalLength35mm(0)).toBe(0);
    expect(focalLength35mm(-10)).toBe(0);
    expect(focalLength35mm(180)).toBe(0);
    expect(focalLength35mm(Number.NaN)).toBe(0);
  });
});

describe('pickDialCamera', () => {
  it('prefers the virtual device with the most lenses', () => {
    const dualWide: CameraDescription = {
      ...TRIPLE,
      localizedName: 'Back Dual Wide Camera',
      constituents: TRIPLE.constituents.slice(0, 2),
      switchOverFactors: [2],
    };

    expect(pickDialCamera([WIDE_ONLY, dualWide, TRIPLE])?.localizedName).toBe('Back Triple Camera');
  });

  it('falls back to a physical lens where no virtual device exists', () => {
    expect(pickDialCamera([WIDE_ONLY])?.localizedName).toBe('Back Camera');
  });

  it('is null for no cameras at all, which is what a simulator reports', () => {
    expect(pickDialCamera([])).toBeNull();
  });
});

describe('dialSpecFor', () => {
  it('puts the stops where the lenses actually take over', () => {
    const spec = dialSpecFor(TRIPLE);

    expect(spec?.stops.map((stop) => stop.display)).toEqual([0.5, 1, 3]);
    expect(spec?.stops.map((stop) => stop.factor)).toEqual([1, 2, 6]);
  });

  /**
   * The two number spaces. Device factor 1 is the ultra-wide, but nobody calls
   * the ultra-wide "1×" — the main lens is 1×, and it sits at device factor 2.
   * Getting this wrong puts every number on the dial out by exactly 2.
   */
  it('labels the stops in display space, with the wide lens at 1', () => {
    const spec = dialSpecFor(TRIPLE);

    expect(spec?.wideFactor).toBe(2);
    expect(spec?.minDisplay).toBe(0.5);
  });

  it('prints the focal length under each stop', () => {
    expect(dialSpecFor(TRIPLE)?.stops.map((stop) => stop.mm)).toEqual([13, 24, 77]);
  });

  it('ends the dial at twice the last real lens, not at the digital ceiling', () => {
    // 16× device space is 8× display space; twice the telephoto's 3× is 6.
    expect(dialSpecFor(TRIPLE)?.maxDisplay).toBe(6);
  });

  it('handles a single-lens camera as a dial with one stop', () => {
    const spec = dialSpecFor(WIDE_ONLY);

    expect(spec?.stops).toHaveLength(1);
    expect(spec?.stops[0]?.display).toBe(1);
    expect(spec?.minDisplay).toBe(1);
  });

  it('is null for no camera', () => {
    expect(dialSpecFor(null)).toBeNull();
  });
});

describe('deviceFactorFor', () => {
  const spec = dialSpecFor(TRIPLE)!;

  it('converts what the person means into what the hardware takes', () => {
    expect(deviceFactorFor(spec, 1)).toBe(2);
    expect(deviceFactorFor(spec, 0.5)).toBe(1);
    expect(deviceFactorFor(spec, 3)).toBe(6);
  });

  it('clamps to the ends of the dial rather than past the glass', () => {
    expect(deviceFactorFor(spec, 0.1)).toBe(1);
    expect(deviceFactorFor(spec, 100)).toBe(12);
  });
});

describe('displayFromDrag', () => {
  const spec = dialSpecFor(TRIPLE)!;
  const TRAVEL = 300;

  it('starts where the gesture started', () => {
    expect(displayFromDrag(spec, 1, 0, TRAVEL)).toBeCloseTo(1, 9);
  });

  /**
   * Logarithmic: the same length of drag multiplies rather than adds, so
   * 1× → 2× and 2× → 4× are the same distance under the finger. This is what
   * makes the far end of the dial usable at all.
   */
  it('moves multiplicatively, like every camera dial', () => {
    // One full travel crosses the whole range, in either direction.
    expect(displayFromDrag(spec, 0.5, TRAVEL, TRAVEL)).toBeCloseTo(6, 6);
    expect(displayFromDrag(spec, 6, -TRAVEL, TRAVEL)).toBeCloseTo(0.5, 6);
    // And equal drags multiply rather than add: the step that doubles 0.5
    // doubles 1 from where it stands.
    const half = displayFromDrag(spec, 0.5, TRAVEL * (Math.log(2) / Math.log(12)), TRAVEL);
    const one = displayFromDrag(spec, 1, TRAVEL * (Math.log(2) / Math.log(12)), TRAVEL);
    expect(half).toBeCloseTo(1, 6);
    expect(one).toBeCloseTo(2, 6);
  });

  it('stops at the ends rather than running past them', () => {
    expect(displayFromDrag(spec, 5, TRAVEL * 3, TRAVEL)).toBe(6);
    expect(displayFromDrag(spec, 0.6, -TRAVEL * 3, TRAVEL)).toBe(0.5);
  });

  it('round-trips with dialPositionOf', () => {
    for (const display of [0.5, 1, 2, 3, 6]) {
      const position = dialPositionOf(spec, display);
      expect(displayFromDrag(spec, spec.minDisplay, position * TRAVEL, TRAVEL)).toBeCloseTo(display, 6);
    }
  });
});

describe('mmAt', () => {
  const spec = dialSpecFor(TRIPLE)!;

  it('prints each lens own number at its stop', () => {
    expect(mmAt(spec, 0.5)).toBe(13);
    expect(mmAt(spec, 1)).toBe(24);
    expect(mmAt(spec, 3)).toBe(77);
  });

  /**
   * Between stops the phone is cropping, and a crop multiplies the focal
   * length: 2× on the 24 mm main is 48 mm — the exact label in the built-in
   * camera that this dial is copying.
   */
  it('multiplies through a crop', () => {
    expect(mmAt(spec, 2)).toBe(48);
    expect(mmAt(spec, 0.7)).toBe(18);
    expect(mmAt(spec, 6)).toBe(154);
  });
});

describe('degenerate cameras', () => {
  /**
   * A dial whose range is a single point — one lens, digital ceiling of 1.
   * Every log-space function divides by the range's span, so this is the
   * arrangement that turns into NaN if it is not named explicitly.
   */
  const POINT: CameraDescription = {
    ...WIDE_ONLY,
    videoMaxZoomFactor: 1,
  };

  it('keeps a rangeless dial at its only value rather than dividing by zero', () => {
    const spec = dialSpecFor(POINT)!;

    expect(displayFromDrag(spec, 1, 100, 300)).toBe(1);
    expect(dialPositionOf(spec, 1)).toBe(0);
  });

  it('caps the dial at the hardware ceiling when that is the lower bound', () => {
    // Ceiling of 3 in device space on a single wide lens: display max is 3,
    // beneath the 2× -of-last-stop rule's 2.
    const spec = dialSpecFor({ ...WIDE_ONLY, videoMaxZoomFactor: 1.5 })!;

    expect(spec.maxDisplay).toBe(1.5);
  });

  it('reads an ultra-wide-only device without inventing a wide lens', () => {
    const ultraOnly: CameraDescription = {
      ...WIDE_ONLY,
      constituents: [
        {
          localizedName: 'Back Ultra Wide Camera',
          deviceType: 'AVCaptureDeviceTypeBuiltInUltraWideCamera',
          fieldOfViewDeg: 108.2,
        },
      ],
    };
    const spec = dialSpecFor(ultraOnly)!;

    expect(spec.wideFactor).toBe(1);
    expect(spec.stops[0]?.mm).toBe(13);
  });

  it('prints nothing rather than nonsense when a lens reported no field of view', () => {
    const blind: CameraDescription = {
      ...WIDE_ONLY,
      constituents: [{ localizedName: 'Back Camera', deviceType: 'x', fieldOfViewDeg: 0 }],
    };
    const spec = dialSpecFor(blind)!;

    expect(mmAt(spec, 2)).toBe(0);
  });
});

describe('formatDisplayFactor', () => {
  it('prints what the built-in camera prints', () => {
    expect(formatDisplayFactor(0.5)).toBe('0.5');
    expect(formatDisplayFactor(1)).toBe('1');
    expect(formatDisplayFactor(2.0)).toBe('2');
    expect(formatDisplayFactor(2.5)).toBe('2.5');
    expect(formatDisplayFactor(12.4)).toBe('12');
  });
});
