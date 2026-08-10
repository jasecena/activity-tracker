import { bearingDeg, centroid, distanceM, EARTH_RADIUS_M, pathLengthM } from '../index';

/** One degree of latitude on the sphere the app uses. */
const DEGREE_M = (EARTH_RADIUS_M * Math.PI) / 180;

describe('distanceM', () => {
  it('is zero for a point and itself', () => {
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 0 })).toBe(0);
    expect(distanceM({ lat: 51.5, lon: -0.12 }, { lat: 51.5, lon: -0.12 })).toBe(0);
  });

  it('measures a degree of latitude', () => {
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(DEGREE_M, 3);
  });

  it('is symmetric', () => {
    const a = { lat: 12.5, lon: 34.5 };
    const b = { lat: -8.25, lon: 100.75 };
    expect(distanceM(a, b)).toBeCloseTo(distanceM(b, a), 6);
  });

  it('shrinks a degree of longitude towards the poles', () => {
    const atEquator = distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 1 });
    const atSixty = distanceM({ lat: 60, lon: 0 }, { lat: 60, lon: 1 });
    expect(atEquator).toBeCloseTo(DEGREE_M, 3);
    // cos 60° = 0.5. Not exactly half: the chord a great circle cuts is
    // fractionally shorter than the parallel, by about half a metre here.
    expect(atSixty / atEquator).toBeCloseTo(0.5, 4);
  });

  // The bug this exists to prevent: a planar `b.lon - a.lon` reports half the
  // circumference here, the plausibility filter calls it a teleport, and every
  // activity crossing the date line silently ends at that line.
  it('measures the short way across the antimeridian', () => {
    const west = { lat: 0, lon: 179.999 };
    const east = { lat: 0, lon: -179.999 };
    expect(distanceM(west, east)).toBeCloseTo(0.002 * DEGREE_M, 1);
  });

  it('measures antipodal points as half the circumference', () => {
    expect(distanceM({ lat: 0, lon: 0 }, { lat: 0, lon: 180 })).toBeCloseTo(Math.PI * EARTH_RADIUS_M, 3);
  });
});

describe('bearingDeg', () => {
  it('reads 0 due north and 90 due east', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 1, lon: 0 })).toBeCloseTo(0, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: 1 })).toBeCloseTo(90, 6);
  });

  it('reads 180 due south and 270 due west, never a negative angle', () => {
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: -1, lon: 0 })).toBeCloseTo(180, 6);
    expect(bearingDeg({ lat: 0, lon: 0 }, { lat: 0, lon: -1 })).toBeCloseTo(270, 6);
  });
});

describe('pathLengthM', () => {
  it('is zero for a path too short to have a length', () => {
    expect(pathLengthM([])).toBe(0);
    expect(pathLengthM([{ lat: 0, lon: 0 }])).toBe(0);
  });

  it('sums the steps, not the straight line', () => {
    // North one degree, then back south again: two degrees travelled, ending
    // where it started.
    const there = { lat: 1, lon: 0 };
    const back = { lat: 0, lon: 0 };
    expect(pathLengthM([back, there, back])).toBeCloseTo(2 * DEGREE_M, 3);
  });
});

describe('centroid', () => {
  it('is null for no points', () => {
    expect(centroid([])).toBeNull();
  });

  it('averages the points', () => {
    expect(
      centroid([
        { lat: 0, lon: 0 },
        { lat: 2, lon: 4 },
      ]),
    ).toEqual({ lat: 1, lon: 2 });
  });
});
