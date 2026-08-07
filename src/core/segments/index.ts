/**
 * The segmentation engine.
 *
 * Everything the app knows about your day is produced here, from nothing but a
 * list of fixes and a config. No clock, no entropy, no platform.
 */
export {
  AVERAGE_SPEED_CEILING_MPS,
  classifyMode,
  MOTOR_TOP_SPEED_MPS,
  UNKNOWN_FLOOR_MPS,
  type ClassifyInput,
} from './classify';
export { DEFAULT_SEGMENT_CONFIG, normalizeSegmentConfig, type SegmentConfig } from './config';
export {
  closeOut,
  ingest,
  ingestAll,
  initialSegmenter,
  lastKnownPosition,
  segmentFixes,
  type IngestResult,
  type SegmentationResult,
  type SegmenterState,
} from './machine';
export {
  applyManualWindows,
  closeAbandonedWindows,
  manualSegmentId,
  splitSegment,
  windowsForDay,
  type ManualWindow,
} from './manual';
export {
  ACTIVITY_MODES,
  averageSpeedMps,
  durationMs,
  type ActivityMode,
  type MoveSegment,
  type Segment,
  type StaySegment,
} from './types';
