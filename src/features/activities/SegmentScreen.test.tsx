import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import type { MoveSegment, StaySegment } from '@/core/segments';

import { SegmentScreen } from './SegmentScreen';

/**
 * Opening a timeline row where it actually happened.
 *
 * This is the page reached by tapping a row on the first tab — the one with the
 * duration, wander and fixes tiles — and it is where somebody looking at a stop
 * wants to know what building that was. The map drawn on the page is the app's
 * own canvas, which has no street names; Maps has them.
 */

const DEG_PER_METRE = 1 / 111_320;
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);

function stay(northM = 0): StaySegment {
  return {
    kind: 'stay',
    id: `seg-${T0}`,
    startedAt: T0,
    endedAt: T0 + 3_600_000,
    fixCount: 40,
    center: { lat: northM * DEG_PER_METRE, lon: 0 },
    radiusM: 12,
    purpose: null,
  };
}

function move(): MoveSegment {
  return {
    kind: 'move',
    id: `seg-${T0}`,
    startedAt: T0,
    endedAt: T0 + 600_000,
    fixCount: 20,
    distanceM: 900,
    mode: 'walk',
    label: null,
    modeIsManual: false,
    topSpeedMps: 1.4,
    path: [
      { lat: 0, lon: 0, at: T0, speedMps: 1.2 },
      { lat: 90 * DEG_PER_METRE, lon: 0, at: T0 + 600_000, speedMps: 1.4 },
    ],
  };
}

async function show(segment: StaySegment | MoveSegment) {
  return await render(
    <SegmentScreen segment={segment} places={[]} tzOffsetMinutes={0} mapsEnabled={false} onBack={jest.fn()} />,
  );
}

describe('opening a timeline row in Maps', () => {
  let open: jest.SpyInstance;

  beforeEach(() => {
    // The page opens over the app now rather than in another one, so this is
    // what to watch. `Linking` is only the fallback for a device that will
    // not present a browser at all.
    open = jest.spyOn(WebBrowser, 'openBrowserAsync').mockResolvedValue({ type: 'dismiss' } as never);
  });

  afterEach(() => open.mockRestore());

  it('puts a pin on a stop at its own centre', async () => {
    await show(stay(80));

    await fireEvent.press(screen.getByLabelText('Open this stop in Maps'));

    await waitFor(() => expect(open).toHaveBeenCalled());
    expect(open.mock.calls[0][0]).toContain('query=0.000719,0.000000');
  });

  it('draws the way a journey went, rather than pinning a point on it', async () => {
    // A journey is not a pin. Opening one at its midpoint answers nothing —
    // where it went is the question, and Maps will draw that from the two ends.
    await show(move());

    await fireEvent.press(screen.getByLabelText('Open this journey in Maps'));

    await waitFor(() => expect(open).toHaveBeenCalled());
    const [url] = open.mock.calls[0] as [string];
    expect(url).toContain('origin=0.000000,0.000000');
    expect(url).toContain('destination=0.000808,0.000000');
  });

  it('offers nothing for a stop with an unusable position', async () => {
    await show({ ...stay(), center: { lat: NaN, lon: NaN } });
    expect(screen.queryByLabelText('Open this stop in Maps')).not.toBeOnTheScreen();
  });

  it('does not open anything on its own', async () => {
    await show(stay(80));
    expect(open).not.toHaveBeenCalled();
  });
});
