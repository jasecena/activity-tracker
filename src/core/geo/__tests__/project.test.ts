import {
  boundsOf,
  centerOf,
  EARTH_RADIUS_M,
  niceScaleMetres,
  padBounds,
  projectToBox,
  spanMetresOf,
  unionBounds,
  zoomForBounds,
  type Bounds,
} from '../index';

/** One degree of latitude on the sphere the app uses. */
const DEGREE_M = (EARTH_RADIUS_M * Math.PI) / 180;

/**
 * Every fixture here is at the equator, at longitude 0 — the middle of the
 * Atlantic — for the same reason as `segments/__tests__/fixtures.ts`: a
 * plausible latitude in a committed file is a record of where its author was,
 * and `.gitleaks.toml` fails the build over one.
 */
const BOX = { width: 200, height: 100 } as const;

describe('boundsOf', () => {
  it('is null for no points', () => {
    expect(boundsOf([])).toBeNull();
  });

  it('is the point itself for one point', () => {
    expect(boundsOf([{ lat: 1, lon: 2 }])).toEqual({ minLat: 1, maxLat: 1, minLon: 2, maxLon: 2 });
  });

  it('takes the extremes in both axes', () => {
    const bounds = boundsOf([
      { lat: 0, lon: 0 },
      { lat: 0.5, lon: -0.25 },
      { lat: -0.1, lon: 0.75 },
    ]);
    expect(bounds).toEqual({ minLat: -0.1, maxLat: 0.5, minLon: -0.25, maxLon: 0.75 });
  });
});

describe('unionBounds', () => {
  const a: Bounds = { minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 };
  const b: Bounds = { minLat: -1, maxLat: 0.5, minLon: 0.5, maxLon: 2 };

  it('passes the other through when one side is missing', () => {
    expect(unionBounds(null, a)).toBe(a);
    expect(unionBounds(a, null)).toBe(a);
    expect(unionBounds(null, null)).toBeNull();
  });

  it('covers both', () => {
    expect(unionBounds(a, b)).toEqual({ minLat: -1, maxLat: 1, minLon: 0, maxLon: 2 });
  });
});

describe('projectToBox', () => {
  it('keeps a square square at the equator', () => {
    // Straddling the equator, so the mean latitude is exactly 0 and the
    // longitude scale is exactly 1 — a degree each way is a square on the
    // ground and must come out square on the screen.
    const square = [
      { lat: -0.5, lon: -0.5 },
      { lat: 0.5, lon: -0.5 },
      { lat: 0.5, lon: 0.5 },
      { lat: -0.5, lon: 0.5 },
    ];
    const bounds = boundsOf(square);
    if (!bounds) throw new Error('unreachable');

    const points = projectToBox(square, bounds, BOX);
    const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));

    expect(width).toBeCloseTo(height, 6);
    // Fitted to the short axis, which is the 100-point height.
    expect(height).toBeCloseTo(100, 6);
  });

  // The bug this exists to prevent: without the cosine, a block that is as wide
  // as it is tall comes out nearly twice as wide at 55°.
  it('does not stretch a high-latitude route sideways', () => {
    const atSixty = [
      { lat: 60, lon: 0 },
      { lat: 60.01, lon: 0 },
      { lat: 60.01, lon: 0.02 },
      { lat: 60, lon: 0.02 },
    ];
    const bounds = boundsOf(atSixty);
    if (!bounds) throw new Error('unreachable');

    const points = projectToBox(atSixty, bounds, BOX);
    const width = Math.max(...points.map((p) => p.x)) - Math.min(...points.map((p) => p.x));
    const height = Math.max(...points.map((p) => p.y)) - Math.min(...points.map((p) => p.y));

    // cos 60° = 0.5, so 0.02° of longitude is worth 0.01° of latitude here:
    // the ground shape is square, and so is the drawing.
    expect(width / height).toBeCloseTo(1, 3);
  });

  it('flips north to the top', () => {
    const line = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 0 },
    ];
    const bounds = boundsOf(line);
    if (!bounds) throw new Error('unreachable');

    const [south, north] = projectToBox(line, bounds, BOX);
    if (!south || !north) throw new Error('unreachable');
    expect(north.y).toBeLessThan(south.y);
  });

  it('centres a straight line rather than dividing by its zero span', () => {
    const line = [
      { lat: 0, lon: 0 },
      { lat: 0, lon: 1 },
    ];
    const bounds = boundsOf(line);
    if (!bounds) throw new Error('unreachable');

    const points = projectToBox(line, bounds, BOX);
    for (const point of points) {
      expect(Number.isFinite(point.x)).toBe(true);
      expect(Number.isFinite(point.y)).toBe(true);
      expect(point.y).toBeCloseTo(BOX.height / 2, 6);
    }
  });

  it('centres a single point in both axes', () => {
    const single = [{ lat: 0, lon: 0 }];
    const bounds = boundsOf(single);
    if (!bounds) throw new Error('unreachable');

    const [point] = projectToBox(single, bounds, BOX);
    if (!point) throw new Error('unreachable');
    expect(point.x).toBeCloseTo(BOX.width / 2, 6);
    expect(point.y).toBeCloseTo(BOX.height / 2, 6);
  });

  it('keeps padding clear on every side', () => {
    const square = [
      { lat: 0, lon: 0 },
      { lat: 1, lon: 1 },
    ];
    const bounds = boundsOf(square);
    if (!bounds) throw new Error('unreachable');

    const points = projectToBox(square, bounds, { ...BOX, padding: 10 });
    for (const point of points) {
      expect(point.x).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(point.x).toBeLessThanOrEqual(BOX.width - 10 + 1e-9);
      expect(point.y).toBeGreaterThanOrEqual(10 - 1e-9);
      expect(point.y).toBeLessThanOrEqual(BOX.height - 10 + 1e-9);
    }
  });

  it('survives a box smaller than its own padding', () => {
    const points = projectToBox(
      [{ lat: 0, lon: 0 }],
      { minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 },
      {
        width: 4,
        height: 4,
        padding: 10,
      },
    );
    const [point] = points;
    if (!point) throw new Error('unreachable');
    expect(Number.isFinite(point.x)).toBe(true);
    expect(Number.isFinite(point.y)).toBe(true);
  });
});

describe('spanMetresOf', () => {
  it('measures a degree each way at the equator', () => {
    // Straddling the equator: the east-west measurement is taken along the
    // middle parallel, so anything else would be a degree of longitude
    // somewhere the cosine has already shortened it.
    const span = spanMetresOf({ minLat: -0.5, maxLat: 0.5, minLon: 0, maxLon: 1 });
    expect(span.northSouth).toBeCloseTo(DEGREE_M, 3);
    expect(span.eastWest).toBeCloseTo(DEGREE_M, 3);
  });

  it('shrinks east-west towards the poles', () => {
    const span = spanMetresOf({ minLat: 60, maxLat: 60, minLon: 0, maxLon: 1 });
    expect(span.eastWest / DEGREE_M).toBeCloseTo(0.5, 3);
    expect(span.northSouth).toBe(0);
  });
});

describe('centerOf', () => {
  it('is the middle of the rectangle', () => {
    expect(centerOf({ minLat: 0, maxLat: 2, minLon: -1, maxLon: 1 })).toEqual({ lat: 1, lon: 0 });
  });
});

describe('padBounds', () => {
  // A stay is a dot with metres of jitter. Drawn to fit, that jitter fills the
  // screen and the app appears to claim you walked in circles for two hours.
  it('grows a point to at least the requested span', () => {
    const padded = padBounds({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 }, 200);
    const span = spanMetresOf(padded);
    expect(span.northSouth).toBeGreaterThanOrEqual(199);
    expect(span.eastWest).toBeGreaterThanOrEqual(199);
  });

  it('leaves something already bigger alone', () => {
    const bounds = { minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 };
    expect(padBounds(bounds, 200)).toEqual(bounds);
  });

  it('keeps the centre where it was', () => {
    const bounds = { minLat: 0, maxLat: 0.001, minLon: 0, maxLon: 0.001 };
    const before = centerOf(bounds);
    const after = centerOf(padBounds(bounds, 500));
    expect(after.lat).toBeCloseTo(before.lat, 12);
    expect(after.lon).toBeCloseTo(before.lon, 12);
  });

  it('does not run away at the pole', () => {
    const padded = padBounds({ minLat: 90, maxLat: 90, minLon: 0, maxLon: 0 }, 500);
    expect(Number.isFinite(padded.minLon)).toBe(true);
    expect(Number.isFinite(padded.maxLon)).toBe(true);
  });
});

describe('zoomForBounds', () => {
  it('zooms in further for a smaller area', () => {
    const wide = zoomForBounds({ minLat: 0, maxLat: 1, minLon: 0, maxLon: 1 }, BOX);
    const tight = zoomForBounds({ minLat: 0, maxLat: 0.01, minLon: 0, maxLon: 0.01 }, BOX);
    expect(tight).toBeGreaterThan(wide);
  });

  it('stays inside what the imagery can show', () => {
    const point = zoomForBounds({ minLat: 0, maxLat: 0, minLon: 0, maxLon: 0 }, BOX);
    const world = zoomForBounds({ minLat: -85, maxLat: 85, minLon: -180, maxLon: 180 }, BOX);
    expect(point).toBeLessThanOrEqual(20);
    expect(world).toBeGreaterThanOrEqual(1);
  });

  it('fits the tighter of the two axes', () => {
    // Far wider than tall, in a box that is the same shape as neither.
    const zoom = zoomForBounds({ minLat: 0, maxLat: 0.01, minLon: 0, maxLon: 1 }, BOX);
    const byWidth = Math.log2((BOX.width / 256) * (360 / 1));
    expect(zoom).toBeCloseTo(byWidth, 6);
  });
});

describe('niceScaleMetres', () => {
  it('rounds down to a 1, 2 or 5', () => {
    expect(niceScaleMetres(437)).toBe(200);
    expect(niceScaleMetres(999)).toBe(500);
    expect(niceScaleMetres(1_000)).toBe(1_000);
    expect(niceScaleMetres(150)).toBe(100);
    expect(niceScaleMetres(12)).toBe(10);
  });

  it('never returns zero or a nonsense input', () => {
    expect(niceScaleMetres(0)).toBe(1);
    expect(niceScaleMetres(-5)).toBe(1);
    expect(niceScaleMetres(Number.NaN)).toBe(1);
  });

  it('handles a span below one metre', () => {
    expect(niceScaleMetres(0.4)).toBeGreaterThan(0);
    expect(niceScaleMetres(0.4)).toBeLessThanOrEqual(0.4);
  });
});
