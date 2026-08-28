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

  it('drops a pin through the documented Maps URLs form', () => {
    // `?api=1` is the contract Google publishes and promises to keep. The older
    // `maps.google.com/?q=` forms work and are specified nowhere, which is a
    // poor thing to build a stored link on.
    expect(mapsUrl(home)).toBe('https://www.google.com/maps/search/?api=1&query=-37.814218,144.963161');
  });

  it('keeps six decimal places, because the pin is an address and not a claim', () => {
    // Rounding to something "honest" about GPS accuracy would move the pin away
    // from the coordinate the app stored, which is the one thing somebody
    // opening the link is trying to see.
    expect(mapsUrl({ lat: 1, lon: 2 })).toContain('query=1.000000,2.000000');
  });

  it.each([
    ['no coordinate at all', null],
    ['undefined', undefined],
    ['a NaN latitude', { lat: NaN, lon: 144.9 }],
    ['an infinite longitude', { lat: -37.8, lon: Infinity }],
    ['a latitude off the planet', { lat: 91, lon: 0 }],
    ['a longitude off the planet', { lat: 0, lon: -181 }],
  ])('refuses %s rather than linking to the middle of the ocean', (_what, at) => {
    // "NaN" formats into a perfectly valid URL that opens at 0,0 — and on
    // screen that is indistinguishable from the app being confidently wrong
    // about where you were. A caller that gets null hides the button.
    expect(mapsUrl(at as never)).toBeNull();
  });

  it('accepts the edges of the coordinate system, which are real places', () => {
    expect(mapsUrl({ lat: -90, lon: 180 })).toContain('query=-90.000000,180.000000');
  });
});

describe('a link to a route', () => {
  const from = { lat: -37.814218, lon: 144.963161 };
  const to = { lat: -37.8, lon: 144.99 };

  it('asks for the way between two points', () => {
    expect(directionsUrl(from, to)).toBe(
      'https://www.google.com/maps/dir/?api=1&origin=-37.814218,144.963161' +
        '&destination=-37.800000,144.990000&travelmode=walking',
    );
  });

  it('asks for walking, which is the mode that follows paths', () => {
    // Not because every journey was walked — because driving directions route a
    // walk through a park around it by road, and that is not where you went.
    expect(directionsUrl(from, to)).toContain('travelmode=walking');
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
