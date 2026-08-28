import * as WebBrowser from 'expo-web-browser';
import { Linking } from 'react-native';

import { openPlanner } from '../openMap';

/**
 * Putting a web page in front of somebody, without leaving the app.
 *
 * `SFSafariViewController` rather than a hand-off, so a Done button comes back
 * to where you were. What is worth asserting is that it refuses to open
 * something that is not a website — the value comes out of a text box in
 * Settings — and that a device which will not present a browser still gets
 * somewhere.
 */
describe('opening the planner', () => {
  let browser: jest.SpyInstance;
  let handOff: jest.SpyInstance;

  beforeEach(() => {
    browser = jest.spyOn(WebBrowser, 'openBrowserAsync').mockResolvedValue({ type: 'dismiss' } as never);
    handOff = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => {
    browser.mockRestore();
    handOff.mockRestore();
  });

  it('opens an https address in the app rather than handing it away', async () => {
    expect(await openPlanner('https://tracker.triplec.ai')).toEqual({ ok: true });
    expect(browser).toHaveBeenCalledWith('https://tracker.triplec.ai', expect.anything());
    expect(handOff).not.toHaveBeenCalled();
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'http://tracker.triplec.ai', '', '   '])(
    'refuses %p rather than opening it',
    async (url) => {
      // `javascript:` and `file:` are the two worth refusing outright — neither
      // is a website, and both are things a browser would otherwise be asked to
      // do with a value that came out of a text box.
      expect(await openPlanner(url)).toEqual({ ok: false, reason: 'no-coordinate' });
      expect(browser).not.toHaveBeenCalled();
      expect(handOff).not.toHaveBeenCalled();
    },
  );

  it('hands it over when no in-app browser can be presented', async () => {
    // The in-app browser is the nicer of two ways to read a page, not the only
    // one. A device that cannot present one should still reach the map.
    browser.mockRejectedValue(new Error('no view controller'));

    expect(await openPlanner('https://tracker.triplec.ai')).toEqual({ ok: true });
    expect(handOff).toHaveBeenCalledWith('https://tracker.triplec.ai');
  });

  it('reports a failure only when neither way works', async () => {
    browser.mockRejectedValue(new Error('no view controller'));
    handOff.mockRejectedValue(new Error('no handler'));

    expect(await openPlanner('https://tracker.triplec.ai')).toMatchObject({ ok: false, reason: 'failed' });
  });
});
