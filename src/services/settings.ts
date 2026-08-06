import { DEFAULT_WEIGHT_KG, normalizeWeightKg } from '@/core/energy';
import { DEFAULT_SEGMENT_CONFIG, normalizeSegmentConfig, type SegmentConfig } from '@/core/segments';

import { DEFAULT_PRESET, normalizePresetId, type TrackingPresetId } from './location';

export interface Settings {
  readonly preset: TrackingPresetId;
  readonly weightKg: number;
  /** Whether tracking should be running. The app's intent; `isTracking()` is the truth. */
  readonly trackingEnabled: boolean;
  /**
   * Days of history to keep, or null for all of it.
   *
   * Null by default, deliberately. This is a diary: quietly deleting last
   * year's walks because a default said so is the one behaviour it must not
   * have. A limit is something you choose.
   */
  readonly retentionDays: number | null;
  /**
   * Whether routes are drawn over Apple's map imagery.
   *
   * **False by default, and the only setting in this app that turns on a
   * network request.** With it off, every map in the app is the offline canvas
   * — the route, the stops and a scale bar, drawn from your own coordinates
   * and nothing else. With it on, MapKit fetches tiles for whatever region you
   * are looking at. Your track is never sent: it is an overlay drawn on this
   * device. But the region is a request, and a request is a thing this app
   * otherwise never makes, so it is a choice rather than a default.
   */
  readonly mapsEnabled: boolean;
  readonly segmentation: SegmentConfig;
}

export const DEFAULT_SETTINGS: Settings = {
  preset: DEFAULT_PRESET,
  weightKg: DEFAULT_WEIGHT_KG,
  trackingEnabled: false,
  retentionDays: null,
  mapsEnabled: false,
  segmentation: DEFAULT_SEGMENT_CONFIG,
};

function normalizeRetentionDays(input: unknown): number | null {
  if (typeof input !== 'number' || !Number.isFinite(input) || input < 1) return null;
  return Math.floor(input);
}

/**
 * The trust boundary for settings.
 *
 * Field by field, never wholesale. A stored object that has lost one key is far
 * more likely than one that is unrecognisable, and falling back to every
 * default because `weightKg` came back as a string would silently turn tracking
 * off — which reads as the app having forgotten what it was doing.
 */
export function normalizeSettings(input: unknown): Settings {
  const source = (typeof input === 'object' && input !== null ? input : {}) as Partial<Record<string, unknown>>;
  return {
    preset: normalizePresetId(source.preset),
    weightKg: normalizeWeightKg(source.weightKg),
    trackingEnabled: source.trackingEnabled === true,
    retentionDays: normalizeRetentionDays(source.retentionDays),
    // `=== true`, not truthy: anything unrecognisable in this field must fall
    // back to *off*, because the failure it guards is a network request nobody
    // asked for.
    mapsEnabled: source.mapsEnabled === true,
    segmentation: normalizeSegmentConfig(source.segmentation),
  };
}
