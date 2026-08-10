import { EARTH_RADIUS_M } from '../../geo';
import type { Segment, StaySegment } from '../../segments';
import {
  DEFAULT_PLACE_RADIUS_M,
  isAmbiguous,
  matchPlace,
  normalizePlaces,
  placeFromStay,
  placeIdFor,
  rankPlaceCandidates,
  removePlace,
  upsertPlace,
  visitsByPlace,
  widenToInclude,
  type Place,
} from '../index';

const DEG_PER_METRE = 1 / ((EARTH_RADIUS_M * Math.PI) / 180);
const T0 = Date.UTC(2026, 0, 5, 12, 0, 0);
const HOUR = 3_600_000;

/** A stay `northM` metres north of the origin — synthetic, like every fixture here. */
function stay(northM: number, startedAt: number, endedAt: number): StaySegment {
  return {
    kind: 'stay',
    id: `seg-${startedAt}`,
    startedAt,
    endedAt,
    fixCount: 40,
    center: { lat: northM * DEG_PER_METRE, lon: 0 },
    radiusM: 12,
  };
}

const RESTAURANT = placeFromStay(stay(0, T0, T0 + HOUR), 'abc restaurant');
const COLES = placeFromStay(stay(600, T0, T0 + HOUR), 'Coles');

describe('placeFromStay', () => {
  it('takes its name and its position from the stay you named', () => {
    expect(RESTAURANT.name).toBe('abc restaurant');
    expect(RESTAURANT.lat).toBeCloseTo(0, 9);
    expect(RESTAURANT.radiusM).toBe(DEFAULT_PLACE_RADIUS_M);
  });

  it('trims the name, so a stray space is not a different place', () => {
    expect(placeFromStay(stay(0, T0, T0 + HOUR), '  Home  ').name).toBe('Home');
  });

  // Naming the same spot twice must update one entry, not accumulate two.
  it('gives the same spot the same id every time', () => {
    const again = placeFromStay(stay(0, T0 + HOUR, T0 + 2 * HOUR), 'Somewhere else');
    expect(again.id).toBe(RESTAURANT.id);
  });

  it('gives different spots different ids', () => {
    expect(placeIdFor(0, 0)).not.toBe(placeIdFor(0.001, 0));
  });
});

describe('matchPlace', () => {
  it('recognises a later stay at a place you named', () => {
    // 40 m away — the same café, on a day with worse reception.
    expect(matchPlace(stay(40, T0, T0 + HOUR), [RESTAURANT])?.name).toBe('abc restaurant');
  });

  it('does not recognise somewhere else', () => {
    expect(matchPlace(stay(600, T0, T0 + HOUR), [RESTAURANT])).toBeNull();
  });

  it('finds nothing when nothing has been named', () => {
    expect(matchPlace(stay(0, T0, T0 + HOUR), [])).toBeNull();
  });

  // Overlapping radii are normal — a café inside a shopping centre you also
  // named. "First in the list" would make the answer depend on the order you
  // happened to name them in.
  it('picks the nearest when two places overlap', () => {
    const centre: Place = { id: 'place-centre', name: 'Shopping centre', lat: 0, lon: 0, radiusM: 400 };
    const cafe: Place = { ...placeFromStay(stay(100, T0, T0 + HOUR), 'Café'), radiusM: 150 };

    expect(matchPlace(stay(90, T0, T0 + HOUR), [centre, cafe])?.name).toBe('Café');
    expect(matchPlace(stay(90, T0, T0 + HOUR), [cafe, centre])?.name).toBe('Café');
    expect(matchPlace(stay(10, T0, T0 + HOUR), [centre, cafe])?.name).toBe('Shopping centre');
  });

  it('respects a place with a tighter radius than the default', () => {
    const strict: Place = { ...RESTAURANT, radiusM: 20 };
    expect(matchPlace(stay(40, T0, T0 + HOUR), [strict])).toBeNull();
  });
});

describe('rankPlaceCandidates', () => {
  it('offers nothing when nothing has been named', () => {
    expect(rankPlaceCandidates(stay(0, T0, T0 + HOUR), [])).toEqual([]);
  });

  it('offers the places that claim this stay, nearest first', () => {
    const centre: Place = { id: 'place-centre', name: 'Shopping centre', lat: 0, lon: 0, radiusM: 400 };
    const cafe: Place = { ...placeFromStay(stay(100, T0, T0 + HOUR), 'Café'), radiusM: 150 };

    const candidates = rankPlaceCandidates(stay(90, T0, T0 + HOUR), [centre, cafe]);

    expect(candidates.map((candidate) => candidate.place.name)).toEqual(['Café', 'Shopping centre']);
    expect(candidates.every((candidate) => candidate.withinRadius)).toBe(true);
  });

  // The question when naming a stay is not only "which did I match" but "is
  // this the same place as one just outside the circle". A café named from a
  // visit with good signal is easily 150 m from the same café recorded indoors.
  it('offers nearby places the stay fell outside of, and says so', () => {
    const candidates = rankPlaceCandidates(stay(200, T0, T0 + HOUR), [RESTAURANT]);

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.withinRadius).toBe(false);
    expect(candidates[0]?.distanceM).toBeCloseTo(200, 0);
  });

  it('does not offer places on the other side of town', () => {
    expect(rankPlaceCandidates(stay(5_000, T0, T0 + HOUR), [RESTAURANT, COLES])).toEqual([]);
  });

  it('still offers a place whose own radius is wider than the search', () => {
    const wide: Place = { id: 'place-wide', name: 'The whole park', lat: 0, lon: 0, radiusM: 5_000 };
    const candidates = rankPlaceCandidates(stay(3_000, T0, T0 + HOUR), [wide], { searchRadiusM: 400 });

    expect(candidates).toHaveLength(1);
    expect(candidates[0]?.withinRadius).toBe(true);
  });

  it('honours a limit', () => {
    const centre: Place = { id: 'place-centre', name: 'Shopping centre', lat: 0, lon: 0, radiusM: 400 };
    const cafe: Place = { ...placeFromStay(stay(100, T0, T0 + HOUR), 'Café'), radiusM: 150 };
    expect(rankPlaceCandidates(stay(90, T0, T0 + HOUR), [centre, cafe], { limit: 1 })).toHaveLength(1);
  });
});

describe('isAmbiguous', () => {
  const centre: Place = { id: 'place-centre', name: 'Shopping centre', lat: 0, lon: 0, radiusM: 400 };
  const cafe: Place = { ...placeFromStay(stay(100, T0, T0 + HOUR), 'Café'), radiusM: 150 };

  // Two named places claiming the same stay. The timeline still shows one —
  // the nearest — but that is a guess, and the naming UI should ask.
  it('is true when more than one named place claims the stay', () => {
    expect(isAmbiguous(rankPlaceCandidates(stay(90, T0, T0 + HOUR), [centre, cafe]))).toBe(true);
  });

  it('is false when exactly one does', () => {
    expect(isAmbiguous(rankPlaceCandidates(stay(10, T0, T0 + HOUR), [RESTAURANT]))).toBe(false);
  });

  it('is false when none do, however many are nearby', () => {
    // 200 m away: offered as a candidate, but claimed by nothing.
    expect(isAmbiguous(rankPlaceCandidates(stay(200, T0, T0 + HOUR), [RESTAURANT]))).toBe(false);
  });

  it('is false for no candidates at all', () => {
    expect(isAmbiguous([])).toBe(false);
  });
});

describe('widenToInclude', () => {
  // What "this is the same place" means about a stay that fell outside. The
  // alternative — a second place with the same name — leaves the timeline
  // showing two identical rows with the totals split between them.
  it('grows the radius to take in the stay, with a margin', () => {
    const widened = widenToInclude(RESTAURANT, stay(200, T0, T0 + HOUR), 20);

    expect(widened.radiusM).toBeCloseTo(220, 0);
    expect(matchPlace(stay(200, T0, T0 + HOUR), [widened])?.name).toBe('abc restaurant');
  });

  it('leaves a place alone when the stay was already inside it', () => {
    expect(widenToInclude(RESTAURANT, stay(40, T0, T0 + HOUR))).toBe(RESTAURANT);
  });

  // Dragging the centre towards each new stay would let a place wander down the
  // street over a year of visits.
  it('does not move the centre', () => {
    const widened = widenToInclude(RESTAURANT, stay(200, T0, T0 + HOUR));
    expect(widened.lat).toBe(RESTAURANT.lat);
    expect(widened.lon).toBe(RESTAURANT.lon);
    expect(widened.id).toBe(RESTAURANT.id);
  });
});

describe('the place list', () => {
  it('adds a place', () => {
    expect(upsertPlace([], RESTAURANT)).toEqual([RESTAURANT]);
  });

  it('replaces rather than duplicates when you rename a spot', () => {
    const renamed = { ...RESTAURANT, name: 'The good one' };
    const list = upsertPlace(upsertPlace([], RESTAURANT), renamed);

    expect(list).toHaveLength(1);
    expect(list[0]?.name).toBe('The good one');
  });

  it('removes a place, and shrugs at one that is not there', () => {
    const list = upsertPlace(upsertPlace([], RESTAURANT), COLES);
    expect(removePlace(list, RESTAURANT.id)).toEqual([COLES]);
    expect(removePlace(list, 'place-nowhere')).toEqual(list);
  });
});

describe('visitsByPlace', () => {
  // The question the feature exists for: "how long was I at the restaurant?"
  it('sums every visit to a place, not just the longest', () => {
    const segments: Segment[] = [
      stay(5, T0, T0 + 2 * HOUR),
      stay(600, T0 + 2 * HOUR, T0 + 3 * HOUR),
      // Back at the restaurant later, after stepping out for long enough to
      // break the stay in two.
      stay(20, T0 + 4 * HOUR, T0 + 4.5 * HOUR),
    ];

    const visits = visitsByPlace(segments, [RESTAURANT, COLES]);
    const restaurant = visits.find((entry) => entry.place.name === 'abc restaurant');

    expect(restaurant?.totalMs).toBe(2.5 * HOUR);
    expect(restaurant?.visits).toHaveLength(2);
  });

  it('puts the place you spent longest at first', () => {
    const segments: Segment[] = [stay(5, T0, T0 + 30 * 60_000), stay(600, T0 + HOUR, T0 + 3 * HOUR)];
    expect(visitsByPlace(segments, [RESTAURANT, COLES]).map((entry) => entry.place.name)).toEqual([
      'Coles',
      'abc restaurant',
    ]);
  });

  it('ignores movement and unnamed stays', () => {
    const segments: Segment[] = [
      stay(50_000, T0, T0 + HOUR),
      {
        kind: 'move',
        id: 'seg-move',
        startedAt: T0 + HOUR,
        endedAt: T0 + 2 * HOUR,
        fixCount: 100,
        distanceM: 4_000,
        mode: 'walk',
        label: null,
        modeIsManual: false,
        path: [],
        topSpeedMps: 2,
      },
    ];
    expect(visitsByPlace(segments, [RESTAURANT])).toEqual([]);
  });
});

describe('normalizePlaces', () => {
  it('treats anything that is not a list as no places at all', () => {
    expect(normalizePlaces(null)).toEqual([]);
    expect(normalizePlaces('home')).toEqual([]);
    expect(normalizePlaces({ 0: RESTAURANT })).toEqual([]);
  });

  it('keeps a well-formed place', () => {
    expect(normalizePlaces([RESTAURANT])).toEqual([RESTAURANT]);
  });

  // Dropped rather than repaired: a place with a NaN coordinate matches
  // nothing, silently, and looks exactly like the app forgetting where you live.
  it.each([
    ['no name', { ...RESTAURANT, name: '' }],
    ['a whitespace name', { ...RESTAURANT, name: '   ' }],
    ['a non-string name', { ...RESTAURANT, name: 42 }],
    ['a NaN coordinate', { ...RESTAURANT, lat: Number.NaN }],
    ['a missing coordinate', { ...RESTAURANT, lon: undefined }],
    ['a latitude off the globe', { ...RESTAURANT, lat: 120 }],
    ['a longitude off the globe', { ...RESTAURANT, lon: -400 }],
    ['not being an object at all', 'somewhere'],
    ['being null', null],
  ])('drops a place with %s', (_name, candidate) => {
    expect(normalizePlaces([candidate])).toEqual([]);
  });

  it('falls back to the default radius rather than dropping the place', () => {
    expect(normalizePlaces([{ ...RESTAURANT, radiusM: -1 }])[0]?.radiusM).toBe(DEFAULT_PLACE_RADIUS_M);
    expect(normalizePlaces([{ ...RESTAURANT, radiusM: 'wide' }])[0]?.radiusM).toBe(DEFAULT_PLACE_RADIUS_M);
  });

  it('re-derives the id from the coordinates rather than trusting the stored one', () => {
    expect(normalizePlaces([{ ...RESTAURANT, id: 'place-somewhere-else' }])[0]?.id).toBe(RESTAURANT.id);
  });
});
