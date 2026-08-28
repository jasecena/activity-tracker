import { fireEvent, render, screen, waitFor } from '@testing-library/react-native';
import * as WebBrowser from 'expo-web-browser';

import type { Place } from '@/core/places';
import type { StaySegment } from '@/core/segments';

import { PlaceScreen } from './PlaceScreen';

/**
 * Opening a stay where it actually happened.
 *
 * **The link is per visit, and the reason is the whole feature.** Every row on
 * this page shares the place's name and the place's coordinate; what differs is
 * where the phone actually sat that afternoon. A stay eighty metres out is how
 * you find out the radius is wrong, or that two places are being read as one —
 * so a single link to the place's centre would answer the question nobody was
 * asking.
 */

/** A metre of latitude, near enough, for putting a stay a known distance away. */
const DEG_PER_METRE = 1 / 111_320;
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);

const PLACE: Place = { id: 'p-1', name: 'Home', lat: 0, lon: 0, radiusM: 120 };

function stay(northM: number, startedAt = T0): StaySegment {
  return {
    kind: 'stay',
    id: `seg-${startedAt}`,
    startedAt,
    endedAt: startedAt + 3_600_000,
    fixCount: 40,
    center: { lat: northM * DEG_PER_METRE, lon: 0 },
    radiusM: 12,
    purpose: null,
  };
}

// `render` is asynchronous in this version of the testing library — not
// awaiting it leaves the act scope open and the next render in the file
// silently never runs its effects. Same for `fireEvent`. See AGENTS.md.
async function show(segments: readonly StaySegment[], place: Place = PLACE) {
  return await render(
    <PlaceScreen
      place={place}
      allSegments={segments}
      tzOffsetMinutes={0}
      onBack={jest.fn()}
      onRename={jest.fn()}
      onForget={jest.fn()}
    />,
  );
}

describe('the map links on a place', () => {
  let open: jest.SpyInstance;

  beforeEach(() => {
    // The page opens over the app now rather than in another one, so this is
    // what to watch. `Linking` is only the fallback for a device that will
    // not present a browser at all.
    open = jest.spyOn(WebBrowser, 'openBrowserAsync').mockResolvedValue({ type: 'dismiss' } as never);
  });

  afterEach(() => {
    open.mockRestore();
  });

  it('opens a stay at its own centre rather than at the place', async () => {
    await show([stay(80)]);

    await fireEvent.press(screen.getByLabelText(/Open the stay on .* in Maps/));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    const [url] = open.mock.calls[0] as [string];
    // 80 m north of the origin, not the origin the place is registered at.
    expect(url).toContain('query=0.000719,0.000000');
    expect(url).not.toContain('query=0.000000,0.000000');
  });

  it('says how far out the stay sat, which is the point of looking', async () => {
    await show([stay(80)]);
    expect(screen.getByText(/from the centre/)).toBeOnTheScreen();
  });

  it('says nothing about an offset inside the accuracy of a fix', async () => {
    // Under about ten metres the difference is the GPS being GPS, and a number
    // printed there is noise dressed as precision.
    await show([stay(3)]);
    expect(screen.queryByText(/from the centre/)).not.toBeOnTheScreen();
    expect(screen.getByText(/Open in Maps/)).toBeOnTheScreen();
  });

  it('offers the place its own link, for checking where it is registered', async () => {
    await show([stay(3)]);

    await fireEvent.press(screen.getByLabelText('Open Home in Maps'));

    await waitFor(() => expect(open).toHaveBeenCalledTimes(1));
    expect(open.mock.calls[0][0]).toContain('query=0.000000,0.000000');
  });

  it('opens the coordinate itself, because the pin cannot carry a name', async () => {
    // Google's documented Maps URLs form takes either a place to search for or
    // a coordinate to mark, and a name attached to a coordinate is not
    // something it expresses. The undocumented `?q=lat,lon(Name)` does it and
    // is specified nowhere. The screen the link came from says which stay it is.
    await show([stay(80)]);

    await fireEvent.press(screen.getByLabelText(/Open the stay on .* in Maps/));

    await waitFor(() => expect(open).toHaveBeenCalled());
    const [url] = open.mock.calls[0] as [string];
    expect(url).toContain('/maps/search/?api=1&query=');
    expect(url).not.toContain('Home');
  });

  it('offers no link for a stay with an unusable position', async () => {
    // A NaN centre formats into a valid URL that Maps opens in the middle of
    // the ocean, which on screen is indistinguishable from the app being
    // confidently wrong about where you were.
    const broken = { ...stay(0), center: { lat: NaN, lon: NaN } };
    await show([broken]);

    expect(screen.queryByText(/Open in Maps/)).not.toBeOnTheScreen();
  });

  it('does not open anything on its own', async () => {
    await show([stay(80)]);
    expect(open).not.toHaveBeenCalled();
  });
});
