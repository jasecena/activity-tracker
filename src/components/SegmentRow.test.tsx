import { render, screen } from '@testing-library/react-native';

import type { Place } from '@/core/places';
import type { MoveSegment, StaySegment } from '@/core/segments';

import { SegmentRow } from './SegmentRow';

const T0 = Date.UTC(2026, 0, 5, 9, 52, 0);
const HOUR = 3_600_000;

const walk: MoveSegment = {
  kind: 'move',
  id: 'seg-1',
  startedAt: T0,
  endedAt: T0 + 18 * 60_000,
  fixCount: 60,
  distanceM: 1_420,
  mode: 'walk',
  label: null,
  modeIsManual: false,
  path: [
    { lat: 0, lon: 0, at: T0, speedMps: null },
    { lat: 0.01, lon: 0.005, at: T0 + 18 * 60_000, speedMps: 1.4 },
  ],
  topSpeedMps: 1.9,
};

const restaurant: StaySegment = {
  kind: 'stay',
  id: 'seg-2',
  startedAt: T0,
  endedAt: T0 + 2 * HOUR,
  fixCount: 120,
  center: { lat: 0, lon: 0 },
  radiusM: 15,
};

const PLACES: Place[] = [{ id: 'place-0-0', name: 'abc restaurant', lat: 0, lon: 0, radiusM: 120 }];

describe('a move', () => {
  it('shows what it was, how far, how long and how fast', async () => {
    await render(<SegmentRow segment={walk} places={[]} tzOffsetMinutes={0} />);

    expect(screen.getByText('Walk')).toBeOnTheScreen();
    expect(screen.getByText('1.42 km · 18m · 4.7 km/h')).toBeOnTheScreen();
    expect(screen.getByText('09:52')).toBeOnTheScreen();
  });

  it("shows the clock in the zone it is given, not the runtime's", async () => {
    await render(<SegmentRow segment={walk} places={[]} tzOffsetMinutes={600} />);
    expect(screen.getByText('19:52')).toBeOnTheScreen();
  });

  it('prefers the name you gave it over the mode it guessed', async () => {
    await render(
      <SegmentRow segment={{ ...walk, label: 'Walk to Coles', modeIsManual: true }} places={[]} tzOffsetMinutes={0} />,
    );

    expect(screen.getByText('Walk to Coles')).toBeOnTheScreen();
    expect(screen.queryByText('Walk')).not.toBeOnTheScreen();
    // The badge that says a human, not the classifier, decided this one.
    expect(screen.getByText('REC')).toBeOnTheScreen();
  });

  it('says "Moving" rather than guessing when the mode is unknown', async () => {
    await render(<SegmentRow segment={{ ...walk, mode: 'unknown' }} places={[]} tzOffsetMinutes={0} />);
    expect(screen.getByText('Moving')).toBeOnTheScreen();
  });
});

describe('a stay', () => {
  it('is named once the place is', async () => {
    await render(<SegmentRow segment={restaurant} places={PLACES} tzOffsetMinutes={0} />);

    expect(screen.getByText('abc restaurant')).toBeOnTheScreen();
    expect(screen.getByText('2h 00m')).toBeOnTheScreen();
  });

  it('admits it does not know the place yet', async () => {
    await render(<SegmentRow segment={restaurant} places={[]} tzOffsetMinutes={0} />);
    expect(screen.getByText('Unnamed place')).toBeOnTheScreen();
  });

  it('is not offered for naming where naming is not possible', async () => {
    // History passes no handler: a finished day is read-only.
    await render(<SegmentRow segment={restaurant} places={[]} tzOffsetMinutes={0} />);
    expect(screen.queryByRole('button')).not.toBeOnTheScreen();
  });
});
