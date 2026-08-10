import * as LocationModule from 'expo-location';

import { appendFixes } from '../fixBuffer';
import { askPosition } from '../position';
import { STORAGE_KEYS, writeJson } from '../storage';

const location = LocationModule as unknown as typeof import('../../../__mocks__/expo-location');

/**
 * The failure this file exists for: Core Location positioning from a Wi-Fi
 * network whose database entry was recorded somewhere else, and reporting the
 * result with GPS-grade accuracy. The reading is confident and wrong, so
 * nothing about the reading itself can catch it — only the step from the last
 * place the phone actually was.
 *
 * Fixtures sit at the equator, as everywhere in this repo: a coordinate from a
 * real track is a permanent record of where its author was.
 */

const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);

function reading(over: { latitude?: number; longitude?: number; accuracy?: number; timestamp?: number } = {}) {
  return {
    coords: {
      latitude: over.latitude ?? 0,
      longitude: over.longitude ?? 0,
      accuracy: over.accuracy ?? 25,
      speed: 0,
      altitude: 0,
      heading: 0,
      altitudeAccuracy: 5,
    },
    timestamp: over.timestamp ?? NOW,
  };
}

function fixAt(lat: number, lon: number, at: number) {
  return { lat, lon, at, accuracyM: 10, reportedSpeedMps: null, altitudeM: null };
}

beforeEach(async () => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
  await writeJson(STORAGE_KEYS.fixBuffer, []);
});

afterEach(() => {
  jest.useRealTimers();
});

it('believes a reading a few metres from the last one', async () => {
  await appendFixes([fixAt(0, 0, NOW - 60_000)]);
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading({ longitude: 0.0005 }));

  expect(await askPosition()).toMatchObject({ lon: 0.0005 });
});

// Roughly 1,100 km away, one minute after the last fix. No accuracy figure can
// tell you this is wrong; the step is what tells you.
it('refuses a confident reading a continent away', async () => {
  await appendFixes([fixAt(0, 0, NOW - 60_000)]);
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading({ longitude: 10, accuracy: 25 }));

  expect(await askPosition()).toBeNull();
});

// The same distance is not a lie if enough time has passed to cover it — the
// app must not decide a flight never happened.
it('believes the same jump once there has been time to travel it', async () => {
  await appendFixes([fixAt(0, 0, NOW - 30 * 60 * 60_000)]);
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading({ longitude: 10 }));

  expect(await askPosition()).not.toBeNull();
});

// Nothing to compare against is not evidence of anything. A first capture on a
// fresh install must still be placed.
it('takes the first reading on trust, because there is nothing to check it against', async () => {
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading({ longitude: 42 }));

  expect(await askPosition()).not.toBeNull();
});

// `too-soon` throttles a stream that would otherwise wake the app constantly.
// A shutter press is not that, and rejecting it would mean a photo taken during
// a walk is the one photo with no location.
it('does not reject a shutter press for arriving too soon after a fix', async () => {
  await appendFixes([fixAt(0, 0, NOW - 50)]);
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading({ longitude: 0.00001 }));

  expect(await askPosition()).not.toBeNull();
});

// A cached fix keeps its original timestamp, so it is older than the last one
// on record — which is `out-of-order`, and the reason a photo must not be
// stamped with it.
it('refuses a reading older than the last fix on record', async () => {
  await appendFixes([fixAt(0, 0, NOW - 60_000)]);
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading({ timestamp: NOW - 120_000 }));

  expect(await askPosition()).toBeNull();
});

it('passes on a platform that gave nothing back', async () => {
  location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('denied'));

  expect(await askPosition()).toBeNull();
});
