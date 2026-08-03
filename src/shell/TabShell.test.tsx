import { act, fireEvent, render, screen } from '@testing-library/react-native';

import { TabShell } from './TabShell';

/**
 * The app, end to end, with the store and Core Location mocked.
 *
 * Shallow on purpose. What this catches is the class of failure the engine
 * suite cannot: a screen that throws on first render because a hook returned
 * undefined, a tab that never mounts, a missing provider. Deep assertions about
 * what a timeline says belong in the core suite, where they run in a second and
 * do not depend on a renderer.
 *
 * Every `render` and `fireEvent` is awaited: in React 19 they are asynchronous,
 * and not awaiting one leaves the act scope open so that the *next* test in the
 * file silently never runs its effects.
 */
describe('the shell', () => {
  it('opens on Today', async () => {
    await render(<TabShell />);

    // By role, not by text: "Today" is also the tab label, and a bare text
    // query matches both.
    expect(await screen.findByRole('header', { name: 'Today' })).toBeOnTheScreen();
    expect(screen.getByLabelText('Today tab')).toBeOnTheScreen();
  });

  it('offers to start tracking when it is off, which it is on a fresh install', async () => {
    await render(<TabShell />);
    expect(await screen.findByText('Tracking is off')).toBeOnTheScreen();
  });

  it('says so plainly when there is nothing recorded yet', async () => {
    await render(<TabShell />);
    expect(await screen.findByText('Nothing recorded yet today.')).toBeOnTheScreen();
  });

  it('shows the three tabs and switches between them', async () => {
    await render(<TabShell />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('History tab'));
    });
    expect(screen.getByText('Finished days appear here after midnight.')).toBeOnTheScreen();

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Settings tab'));
    });
    expect(screen.getByText('Track my day')).toBeOnTheScreen();
  });

  // Every screen stays mounted so switching tabs cannot throw away a running
  // recording or a timeline that was just derived.
  it('keeps every screen mounted while only one is visible', async () => {
    await render(<TabShell />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Settings tab'));
    });

    expect(screen.getByRole('header', { name: 'Settings' })).toBeOnTheScreen();

    // Today is hidden from the accessibility tree — `display: none` — but still
    // mounted, which is the whole point: switching tabs must not throw away a
    // running recording or the timeline that was just derived.
    expect(screen.queryByRole('header', { name: 'Today' })).not.toBeOnTheScreen();
    expect(screen.getByRole('header', { name: 'Today', includeHiddenElements: true })).toBeOnTheScreen();
  });

  it('names a recording and starts it', async () => {
    await render(<TabShell />);

    await act(async () => {
      fireEvent.changeText(await screen.findByLabelText('Activity name'), 'Walk to Coles');
    });
    await act(async () => {
      fireEvent.press(screen.getByLabelText('Start recording'));
    });

    // The name appears twice, and both are correct: once in the record bar as
    // the running recording, and once in the timeline as the row it created.
    // A recording with no fixes behind it still gets a row — see
    // core/segments/manual.ts.
    expect(await screen.findAllByText('Walk to Coles')).toHaveLength(2);
    expect(screen.getByLabelText('Stop recording Walk to Coles')).toBeOnTheScreen();
  });

  it('offers the battery presets in Settings', async () => {
    await render(<TabShell />);

    await act(async () => {
      fireEvent.press(screen.getByLabelText('Settings tab'));
    });

    expect(screen.getByText('Balanced')).toBeOnTheScreen();
    expect(screen.getByText('Battery saver')).toBeOnTheScreen();
    expect(screen.getByText('Detailed')).toBeOnTheScreen();
  });
});
