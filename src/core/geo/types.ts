/**
 * A point on the earth. Degrees, WGS-84, the same thing Core Location hands us.
 */
export interface LatLon {
  readonly lat: number;
  readonly lon: number;
}

/** A point on a recorded route: where, when, and how fast you were going. */
export interface PathPoint extends LatLon {
  /** Epoch milliseconds. */
  readonly at: number;
  /**
   * Ground speed in m/s on the step that arrived at this point, or null for the
   * first point of a segment, which has no step behind it.
   *
   * Stored per point rather than only as a per-segment peak, because "how fast
   * was I at that corner" is a question the timeline should be able to answer.
   *
   * Always the *derived* speed — distance over elapsed time between two
   * accepted fixes — never the platform's instantaneous estimate. Deriving it
   * means a speed and the distance beside it can never contradict each other,
   * which they otherwise routinely do: Core Location's Doppler speed keeps
   * reading 8 m/s for several seconds after you stop.
   */
  readonly speedMps: number | null;
}

/**
 * One reading from Core Location, reduced to the fields the engine uses.
 *
 * Deliberately not the `LocationObject` that expo-location returns. That type
 * belongs to the platform; this one belongs to the engine, and `src/services`
 * is where one becomes the other. It is also what keeps the engine testable on
 * a Linux CI runner that is not, and never will be, moving.
 */
export interface Fix extends LatLon {
  /** Epoch milliseconds, as the OS timestamped the reading. */
  readonly at: number;
  /**
   * Horizontal accuracy radius in metres — the 68% confidence circle, as iOS
   * defines it. `Infinity` when the platform reports the reading as invalid,
   * which it signals with a negative number.
   */
  readonly accuracyM: number;
  /**
   * The platform's own instantaneous speed estimate in m/s, or null.
   *
   * Carried through for diagnostics and never used for anything the app
   * displays or decides — see `PathPoint.speedMps` for why.
   */
  readonly reportedSpeedMps: number | null;
  /** Metres above the WGS-84 ellipsoid, or null. */
  readonly altitudeM: number | null;
}
