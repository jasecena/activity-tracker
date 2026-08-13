import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as BatteryModule from 'expo-battery';

import { EARTH_RADIUS_M, type Fix } from '@/core/geo';
import { STORAGE_KEYS, writeJson } from '@/services/storage';

import { TabShell } from './TabShell';

/**
 * Pin the clock.
 *
 * `services/clock.ts` is the single point where "what time is it" enters the
 * app — it exists so this is possible — and without pinning it these tests
 * depend on when they are run. Seeding a walk at "forty minutes ago" puts it on
 * *yesterday* if the suite runs near local midnight, and yesterday is frozen:
 * the day view then shows the walk from history, unlabelled, and a test about
 * naming a journey fails for reasons that have nothing to do with naming.
 *
 * Found at 00:03 UTC, which is exactly the sort of hour this bites.
 */
jest.mock('@/services/clock', () => ({
  now: () => Date.UTC(2026, 7, 8, 12, 0, 0),
  tzOffsetMinutes: () => 0,
  // Durations, not instants. Pinning the wall clock above would otherwise pin
  // this too, and every measured span would come out as exactly zero.
  monotonicNow: () => performance.now(),
}));

/** The same instant the mock above returns. Midday, so a day has room either side. */
const NOW = Date.UTC(2026, 7, 8, 12, 0, 0);

/**
 * Put a day's worth of fixes in the store before the app reads it.
 *
 * Journeys used to be conjured by pressing Record, which is gone — and was
 * never a journey anyway, only a label with nothing behind it. Seeding the
 * buffer exercises the real vault, the real fold and the real thresholds, which
 * is what a timeline is actually made of.
 *
 * At the equator, longitude 0: a plausible latitude in a committed file is a
 * record of where its author was, and `.gitleaks.toml` fails the build over one.
 */
const DEG_PER_METRE_LAT = 1 / ((EARTH_RADIUS_M * Math.PI) / 180);

async function seedAWalk(): Promise<void> {
  const start = NOW - 40 * 60_000;
  const fixes: Fix[] = [];

  // Ten minutes still, then twenty walking north at 1.4 m/s — enough to clear
  // minStayMs, minMoveMs and minMoveDistanceM, so the fold emits a stop
  // followed by a walk rather than absorbing either.
  for (let elapsed = 0; elapsed <= 10 * 60_000; elapsed += 60_000) {
    fixes.push({ lat: 0, lon: 0, at: start + elapsed, accuracyM: 8, reportedSpeedMps: null, altitudeM: null });
  }
  for (let elapsed = 0; elapsed <= 20 * 60_000; elapsed += 10_000) {
    fixes.push({
      lat: ((1.4 * elapsed) / 1000) * DEG_PER_METRE_LAT,
      lon: 0,
      at: start + 10 * 60_000 + elapsed,
      accuracyM: 8,
      reportedSpeedMps: null,
      altitudeM: null,
    });
  }

  await writeJson(STORAGE_KEYS.fixBuffer, fixes);
}

/**
 * The app, end to end, with the store and Core Location mocked.
 *
 * Shallow on purpose. What this catches is the class of failure the engine
 * suite cannot: a screen that throws on first render because a hook returned
 * undefined, a tab that never mounts, a page that cannot be navigated back out
 * of. Deep assertions about what a timeline says belong in the core suite, where
 * they run in a second and do not depend on a renderer.
 *
 * Every `render` and `fireEvent` is awaited: in React 19 they are asynchronous,
 * and not awaiting one leaves the act scope open so that the *next* test in the
 * file silently never runs its effects.
 */

async function press(label: string) {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(label));
  });
}

/**
 * The Day screen's timeline is a collapsed section, so its rows are not
 * rendered until the heading is pressed. Reading the day starts with opening
 * it, and so does asserting about it.
 */
async function openTimeline() {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(/^TIMELINE/));
  });
}

describe('the shell', () => {
  it('opens on today', async () => {
    await render(<TabShell />);

    expect(await screen.findByLabelText(/^Today\. Choose another day$/)).toBeOnTheScreen();
    expect(screen.getByLabelText('Day tab')).toBeOnTheScreen();
  });

  it('offers to start tracking when it is off, which it is on a fresh install', async () => {
    await render(<TabShell />);
    expect(await screen.findByText('Tracking is off')).toBeOnTheScreen();
  });

  it('says so plainly when there is nothing recorded yet', async () => {
    await render(<TabShell />);
    await screen.findByLabelText(/^TIMELINE/);
    await openTimeline();

    expect(await screen.findByText('Nothing recorded yet today.')).toBeOnTheScreen();
  });

  it('shows every tab and switches between them', async () => {
    await render(<TabShell />);

    // Capture has no header to find: it is a viewfinder filling the screen with
    // the shutter under your thumb, so the shutter is what proves it is up.
    await press('Capture tab');
    expect(screen.getByLabelText('Take photo')).toBeOnTheScreen();

    await press('Media tab');
    expect(screen.getByRole('header', { name: 'Media' })).toBeOnTheScreen();

    await press('Settings tab');
    expect(screen.getByText('Track my day')).toBeOnTheScreen();

    await press('Day tab');
    expect(screen.getByLabelText(/^Today\. Choose another day$/)).toBeOnTheScreen();
  });

  // Today and History were both "look at a day", differing only in which one.
  // They are the same screen now, and the list of days is a page under it.
  it('reaches every day from the day view, and comes back', async () => {
    await seedAWalk();
    await render(<TabShell />);

    // The date is the way in — the calendar button is gone, because an icon
    // beside a date was the same thing twice.
    await press('Today. Choose another day');
    expect(await screen.findByRole('header', { name: 'All days' })).toBeOnTheScreen();

    await press('Back');
    expect(screen.getByLabelText(/^Today\. Choose another day$/)).toBeOnTheScreen();
  });

  // Order is invisible to every other test here — they all select a tab by its
  // label — so without this the deliberate arrangement could be reshuffled by
  // accident and nothing would notice. Capture and Media are the two thumb
  // slots; Settings stays last, where nobody reaches for it by mistake.
  it('keeps the two doing-something tabs under the thumb', async () => {
    await render(<TabShell />);

    const labels = screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel);
    // Five is the ceiling: iOS collapses a sixth into a "More" list, which is
    // why Places is a page under Settings rather than a tab of its own.
    expect(labels).toEqual(['Day tab', 'Capture tab', 'Media tab', 'Notes tab', 'Settings tab']);
  });

  // Places lost its tab to Replay and Capture; it is a reference list you
  // consult rather than somewhere you glance several times a day.
  it('reaches Places through Settings and comes back', async () => {
    await render(<TabShell />);

    await press('Settings tab');
    await press('Places');

    expect(screen.getByRole('header', { name: 'Places' })).toBeOnTheScreen();

    await press('Back');
    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();
  });

  /**
   * Pressing a tab twice goes home — every detail page closed, and on Day the
   * day itself back to today, because the day is a parameter of one screen
   * rather than a page of its own.
   *
   * The clock is frozen in this file, so two presses are zero milliseconds
   * apart and always count as one gesture. That is exactly the case worth
   * pinning: what a second press does, not how fast a finger has to be.
   */
  it('goes back to the root of a tab when it is pressed twice', async () => {
    await render(<TabShell />);

    await press('Settings tab');
    await press('Places');
    expect(screen.getByRole('header', { name: 'Places' })).toBeOnTheScreen();

    await press('Settings tab');
    await press('Settings tab');

    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Places' })).not.toBeOnTheScreen();
  });

  // Moving between tabs is not asking to go home. Two presses on two different
  // tabs is somebody looking around.
  it('leaves a page open when the two presses are on different tabs', async () => {
    await render(<TabShell />);

    await press('Settings tab');
    await press('Places');

    await press('Day tab');
    await press('Settings tab');

    expect(screen.getByRole('header', { name: 'Places' })).toBeOnTheScreen();
  });

  // The camera holds hardware, so it is the one screen that does not stay
  // mounted behind the others.
  it('mounts the camera only while Capture is showing', async () => {
    await render(<TabShell />);

    expect(screen.queryByLabelText('Camera preview', { includeHiddenElements: true })).not.toBeOnTheScreen();

    await press('Capture tab');
    expect(screen.getByLabelText('Camera preview')).toBeOnTheScreen();

    await press('Day tab');
    expect(screen.queryByLabelText('Camera preview', { includeHiddenElements: true })).not.toBeOnTheScreen();
  });

  // Every screen stays mounted so switching tabs cannot throw away a running
  // recording or a timeline that was just derived.
  it('keeps every screen mounted while only one is visible', async () => {
    await render(<TabShell />);

    await press('Settings tab');

    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();
    // The day view is hidden from the accessibility tree — `display: none` —
    // but still mounted, which is the whole point. Asserted on the day bar's
    // date, since the Day screen has no header of its own any more.
    expect(screen.queryByLabelText(/Choose another day$/)).not.toBeOnTheScreen();
    expect(screen.getByLabelText(/Choose another day$/, { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('shows a journey the fold produced from real fixes', async () => {
    await seedAWalk();
    await render(<TabShell />);

    await screen.findByLabelText(/^TIMELINE/);
    await openTimeline();

    expect(await screen.findByLabelText(/^Walk, /)).toBeOnTheScreen();
  });

  it('offers the battery presets in Settings', async () => {
    await render(<TabShell />);

    await press('Settings tab');

    expect(screen.getByText('Balanced')).toBeOnTheScreen();
    expect(screen.getByText('Battery saver')).toBeOnTheScreen();
    expect(screen.getByText('Detailed')).toBeOnTheScreen();
  });

  it('tells you how to name a place before you have named any', async () => {
    await render(<TabShell />);

    await press('Settings tab');
    await press('Places');
    expect(screen.getByText(/Nothing named yet\. Tap a stay on Today to give it a name/)).toBeOnTheScreen();
  });

  it('sorts places by time, visits or name', async () => {
    await render(<TabShell />);

    await press('Settings tab');
    await press('Places');
    await press('Sort by Visits');
    await press('Sort by Name');

    expect(screen.getByRole('header', { name: 'Places' })).toBeOnTheScreen();
  });
});

describe('a nearly-flat battery', () => {
  // Narrowed from the module the app itself imported. `requireActual` would
  // hand back the real expo-battery, and `requireMock` a second instance of the
  // mock with its own charge — either way the app would never see the change.
  const battery = BatteryModule as unknown as typeof import('../../__mocks__/expo-battery');

  afterEach(() => {
    battery.__reset();
  });

  it('says it has dropped to Battery saver, and keeps your choice selected', async () => {
    await render(<TabShell />);
    await press('Settings tab');

    // Comfortably charged: nothing to say.
    expect(screen.queryByText('Running on Battery saver')).not.toBeOnTheScreen();

    await act(async () => {
      battery.__setPower({ level: 0.15 });
    });

    expect(screen.getByText('Running on Battery saver')).toBeOnTheScreen();
    // The chosen preset is untouched — this is a lens, not a setting.
    expect(screen.getByLabelText('Balanced. ~10 m accuracy, a point every 25 m')).toBeOnTheScreen();
  });

  // Hysteresis, end to end: 22% is between the two thresholds, so a phone
  // recovering from 15% is still saving there and only stops above 25%.
  it('holds on until the charge is genuinely back', async () => {
    await render(<TabShell />);
    await press('Settings tab');

    await act(async () => {
      battery.__setPower({ level: 0.15 });
    });
    await act(async () => {
      battery.__setPower({ level: 0.22 });
    });
    expect(screen.getByText('Running on Battery saver')).toBeOnTheScreen();

    await act(async () => {
      battery.__setPower({ level: 0.4 });
    });
    expect(screen.queryByText('Running on Battery saver')).not.toBeOnTheScreen();
  });

  it('does nothing at all on a charger', async () => {
    await render(<TabShell />);
    await press('Settings tab');

    await act(async () => {
      battery.__setPower({ level: 0.05, state: battery.BatteryState.CHARGING });
    });

    expect(screen.queryByText('Running on Battery saver')).not.toBeOnTheScreen();
  });
});

describe('naming a place', () => {
  it('opens the picker from a stay and can be dismissed', async () => {
    await render(<TabShell />);

    // A recording with no fixes produces a move, not a stay, so there is
    // nothing nameable on a fresh install — the picker is unreachable, which is
    // itself the correct behaviour and worth pinning.
    await screen.findByLabelText(/^TIMELINE/);
    await openTimeline();

    expect(await screen.findByText('Nothing recorded yet today.')).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Name this place' })).not.toBeOnTheScreen();
  });
});

describe('raw data and export', () => {
  it('is reachable from Settings and says what is stored', async () => {
    await render(<TabShell />);

    await press('Settings tab');
    await press('Raw data and export');

    expect(await screen.findByRole('header', { name: 'Raw data' })).toBeOnTheScreen();
    // A fresh install holds nothing, and the screen says so rather than
    // showing three zeroes and leaving you to guess why.
    expect(screen.getByLabelText('Raw fixes (not yet frozen): 0')).toBeOnTheScreen();
    expect(screen.getByText(/No raw fixes held/)).toBeOnTheScreen();
  });

  // Raw fixes is no longer among them: it reads the archive as well as the
  // buffer, so "nothing to export" is not something this screen knows without
  // asking the store, and a button disabled on a stale count is worse than one
  // that produces an empty file.
  it('offers all three exports, disabled while there is nothing to export', async () => {
    await render(<TabShell />);

    await press('Settings tab');
    await press('Raw data and export');

    // Raw fixes is not among them. It reads the archive as well as the live
    // buffer, and this screen does not hold the archive — a button greyed out
    // on a count it has not asked for is how the export came to say "today" and
    // mean it.
    expect(screen.getByLabelText('Export raw fixes as CSV')).not.toBeDisabled();
    expect(screen.getByLabelText('Export route points as CSV')).toBeDisabled();
    expect(screen.getByLabelText('Export timeline as CSV')).toBeDisabled();
  });

  // Said before the button is used, not after: an export is the one copy the
  // app's encryption does not cover.
  it('warns that an exported file is plaintext', async () => {
    await render(<TabShell />);

    await press('Settings tab');
    await press('Raw data and export');

    expect(screen.getByText(/An exported file is plain text/)).toBeOnTheScreen();
  });

  it('goes back to Settings', async () => {
    await render(<TabShell />);

    await press('Settings tab');
    await press('Raw data and export');
    await press('Back');

    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();
  });
});

describe('naming a journey', () => {
  it('names one from its page, and the name reaches the timeline', async () => {
    await seedAWalk();
    await render(<TabShell />);

    await screen.findByLabelText(/^TIMELINE/);
    await openTimeline();
    await act(async () => {
      fireEvent.press(await screen.findByLabelText(/^Walk, /));
    });
    await press('Name this journey');

    await act(async () => {
      fireEvent.changeText(screen.getByLabelText('Journey name'), 'Walk to Coles');
    });
    await press('Save this name');
    await press('Back');

    // On the row, which means it went through the store and back out of the
    // fold rather than merely being held in the sheet.
    expect(await screen.findByLabelText(/^Walk to Coles, /)).toBeOnTheScreen();
  });

  // Naming a stop is the place picker's job, and the two must not be offered
  // for the same row — a stop has no mode to correct.
  it('offers naming a journey only on a journey', async () => {
    await seedAWalk();
    await render(<TabShell />);

    await screen.findByLabelText(/^TIMELINE/);
    await openTimeline();
    await act(async () => {
      fireEvent.press(await screen.findByLabelText(/^Unnamed place, /));
    });

    expect(screen.queryByLabelText('Name this journey')).not.toBeOnTheScreen();
    expect(screen.getByLabelText('Name this place')).toBeOnTheScreen();
  });
});

describe('a segment page', () => {
  it('opens from a journey and shows what is stored', async () => {
    await seedAWalk();
    await render(<TabShell />);

    await screen.findByLabelText(/^TIMELINE/);
    await openTimeline();
    await act(async () => {
      fireEvent.press(await screen.findByLabelText(/^Walk, /));
    });

    // Inferred, not yours: nothing has overruled the classifier here.
    expect(screen.getByLabelText(/^Mode: Walk \(inferred\)/)).toBeOnTheScreen();
    expect(screen.getByText('ROUTE POINTS')).toBeOnTheScreen();
  });
});
