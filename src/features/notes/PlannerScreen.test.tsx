import { render, screen } from '@testing-library/react-native';

import { PlannerScreen } from './PlannerScreen';

/**
 * The planner, drawn inside the app.
 *
 * **A `WKWebView` is in this app's process**, unlike the sheet the maps use, so
 * the app is capable of injecting script into the page, reading it, and steering
 * it. What is asserted here is that none of that capability is used — because
 * "we do not do that" is a promise, and a promise in a comment is one somebody
 * adds a prop next to.
 */

const HOME = 'https://tracker.triplec.ai';

async function show(url = HOME) {
  return await render(<PlannerScreen url={url} onBack={jest.fn()} />);
}

function allowFn() {
  return screen.getByTestId('web-view').props.allow as (event: { url: string }) => boolean;
}

describe('the embedded planner', () => {
  it('points at the address it was given', async () => {
    await show();
    expect(screen.getByLabelText(HOME)).toBeOnTheScreen();
  });

  it('injects nothing into the page', async () => {
    // No `injectedJavaScript`, no message handler. The page is not spoken to and
    // does not speak back.
    await show();
    expect(screen.getByTestId('web-view').props.injected).toBeUndefined();
  });

  it('stays on the planner', async () => {
    await show();
    expect(allowFn()({ url: `${HOME}/tasks` })).toBe(true);
    expect(allowFn()({ url: `${HOME}/done?filter=1` })).toBe(true);
  });

  it('refuses a link to anywhere else', async () => {
    // A link to a shop or a search result is not a thing to open inside an app
    // holding somebody's diary, and an embedded view is exactly where that
    // would go unnoticed.
    await show();
    expect(allowFn()({ url: 'https://example.com/' })).toBe(false);
  });

  it('is not fooled by a host that merely starts the same way', async () => {
    // `tracker.triplec.ai.evil.example` shares a prefix and is somebody else's
    // host, which is why this compares origins rather than strings.
    await show();
    expect(allowFn()({ url: 'https://tracker.triplec.ai.evil.example/' })).toBe(false);
  });

  it('refuses a scheme that is not https, whatever the host says', async () => {
    await show();
    expect(allowFn()({ url: 'http://tracker.triplec.ai/' })).toBe(false);
    expect(allowFn()({ url: 'javascript:alert(1)' })).toBe(false);
  });

  it('lets the view start', async () => {
    // `about:blank` and the first load arrive here too, and refusing them would
    // mean refusing to open at all.
    await show();
    expect(allowFn()({ url: 'about:blank' })).toBe(true);
  });

  it('says it is reaching the planner while it loads', async () => {
    // Off the VPN it simply does not arrive, and the view says so in its own
    // words — but a blank screen with no explanation is the state worth naming.
    await show();
    expect(screen.getByText('Reaching the planner…')).toBeOnTheScreen();
  });
});
