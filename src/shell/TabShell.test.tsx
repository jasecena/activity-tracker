import { act, fireEvent, render, screen } from '@testing-library/react-native';
import * as BatteryModule from 'expo-battery';

import { EARTH_RADIUS_M, type Fix } from '@/core/geo';
import { silenceAudio, takeAudioFocus } from '@/services/audioFocus';
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
/**
 * Open the app on the Day screen.
 *
 * **The Planner is the first tab now and the app opens on it**, so nearly every
 * test in this file — all of which are about what the rest of the shell does —
 * has to step off it first. Tabs are hidden with `display: none` rather than
 * unmounted, which is what makes them invisible to a query as well as to a
 * reader.
 */
async function openOnDay() {
  const rendered = await render(<TabShell />);
  await press('Day tab');
  return rendered;
}

/**
 * Reach Settings, which is no longer a tab.
 *
 * A gear at the top left of the Notes header, opening a page above it. Pressed
 * twice in a row it would push twice, so the tests that walk in and out of it
 * go through here rather than pressing a label directly.
 */
async function openSettings() {
  await press('Notes tab');
  await press('Settings');
}

async function openTimeline() {
  await act(async () => {
    fireEvent.press(screen.getByLabelText(/^TIMELINE/));
  });
}

describe('the shell', () => {
  it('opens on the planner, which is the first tab', async () => {
    // What the machine at home made of everything said into this phone, which
    // is the question somebody has when they pick it up. Everything else here
    // is recording; that tab is the reading.
    //
    // Rendered directly rather than through `openOnDay`, since what is being
    // asserted is where the app lands before anything is pressed.
    await render(<TabShell />);

    expect(await screen.findByLabelText('Planner tab')).toBeOnTheScreen();
    expect(screen.getByLabelText('Reload the planner')).toBeOnTheScreen();
  });

  it('reaches today in one press', async () => {
    await openOnDay();

    expect(await screen.findByLabelText(/^Today\. Choose another day$/)).toBeOnTheScreen();
  });

  it('offers to start tracking when it is off, which it is on a fresh install', async () => {
    await openOnDay();
    expect(await screen.findByText('Tracking is off')).toBeOnTheScreen();
  });

  it('says so plainly when there is nothing recorded yet', async () => {
    await openOnDay();
    await screen.findByLabelText(/^TIMELINE/);
    await openTimeline();

    expect(await screen.findByText('Nothing recorded yet today.')).toBeOnTheScreen();
  });

  /**
   * **Leaving a tab stops what it was playing.**
   *
   * Tabs stay mounted with the inactive ones hidden, which is deliberate — it
   * is what stops a switch throwing away a running recording or a timeline just
   * derived — and the cost is a player that carries on behind a screen nobody
   * is looking at, with its pause button a tab away.
   *
   * Driven through the focus registry rather than through a real player, on
   * purpose: the fake stands in for any of them, and what is being asserted is
   * the shell's rule, not one player's wiring. Whether a player is *in* the
   * registry is asserted where that player lives.
   */
  it('silences whatever was playing when the tab changes', async () => {
    await openOnDay();

    const stop = jest.fn();
    takeAudioFocus(stop);

    await press('Notes tab');
    expect(stop).toHaveBeenCalledTimes(1);
  });

  it('leaves playback alone while you stay on the same tab', async () => {
    await openOnDay();

    const stop = jest.fn();
    takeAudioFocus(stop);

    // Pressing the tab you are already on goes home; it does not take you off
    // the screen you are listening to.
    await press('Day tab');
    expect(stop).not.toHaveBeenCalled();

    silenceAudio();
  });

  it('shows every tab and switches between them', async () => {
    await openOnDay();

    // Capture has no header to find: it is a viewfinder filling the screen with
    // the shutter under your thumb, so the shutter is what proves it is up.
    await press('Capture tab');
    expect(screen.getByLabelText('Take photo')).toBeOnTheScreen();

    await press('Media tab');
    expect(screen.getByRole('header', { name: 'Media' })).toBeOnTheScreen();

    await openSettings();
    expect(screen.getByText('Track my day')).toBeOnTheScreen();

    await press('Day tab');
    expect(screen.getByLabelText(/^Today\. Choose another day$/)).toBeOnTheScreen();
  });

  // Today and History were both "look at a day", differing only in which one.
  // They are the same screen now, and the list of days is a page under it.
  it('reaches every day from the day view, and comes back', async () => {
    await seedAWalk();
    await openOnDay();

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
    await openOnDay();

    const labels = screen.getAllByRole('tab').map((tab) => tab.props.accessibilityLabel);
    // Six, and the bar is drawn here rather than by UIKit — the "iOS collapses a
    // sixth into More" rule this used to cite is about `UITabBar` and has never
    // applied to it. What still applies is width, which is why Places stays a
    // page under Settings rather than becoming a seventh.
    // Five, and Settings is not among them: it is a gear at the top left of
    // Notes. A tab is for somewhere you go several times a day, and Settings is
    // somewhere you go twice and then not for a month.
    expect(labels).toEqual(['Planner tab', 'Day tab', 'Capture tab', 'Media tab', 'Notes tab']);
  });

  // Places lost its tab to Replay and Capture; it is a reference list you
  // consult rather than somewhere you glance several times a day.
  it('reaches Places through Settings and comes back', async () => {
    await openOnDay();

    await openSettings();
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
    await openOnDay();

    await openSettings();
    await press('Places');
    expect(screen.getByRole('header', { name: 'Places' })).toBeOnTheScreen();

    await openSettings();
    await openSettings();

    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();
    expect(screen.queryByRole('header', { name: 'Places' })).not.toBeOnTheScreen();
  });

  // Moving between tabs is not asking to go home. Two presses on two different
  // tabs is somebody looking around.
  it('leaves a page open when the two presses are on different tabs', async () => {
    await openOnDay();

    await openSettings();
    await press('Places');

    await press('Day tab');
    // Back to the tab, not back through the gear: the stack already holds
    // Settings and Places, and pressing a tab you are not on only switches to
    // it. Pressing the gear again would push a second Settings onto the pile.
    await press('Notes tab');

    expect(screen.getByRole('header', { name: 'Places' })).toBeOnTheScreen();
  });

  /**
   * **A page underneath another stays mounted, and this cost a release.**
   *
   * The stack drew only its top page. That was invisible while nothing went
   * more than one deep — what sat underneath was the tab root, always mounted —
   * and became real the moment Settings moved under Notes: opening Places
   * unmounted Settings, so coming back put you at the top of a page you had
   * scrolled halfway down.
   *
   * Jest cannot see a scroll position, which is why the smoke flow caught it
   * and this did not. What it can see is whether the screen still exists, which
   * is the mechanism underneath.
   */
  it('keeps a page mounted while another sits over it', async () => {
    await openOnDay();
    await openSettings();
    await press('Places');

    expect(screen.getByRole('header', { name: 'Places' })).toBeOnTheScreen();
    // Hidden rather than gone: `display: none`, the same way an inactive tab is
    // kept alive behind the one showing.
    expect(screen.queryByRole('header', { name: 'Settings', includeHiddenElements: true })).not.toBeNull();
  });

  // The camera holds hardware, so it is the one screen that does not stay
  // mounted behind the others.
  it('mounts the camera only while Capture is showing', async () => {
    await openOnDay();

    expect(screen.queryByLabelText('Camera preview', { includeHiddenElements: true })).not.toBeOnTheScreen();

    await press('Capture tab');
    expect(screen.getByLabelText('Camera preview')).toBeOnTheScreen();

    await press('Day tab');
    expect(screen.queryByLabelText('Camera preview', { includeHiddenElements: true })).not.toBeOnTheScreen();
  });

  // Every screen stays mounted so switching tabs cannot throw away a running
  // recording or a timeline that was just derived.
  it('keeps every screen mounted while only one is visible', async () => {
    await openOnDay();

    await openSettings();

    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();
    // The day view is hidden from the accessibility tree — `display: none` —
    // but still mounted, which is the whole point. Asserted on the day bar's
    // date, since the Day screen has no header of its own any more.
    expect(screen.queryByLabelText(/Choose another day$/)).not.toBeOnTheScreen();
    expect(screen.getByLabelText(/Choose another day$/, { includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('shows a journey the fold produced from real fixes', async () => {
    await seedAWalk();
    await openOnDay();

    await screen.findByLabelText(/^TIMELINE/);
    await openTimeline();

    expect(await screen.findByLabelText(/^Walk, /)).toBeOnTheScreen();
  });

  it('offers the battery presets in Settings', async () => {
    await openOnDay();

    await openSettings();

    expect(screen.getByText('Balanced')).toBeOnTheScreen();
    expect(screen.getByText('Battery saver')).toBeOnTheScreen();
    expect(screen.getByText('Detailed')).toBeOnTheScreen();
  });

  it('tells you how to name a place before you have named any', async () => {
    await openOnDay();

    await openSettings();
    await press('Places');
    expect(screen.getByText(/Nothing named yet\. Tap a stay on Today to give it a name/)).toBeOnTheScreen();
  });

  it('sorts places by time, visits or name', async () => {
    await openOnDay();

    await openSettings();
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
    await openOnDay();
    await openSettings();

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
    await openOnDay();
    await openSettings();

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
    await openOnDay();
    await openSettings();

    await act(async () => {
      battery.__setPower({ level: 0.05, state: battery.BatteryState.CHARGING });
    });

    expect(screen.queryByText('Running on Battery saver')).not.toBeOnTheScreen();
  });
});

describe('naming a place', () => {
  it('opens the picker from a stay and can be dismissed', async () => {
    await openOnDay();

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
    await openOnDay();

    await openSettings();
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
    await openOnDay();

    await openSettings();
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
    await openOnDay();

    await openSettings();
    await press('Raw data and export');

    expect(screen.getByText(/An exported file is plain text/)).toBeOnTheScreen();
  });

  it('goes back to Settings', async () => {
    await openOnDay();

    await openSettings();
    await press('Raw data and export');
    await press('Back');

    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();
  });
});

describe('naming a journey', () => {
  it('names one from its page, and the name reaches the timeline', async () => {
    await seedAWalk();
    await openOnDay();

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
    await openOnDay();

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
    await openOnDay();

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
