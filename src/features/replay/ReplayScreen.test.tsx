import { act, fireEvent, render, screen } from '@testing-library/react-native';
import { useState } from 'react';

import type { DayGroup } from '@/core/day';
import type { UseSettings } from '@/features/settings/hooks/useSettings';
import { EARTH_RADIUS_M, type PathPoint } from '@/core/geo';
import { journeyLabelId, labelledSegmentId, type MoveSegment, type Segment, type StaySegment } from '@/core/segments';

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

/** Yesterday, so there is somewhere to go back from. */
const YESTERDAY: DayGroup = {
  key: '2026-01-04',
  startedAt: Date.UTC(2026, 0, 4),
  segments: [move(T0 - 24 * 60 * 60_000, T0 - 24 * 60 * 60_000 + 10 * MINUTE, 0, 800)],
};

function renderTwoDays() {
  function Harness() {
    const [selected, setSelected] = useState<string | null>(null);
    return (
      <ReplayScreen
        days={[WHOLE_DAY, YESTERDAY]}
        places={[]}
        media={[]}
        settings={SETTINGS}
        tzOffsetMinutes={0}
        mapsEnabled={false}
        ready
        selectedDayKey={selected}
        onSelectDay={setSelected}
        onOpenSegment={() => undefined}
        onOpenMedia={() => undefined}
        onOpenAllDays={() => undefined}
        onMerge={() => undefined}
        onUnmerge={() => undefined}
      />
    );
  }
  return render(<Harness />);
}

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
      onMerge={() => undefined}
      onUnmerge={() => undefined}
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
        onMerge={() => undefined}
        onUnmerge={() => undefined}
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

describe('getting back to today', () => {
  // A day view is long, and the previous/next arrows scroll away with it. The
  // button lives in the header, which does not move.
  it('offers no way back while you are already on today', async () => {
    await renderTwoDays();
    expect(screen.queryByLabelText('Back to today')).not.toBeOnTheScreen();
  });

  it('appears once you have gone back, and returns in one tap', async () => {
    await renderTwoDays();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Previous day'));
    });
    expect(screen.getByRole('header', { name: 'Sunday 4 Jan' })).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Back to today'));
    });

    expect(screen.getByRole('header', { name: 'Today' })).toBeOnTheScreen();
    expect(screen.queryByLabelText('Back to today')).not.toBeOnTheScreen();
  });
});

const LABEL = { id: '', label: '', mode: null, startedAt: 0, endedAt: 0 } as const;

describe('merging rows', () => {
  /** A day with two walks and a stop between them. */
  const THREE_ROWS: DayGroup = {
    key: '2026-01-05',
    startedAt: Date.UTC(2026, 0, 5),
    segments: [
      move(T0, T0 + 10 * MINUTE, 0, 800),
      stay(T0 + 10 * MINUTE, T0 + 25 * MINUTE, 800),
      move(T0 + 25 * MINUTE, T0 + 35 * MINUTE, 800, 1_600),
    ],
  };

  function renderWithMerge(onMerge: (segments: readonly Segment[]) => void) {
    return render(
      <ReplayScreen
        days={[THREE_ROWS]}
        places={[]}
        media={[]}
        settings={SETTINGS}
        tzOffsetMinutes={0}
        mapsEnabled={false}
        ready
        selectedDayKey={THREE_ROWS.key}
        onSelectDay={() => undefined}
        onOpenSegment={() => undefined}
        onOpenMedia={() => undefined}
        onOpenAllDays={() => undefined}
        onMerge={onMerge}
        onUnmerge={() => undefined}
      />,
    );
  }

  async function longPress(label: RegExp) {
    await act(async () => {
      fireEvent(screen.getByLabelText(label), 'longPress');
    });
  }

  it('shows nothing until a row is held', async () => {
    await renderWithMerge(() => undefined);
    expect(screen.queryByLabelText('Cancel selection')).not.toBeOnTheScreen();
  });

  it('needs two rows before it will merge anything', async () => {
    await renderWithMerge(() => undefined);

    await longPress(/from 08:00$/);
    expect(screen.getByLabelText('Cancel selection')).toBeOnTheScreen();
    expect(screen.getByLabelText('Merge 1 rows')).toBeDisabled();
  });

  // The span rather than the count, because everything between the first and
  // the last comes too — including the stop nobody ticked.
  it('states the span it is about to swallow', async () => {
    await renderWithMerge(() => undefined);

    await longPress(/from 08:00$/);
    await longPress(/from 08:25$/);

    expect(screen.getByText('08:00–08:35')).toBeOnTheScreen();
  });

  it('hands back every row in the span when merged', async () => {
    const onMerge = jest.fn();
    await renderWithMerge(onMerge);

    await longPress(/from 08:00$/);
    await longPress(/from 08:25$/);
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Merge 2 rows'));
    });

    expect(onMerge).toHaveBeenCalledTimes(1);
    const chosen = onMerge.mock.calls[0]?.[0] as readonly Segment[];
    expect(chosen).toHaveLength(2);
    // Selection clears, so the bar cannot be left behind on a merged day.
    expect(screen.queryByLabelText('Cancel selection')).not.toBeOnTheScreen();
  });

  it('lets a held row be let go again', async () => {
    await renderWithMerge(() => undefined);

    await longPress(/from 08:00$/);
    await longPress(/from 08:00$/);

    expect(screen.queryByLabelText('Cancel selection')).not.toBeOnTheScreen();
  });
});

/**
 * Taking a merge apart again.
 *
 * A merge produces one row, so the natural way to undo it is to hold that row
 * alone — at which point Merge is disabled anyway, because there is nothing to
 * join it to. Offering Unmerge in its place is what makes holding a row mean
 * "do something to this" rather than only ever "join this to another".
 */
describe('unmerging a row', () => {
  /** What `applyJourneyLabels` emits: one row, id namespaced by its label. */
  const MERGED: DayGroup = {
    key: '2026-01-05',
    startedAt: Date.UTC(2026, 0, 5),
    segments: [
      { ...move(T0, T0 + 35 * MINUTE, 0, 1_600), id: labelledSegmentId({ ...LABEL, id: journeyLabelId(T0) }) },
      move(T0 + 40 * MINUTE, T0 + 50 * MINUTE, 1_600, 2_000),
    ],
  };

  const LABEL_ID = journeyLabelId(T0);

  function renderWithUnmerge(onUnmerge: (ids: readonly string[]) => void) {
    return render(
      <ReplayScreen
        days={[MERGED]}
        places={[]}
        media={[]}
        settings={SETTINGS}
        tzOffsetMinutes={0}
        mapsEnabled={false}
        ready
        selectedDayKey={MERGED.key}
        onSelectDay={() => undefined}
        onOpenSegment={() => undefined}
        onOpenMedia={() => undefined}
        onOpenAllDays={() => undefined}
        onMerge={() => undefined}
        onUnmerge={onUnmerge}
      />,
    );
  }

  /** Both rows are walks, so they are told apart by position, not by label. */
  async function hold(which: number) {
    await act(async () => {
      fireEvent(screen.getAllByLabelText(/^Walk/)[which] as never, 'longPress');
    });
  }

  it('offers Unmerge on a row a merge produced', async () => {
    await renderWithUnmerge(() => undefined);
    await hold(0);

    expect(screen.getByLabelText('Unmerge this journey')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Merge/)).not.toBeOnTheScreen();
  });

  it('forgets the label behind it', async () => {
    const onUnmerge = jest.fn();
    await renderWithUnmerge(onUnmerge);
    await hold(0);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Unmerge this journey'));
    });

    expect(onUnmerge).toHaveBeenCalledWith([LABEL_ID]);
  });

  // An ordinary row was never merged, so there is nothing to take apart and the
  // button must not claim otherwise.
  it('offers Merge, not Unmerge, on a row the day produced by itself', async () => {
    await renderWithUnmerge(() => undefined);
    // The second row: a plain move with no label behind it.
    await hold(1);

    expect(screen.getByLabelText('Merge 1 rows')).toBeOnTheScreen();
    expect(screen.queryByLabelText(/^Unmerge/)).not.toBeOnTheScreen();
  });
});
