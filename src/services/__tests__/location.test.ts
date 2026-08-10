import * as LocationModule from 'expo-location';

import { currentFix, toFix } from '../location';

const location = LocationModule as unknown as typeof import('../../../__mocks__/expo-location');

/**
 * `currentFix` is the one path in the app that puts a coordinate somewhere the
 * fold never sees it — a capture stores this reading on the item and draws its
 * pin from it. So it has to judge its own answer, and these are the two ways it
 * can be handed a confident-looking lie.
 */

const NOW = Date.UTC(2026, 7, 9, 12, 0, 0);

function reading(over: { accuracy?: number; timestamp?: number; latitude?: number } = {}) {
  return {
    coords: {
      latitude: over.latitude ?? 0,
      longitude: 0,
      accuracy: over.accuracy ?? 10,
      speed: 0,
      altitude: 0,
      heading: 0,
      altitudeAccuracy: 5,
    },
    timestamp: over.timestamp ?? NOW,
  };
}

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(NOW);
  jest.clearAllMocks();
});

afterEach(() => {
  jest.useRealTimers();
});

it('returns a fresh, accurate reading', async () => {
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading());

  expect(await currentFix()).toMatchObject({ lat: 0, lon: 0, at: NOW, accuracyM: 10 });
});

// The reported bug. Core Location answers from a cache that survives a flight,
// and the cached fix keeps its *original* timestamp — which is the only thing
// that gives it away, since its coordinates and accuracy look perfect.
it('refuses a cached position from wherever the phone last was', async () => {
  location.getCurrentPositionAsync.mockResolvedValueOnce(
    reading({ latitude: 48.85, timestamp: NOW - 6 * 60 * 60_000 }),
  );

  expect(await currentFix()).toBeNull();
});

it('accepts a reading a few seconds old, which is every real one', async () => {
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading({ timestamp: NOW - 5_000 }));

  expect(await currentFix()).not.toBeNull();
});

// A clock corrected between the reading and the check puts a fresh fix very
// slightly in the future. That is not staleness.
it('does not treat a fix a moment in the future as stale', async () => {
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading({ timestamp: NOW + 2_000 }));

  expect(await currentFix()).not.toBeNull();
});

// Indoors, iOS answers a high-accuracy request from Wi-Fi and cell rather than
// not answering at all. A circle kilometres wide is a city, not a place.
it('refuses a reading whose accuracy circle covers a city', async () => {
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading({ accuracy: 3_000 }));

  expect(await currentFix()).toBeNull();
});

// Core Location signals "invalid" with a negative accuracy, which `toFix` maps
// to Infinity precisely so a comparison against a maximum cannot pass it.
it('refuses a reading Core Location has marked invalid', async () => {
  location.getCurrentPositionAsync.mockResolvedValueOnce(reading({ accuracy: -1 }));

  expect(toFix(reading({ accuracy: -1 })).accuracyM).toBe(Infinity);
  expect(await currentFix()).toBeNull();
});

it('is null rather than throwing when the platform refuses', async () => {
  location.getCurrentPositionAsync.mockRejectedValueOnce(new Error('denied'));

  expect(await currentFix()).toBeNull();
});
