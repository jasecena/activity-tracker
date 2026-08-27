import { directionsUrl, mapsUrl } from '../maps';

/**
 * The string is the whole feature.
 *
 * Handing a URL to iOS cannot fail in an interesting way; deciding what the URL
 * says can, and every one of these is a way it has to come out right on a
 * device before anybody would notice it had not.
 */
describe('a link to one coordinate', () => {
  const home = { lat: -37.814218, lon: 144.963161 };

  it('opens the Maps app at the coordinate, with a pin on it', () => {
    const url = mapsUrl(home, 'Home');
    expect(url).toBe('https://maps.apple.com/?ll=-37.814218,144.963161&q=Home');
  });

  it('keeps six decimal places, because the pin is an address and not a claim', () => {
    // Rounding to something "honest" about GPS accuracy would move the pin away
    // from the coordinate the app stored, which is the one thing somebody
    // opening the link is trying to see.
    expect(mapsUrl({ lat: 1, lon: 2 }, 'x')).toContain('ll=1.000000,2.000000');
  });

  it('drops a pin only when there is something to call it', () => {
    // `q` with `ll` is what marks the spot. Without a name there is nothing to
    // label it with, and a bare centring is better than a pin called "".
    expect(mapsUrl(home)).toBe('https://maps.apple.com/?ll=-37.814218,144.963161');
    expect(mapsUrl(home, '   ')).not.toContain('&q=');
  });

  it('encodes a name rather than pasting it into a query string', () => {
    // Rename fields accept anything. An ampersand would otherwise end the
    // parameter and begin one nobody wrote.
    expect(mapsUrl(home, 'Nan & Pop')).toContain('&q=Nan%20%26%20Pop');
  });

  it('survives a Persian place name, which is the normal case here', () => {
    const url = mapsUrl(home, 'گاراژ');
    expect(url).toContain(`&q=${encodeURIComponent('گاراژ')}`);
  });

  it.each([
    ['no coordinate at all', null],
    ['undefined', undefined],
    ['a NaN latitude', { lat: NaN, lon: 144.9 }],
    ['an infinite longitude', { lat: -37.8, lon: Infinity }],
    ['a latitude off the planet', { lat: 91, lon: 0 }],
    ['a longitude off the planet', { lat: 0, lon: -181 }],
  ])('refuses %s rather than linking to the middle of the ocean', (_what, at) => {
    // "NaN" formats into a perfectly valid URL that Maps will open at 0,0 — and
    // on screen that is indistinguishable from the app being confidently wrong
    // about where you were. A caller that gets null hides the button.
    expect(mapsUrl(at as never, 'somewhere')).toBeNull();
  });

  it('accepts the edges of the coordinate system, which are real places', () => {
    expect(mapsUrl({ lat: -90, lon: 180 }, 'edge')).toContain('ll=-90.000000,180.000000');
  });
});

describe('a link to a route', () => {
  const from = { lat: -37.814218, lon: 144.963161 };
  const to = { lat: -37.8, lon: 144.99 };

  it('asks Maps to draw the way between two points', () => {
    expect(directionsUrl(from, to)).toBe(
      'https://maps.apple.com/?saddr=-37.814218,144.963161&daddr=-37.800000,144.990000&dirflg=w',
    );
  });

  it('asks for walking, which is the mode that follows paths', () => {
    // Not because every journey was walked — because driving directions route a
    // walk through a park around it by road, and that is not where you went.
    expect(directionsUrl(from, to)).toContain('dirflg=w');
  });

  it.each([
    ['no start', null, { lat: 0, lon: 0 }],
    ['no end', { lat: 0, lon: 0 }, null],
    ['a NaN in the start', { lat: NaN, lon: 0 }, { lat: 0, lon: 0 }],
    ['a longitude off the planet', { lat: 0, lon: 0 }, { lat: 0, lon: 181 }],
  ])('refuses %s', (_what, a, b) => {
    expect(directionsUrl(a as never, b as never)).toBeNull();
  });
});
