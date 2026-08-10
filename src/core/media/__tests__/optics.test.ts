import {
  deviceFactorFor,
  zoomPropFor,
  dialSpecFor,
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

describe('degenerate cameras', () => {
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

    expect(dialSpecFor(blind)?.stops[0]?.mm).toBe(0);
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

describe('zoomPropFor', () => {
  const spec = dialSpecFor(TRIPLE)!;

  /**
   * The inverse of expo-camera's own mapping, factor = maxZoom^prop. On the
   * triple camera the main lens is device factor 2 under a ceiling of 16, so
   * the prop is log16(2) — exactly a quarter.
   */
  it('inverts the exponential mapping exactly', () => {
    expect(zoomPropFor(spec, 1)).toBeCloseTo(0.25, 9);
    expect(zoomPropFor(spec, 0.5)).toBeCloseTo(0, 9);
  });

  it('stays inside the prop range whatever it is asked', () => {
    expect(zoomPropFor(spec, 100)).toBeLessThanOrEqual(1);
    expect(zoomPropFor(spec, 0.001)).toBeGreaterThanOrEqual(0);
  });

  it('answers zero for a camera with no zoom range at all', () => {
    const point = dialSpecFor({ ...WIDE_ONLY, videoMaxZoomFactor: 1 })!;
    expect(zoomPropFor(point, 1)).toBe(0);
  });
});
