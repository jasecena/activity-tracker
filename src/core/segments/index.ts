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
export { applyJourneyLabels, journeyLabelId, labelledSegmentId, splitSegment, type JourneyLabel } from './manual';
export {
  applyVisitPurposes,
  purposeTextFor,
  purposeFrom,
  purposesForStay,
  visitPurposeId,
  PURPOSE_SEPARATOR,
  type VisitPurpose,
} from './visits';
export { overrideFor, saysSomething } from './override';
export {
  applyStationaryClaims,
  claimBehind,
  judgeStationaryClaim,
  stationaryCentre,
  stationaryClaimId,
  type MergeQuestion,
  type MergeRefusal,
  type MergeVerdict,
  type StationaryClaim,
} from './stationary';
export {
  ACTIVITY_MODES,
  averageSpeedMps,
  durationMs,
  type ActivityMode,
  type MoveSegment,
  type Segment,
  type StaySegment,
} from './types';
