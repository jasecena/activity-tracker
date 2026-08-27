import { Linking } from 'react-native';

import { openPlanner } from '../openMap';

/**
 * Handing an address to the browser.
 *
 * The planner lives on a VPN and this app never fetches it — the icon on the
 * Plans list hands the address over, exactly as a stay is handed to Maps. What
 * is worth asserting is that it refuses to hand over something that is not a
 * website, because the value comes out of a text box in Settings.
 */
describe('opening the planner', () => {
  let open: jest.SpyInstance;

  beforeEach(() => {
    open = jest.spyOn(Linking, 'openURL').mockResolvedValue(true);
  });

  afterEach(() => open.mockRestore());

  it('opens an https address', async () => {
    expect(await openPlanner('https://tracker.triplec.ai')).toEqual({ ok: true });
    expect(open).toHaveBeenCalledWith('https://tracker.triplec.ai');
  });

  it.each(['javascript:alert(1)', 'file:///etc/passwd', 'http://tracker.triplec.ai', '', '   '])(
    'refuses %p rather than handing it to the system',
    async (url) => {
      // `javascript:` and `file:` are the two worth refusing outright — neither
      // is a website, and both are things `openURL` would otherwise be asked to
      // do with a value that came out of a text box.
      expect(await openPlanner(url)).toEqual({ ok: false, reason: 'no-coordinate' });
      expect(open).not.toHaveBeenCalled();
    },
  );

  it('reports a refusal by the system rather than throwing', async () => {
    open.mockRejectedValue(new Error('no handler'));
    expect(await openPlanner('https://tracker.triplec.ai')).toMatchObject({ ok: false, reason: 'failed' });
  });
});
