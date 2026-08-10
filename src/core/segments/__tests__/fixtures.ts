import { EARTH_RADIUS_M, type Fix } from '../../geo';

/**
 * Synthetic fix streams.
 *
 * Everything here sits on the equator at longitude 0 — the middle of the
 * Atlantic — and moves due north. That is not laziness: real coordinates in a
 * committed fixture are a permanent record of where their author was, and
 * `.gitleaks.toml` has a rule that fails the build over exactly that. Building
 * journeys out of "N metres north of nowhere" also makes every expected
 * distance in the assertions something you can work out in your head.
 */

const DEG_PER_METRE_LAT = 1 / ((EARTH_RADIUS_M * Math.PI) / 180);

/** The origin of every fixture. Deliberately in the ocean. */
export const ORIGIN = { lat: 0, lon: 0 } as const;

/**
 * Somewhere that is not the origin, for the errors the origin hides.
 *
 * (0, 0) makes every distance easy to check in your head and keeps the fixtures
 * out of anybody's real life — but it also means a coordinate scaled by the
 * wrong factor is still exactly zero, so a whole class of arithmetic bug passes
 * every assertion in this suite. One shipped: the boundary fix of a merge was
 * counted once and summed twice, and a stay's centre came out as the true mean
 * multiplied by (n + merges) / n. Zero times anything is zero.
 *
 * Round numbers with no decimals, so it stays plainly synthetic: this is a
 * point in the Sahara, not anybody's morning.
 */
export const ELSEWHERE = { lat: 20, lon: 10 } as const;

/** Move a whole stream somewhere else, keeping every relative distance. */
export function shifted(fixes: readonly Fix[], to: { readonly lat: number; readonly lon: number }): Fix[] {
  return fixes.map((one) => ({ ...one, lat: one.lat + to.lat, lon: one.lon + to.lon }));
}

export const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

export function fix(at: number, northM: number, overrides: Partial<Fix> = {}): Fix {
  return {
    lat: ORIGIN.lat + northM * DEG_PER_METRE_LAT,
    lon: ORIGIN.lon,
    at,
    accuracyM: 8,
    reportedSpeedMps: null,
    altitudeM: null,
    ...overrides,
  };
}

export interface LegOptions {
  /** Metres north of the origin at the first fix of this leg. */
  readonly fromM: number;
  readonly startAt: number;
  readonly durationMs: number;
  readonly speedMps: number;
  readonly intervalMs?: number;
  readonly overrides?: Partial<Fix>;
}

/**
 * A stretch of travel at a constant speed, sampled every `intervalMs`.
 *
 * The first fix of a leg is at `startAt`; callers chain legs by starting the
 * next one where the previous ended, which is what the segmenter itself assumes
 * about the boundary fix.
 */
export function leg({ fromM, startAt, durationMs, speedMps, intervalMs = 10_000, overrides }: LegOptions): Fix[] {
  const fixes: Fix[] = [];
  for (let elapsed = 0; elapsed <= durationMs; elapsed += intervalMs) {
    fixes.push(fix(startAt + elapsed, fromM + (speedMps * elapsed) / 1000, overrides));
  }
  return fixes;
}

/** Where a leg with these options ends up, in metres north of the origin. */
export function legEndM({
  fromM,
  durationMs,
  speedMps,
}: Pick<LegOptions, 'fromM' | 'durationMs' | 'speedMps'>): number {
  return fromM + (speedMps * durationMs) / 1000;
}

/** Chain legs, dropping the duplicated boundary fix between them. */
export function chain(...legs: Fix[][]): Fix[] {
  const out: Fix[] = [];
  for (const part of legs) {
    for (const item of part) {
      if (out[out.length - 1]?.at === item.at) continue;
      out.push(item);
    }
  }
  return out;
}
