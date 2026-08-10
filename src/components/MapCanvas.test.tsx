import { fireEvent, render } from '@testing-library/react-native';
import { MapCanvas, type MapMark } from './MapCanvas';

/**
 * Where a pin is drawn, which is the whole of what went wrong.
 *
 * The capture's pin was an absolutely-positioned view centred over the map
 * container. That is indistinguishable from correct while the map has not been
 * touched — the camera opens centred on the capture, so the middle of the view
 * and the spot are the same pixel — and comes apart on the first pan. Reported
 * from a phone as the pin standing still while the map slid under it.
 *
 * **Two marks are what makes this testable.** One mark cannot fail: its
 * projected position *is* the centre of a box framed around it, so a centred
 * overlay and an anchored pin agree exactly. Two marks at different coordinates
 * have to land in two different places, and nothing drawn in screen space can
 * do that.
 *
 * Asserted on the offline canvas because it is the backend that renders into a
 * tree a test can read. Apple Maps hands its annotations to MapKit, and what
 * MapKit does with them is not observable from here — but both backends now
 * take the picture through the same `thumbUri` on the mark, so the arithmetic
 * being right here is the arithmetic being right there.
 */

const WIDTH = 360;

/** Metres per degree of latitude, near enough at the equator, where fixtures live. */
const DEG_PER_METRE_LAT = 1 / 111_320;

function mark(overrides: Partial<MapMark> & Pick<MapMark, 'id' | 'at'>): MapMark {
  return { label: '', kind: 'media', ...overrides };
}

async function draw(marks: readonly MapMark[]) {
  // Awaited: `render` is asynchronous in this version of the testing library,
  // and not awaiting one leaves the act scope open so the *next* test's effects
  // silently never run.
  const view = await render(
    <MapCanvas mapsEnabled={false} tracks={[]} marks={marks} height={180} label="Map under test" />,
  );
  const canvas = view.getByLabelText('Map under test');

  // Nothing is drawn until the canvas has been laid out: width comes from
  // `onLayout` into state, so a test that never fires one asserts on an empty
  // SVG and passes for the wrong reason.
  await fireEvent(canvas, 'layout', { nativeEvent: { layout: { width: WIDTH, height: 180 } } });

  return view;
}

interface DrawnImage {
  readonly x: number;
  readonly y: number;
  readonly src?: { readonly uri: string };
}

/**
 * Every picture-pin the canvas drew, read off the rendered tree.
 *
 * Walked rather than queried, for two reasons. This version of the testing
 * library exposes no `UNSAFE_*` queries, and an `<Image>` inside an `<Svg>`
 * carries no role or text to find it by — it is not an accessibility element,
 * so there is nothing for a normal query to match on.
 *
 * `RNSVGImage` and `src` are the *host* names: `react-native-svg` renders
 * `<Image href=...>` down to a native view whose prop is `src`. Asserting on
 * the host layer is deliberate — it is what actually reaches the screen, and
 * it is where a prop silently failing to be forwarded would show up.
 */
function drawnOfType(view: Awaited<ReturnType<typeof draw>>, type: string): DrawnImage[] {
  const found: DrawnImage[] = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== 'object') return;
    const element = node as { type?: string; props?: DrawnImage; children?: unknown[] };
    if (element.type === type && element.props) found.push(element.props);
    for (const child of element.children ?? []) walk(child);
  };

  walk(view.toJSON());
  return found;
}

const drawnImages = (view: Awaited<ReturnType<typeof draw>>) => drawnOfType(view, 'RNSVGImage');

describe('a mark carrying a picture', () => {
  it('draws it at the projected point, not the middle of the view', async () => {
    // Four hundred metres apart north-to-south, so the two cannot round into
    // the same pixel however the box is framed.
    const view = await draw([
      mark({ id: 'north', at: { lat: 400 * DEG_PER_METRE_LAT, lon: 0 }, thumbUri: 'file:///north.jpg' }),
      mark({ id: 'south', at: { lat: -400 * DEG_PER_METRE_LAT, lon: 0 }, thumbUri: 'file:///south.jpg' }),
    ]);

    const drawn = drawnImages(view);
    expect(drawn).toHaveLength(2);

    const ys = drawn.map((image) => Number(image.y));
    expect(ys[0]).not.toBe(ys[1]);

    // North is up: the projection flips latitude, so the northern mark sits
    // higher on the screen. This is what a centred overlay could never say.
    expect(Math.min(...ys)).toBeLessThan(Math.max(...ys));
  });

  it('gives each mark its own picture', async () => {
    const view = await draw([
      mark({ id: 'a', at: { lat: 200 * DEG_PER_METRE_LAT, lon: 0 }, thumbUri: 'file:///a.jpg' }),
      mark({ id: 'b', at: { lat: -200 * DEG_PER_METRE_LAT, lon: 0 }, thumbUri: 'file:///b.jpg' }),
    ]);

    const sources = drawnImages(view).map((image) => image.src?.uri);
    expect(sources).toEqual(expect.arrayContaining(['file:///a.jpg', 'file:///b.jpg']));
  });

  it('falls back to a plain dot when there is no picture', async () => {
    const view = await draw([mark({ id: 'plain', at: { lat: 0, lon: 0 }, label: 'Home', kind: 'place' })]);

    // No picture, so the plain dot — and it is still a dot at a projected
    // point rather than nothing at all.
    expect(drawnImages(view)).toHaveLength(0);
    expect(drawnOfType(view, 'RNSVGCircle').length).toBeGreaterThan(0);
  });
});
