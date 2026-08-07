import { act, fireEvent, render, screen } from '@testing-library/react-native';

import type { DayGroup } from '@/core/day';
import type { UseSettings } from '@/features/settings/hooks/useSettings';
import { EARTH_RADIUS_M, type PathPoint } from '@/core/geo';
import type { MoveSegment, Segment, StaySegment } from '@/core/segments';

import { ReplayScreen } from './ReplayScreen';

/**
 * The player, against a fabricated day.
 *
 * What is worth asserting here and nowhere else is the readout: that scrubbing
 * into a hole says so rather than showing a position the app does not have.
 * `core/replay` proves `positionAt` returns null there; this proves the screen
 * does something honest with the null.
 *
 * Equator, longitude 0 — the middle of the Atlantic. A plausible latitude in a
 * committed file is a record of where its author was, and `.gitleaks.toml`
 * fails the build over one.
 */

const DEG_PER_METRE_LAT = 1 / ((EARTH_RADIUS_M * Math.PI) / 180);
const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const MINUTE = 60_000;

function point(at: number, northM: number): PathPoint {
  return { lat: northM * DEG_PER_METRE_LAT, lon: 0, at, speedMps: 1.4 };
}

function move(startedAt: number, endedAt: number, fromM: number, toM: number): MoveSegment {
  return {
    kind: 'move',
    id: `m-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 2,
    distanceM: toM - fromM,
    mode: 'walk',
    label: null,
    modeIsManual: false,
    path: [point(startedAt, fromM), point(endedAt, toM)],
    topSpeedMps: 1.4,
  };
}

function stay(startedAt: number, endedAt: number, northM: number): StaySegment {
  return {
    kind: 'stay',
    id: `s-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 8,
    center: { lat: northM * DEG_PER_METRE_LAT, lon: 0 },
    radiusM: 6,
  };
}

function dayOf(segments: readonly Segment[]): DayGroup {
  return { key: '2026-01-05', startedAt: Date.UTC(2026, 0, 5), segments };
}

/** A contiguous morning: a walk, then a stop. */
const WHOLE_DAY = dayOf([move(T0, T0 + 10 * MINUTE, 0, 800), stay(T0 + 10 * MINUTE, T0 + 40 * MINUTE, 800)]);

/** Two walks with two hours of nothing between them. */
const DAY_WITH_A_HOLE = dayOf([
  move(T0, T0 + 10 * MINUTE, 0, 800),
  move(T0 + 130 * MINUTE, T0 + 140 * MINUTE, 5_000, 5_800),
]);

/** Only the fields the day view reads: tracking notices and the weight. */
const SETTINGS = {
  settings: { weightKg: 70 },
  tracking: true,
  permission: 'always',
  savingBattery: false,
  setTracking: () => undefined,
  askForPermission: () => undefined,
} as unknown as UseSettings;

function renderScreen(day: DayGroup) {
  return render(
    <ReplayScreen
      days={[day]}
      places={[]}
      media={[]}
      settings={SETTINGS}
      tzOffsetMinutes={0}
      mapsEnabled={false}
      ready
      selectedDayKey={day.key}
      onSelectDay={() => undefined}
      onOpenSegment={() => undefined}
      onOpenMedia={() => undefined}
      onOpenAllDays={() => undefined}
    />,
  );
}

describe('the player', () => {
  it('shows today as an empty day before anything is recorded', async () => {
    await render(
      <ReplayScreen
        days={[]}
        places={[]}
        media={[]}
        settings={SETTINGS}
        tzOffsetMinutes={0}
        mapsEnabled={false}
        ready
        selectedDayKey={null}
        onSelectDay={() => undefined}
        onOpenSegment={() => undefined}
        onOpenMedia={() => undefined}
        onOpenAllDays={() => undefined}
      />,
    );

    // An empty day is still today: stats, an empty timeline, and no player.
    expect(screen.getByText('Nothing recorded yet today.')).toBeOnTheScreen();
    expect(screen.queryByLabelText('Play')).not.toBeOnTheScreen();
  });

  it('starts at the beginning of the day, paused', async () => {
    await renderScreen(WHOLE_DAY);

    expect(screen.getByLabelText('Showing 08:00')).toBeOnTheScreen();
    expect(screen.getByLabelText('Play')).toBeOnTheScreen();
  });

  it('draws the route without any map imagery when maps are off', async () => {
    await renderScreen(WHOLE_DAY);

    expect(screen.queryByLabelText('Apple Maps')).not.toBeOnTheScreen();
    expect(screen.getByLabelText(/^Map of /)).toBeOnTheScreen();
  });

  it('reports what you were doing at the instant being shown', async () => {
    await renderScreen(WHOLE_DAY);

    expect(screen.getByLabelText('Showing 08:00')).toBeOnTheScreen();
    expect(screen.getByText(/Walk ·/)).toBeOnTheScreen();
  });

  it('holds still and says so once the day reaches a stop', async () => {
    jest.useFakeTimers();
    try {
      await renderScreen(WHOLE_DAY);

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Play'));
      });
      // 60×: twenty seconds of wall clock is twenty minutes in, which is ten
      // minutes into the stop.
      await act(async () => {
        jest.advanceTimersByTime(20_000);
      });

      expect(screen.getByText('Stopped')).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  // The assertion this file exists for. A player is where interpolating across
  // a gap is most tempting and most wrong.
  it('says it has no signal for a stretch with no fixes behind it', async () => {
    jest.useFakeTimers();
    try {
      await renderScreen(DAY_WITH_A_HOLE);

      expect(screen.getByText(/One stretch of/)).toBeOnTheScreen();

      // Played into the hole rather than dragged into it: a `PanResponder` does
      // not simulate faithfully through the test renderer, and the readout is
      // what this is about, not the gesture.
      await act(async () => {
        fireEvent.press(screen.getByLabelText('Play'));
      });
      // 60× — seventy seconds of wall clock is seventy minutes of the day, and
      // the hole runs from ten minutes to a hundred and thirty.
      await act(async () => {
        jest.advanceTimersByTime(70_000);
      });

      expect(screen.getByText(/No signal/)).toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });

  it('advances the playhead while playing', async () => {
    jest.useFakeTimers();
    try {
      await renderScreen(WHOLE_DAY);

      await act(async () => {
        fireEvent.press(screen.getByLabelText('Play'));
      });
      expect(screen.getByLabelText('Pause')).toBeOnTheScreen();

      // At 60×, a second of wall clock is a minute of the day.
      await act(async () => {
        jest.advanceTimersByTime(2_000);
      });

      expect(screen.queryByLabelText('Showing 08:00')).not.toBeOnTheScreen();
    } finally {
      jest.useRealTimers();
    }
  });
});
