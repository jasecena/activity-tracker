import { lensLabel, orderLenses, worthOffering } from '../lenses';

describe('lensLabel', () => {
  it('names the three real lenses', () => {
    expect(lensLabel('builtInUltraWideCamera')).toBe('Ultra wide');
    expect(lensLabel('builtInWideAngleCamera')).toBe('Wide');
    expect(lensLabel('builtInTelephotoCamera')).toBe('Tele');
  });

  /**
   * Apple adds device types with new phones. A rail showing a raw
   * `builtInSomethingNewCamera` is worse than one showing "Something new", and
   * dropping it would hide a real camera on a phone this build has never seen.
   */
  it('makes something readable of a lens it has never heard of', () => {
    expect(lensLabel('builtInQuadWideCamera')).toBe('Quad wide');
  });

  it('gives up gracefully rather than returning nothing', () => {
    // Nothing left after stripping the prefix and suffix, so the raw id is
    // still better than an empty button.
    expect(lensLabel('builtInCamera')).toBe('builtInCamera');
    // Not one of Apple's shapes at all, and still readable.
    expect(lensLabel('somethingElse')).toBe('Something else');
  });

  // Never a magnification. Apple's names say what a lens is, and the multiplier
  // differs by model — the telephoto is 2×, 3× or 5× and nothing says which.
  it('never claims a magnification', () => {
    for (const id of ['builtInUltraWideCamera', 'builtInWideAngleCamera', 'builtInTelephotoCamera']) {
      expect(lensLabel(id)).not.toMatch(/[×x]/);
      expect(lensLabel(id)).not.toMatch(/\d/);
    }
  });
});

describe('orderLenses', () => {
  it('puts the widest first, whatever order they arrived in', () => {
    const shuffled = ['builtInTelephotoCamera', 'builtInUltraWideCamera', 'builtInWideAngleCamera'];

    expect(orderLenses(shuffled)).toEqual([
      'builtInUltraWideCamera',
      'builtInWideAngleCamera',
      'builtInTelephotoCamera',
    ]);
  });

  // Choosing a virtual device is choosing not to choose, so it goes after the
  // real ones rather than in among them.
  it('puts the switching devices after the real lenses', () => {
    const ordered = orderLenses(['builtInTripleCamera', 'builtInWideAngleCamera']);

    expect(ordered[0]).toBe('builtInWideAngleCamera');
  });

  it('keeps an unknown lens rather than dropping it, and puts it last', () => {
    const ordered = orderLenses(['builtInMysteryCamera', 'builtInWideAngleCamera']);

    expect(ordered).toEqual(['builtInWideAngleCamera', 'builtInMysteryCamera']);
  });

  it('does not modify what it was given', () => {
    const original = ['builtInTelephotoCamera', 'builtInUltraWideCamera'];
    orderLenses(original);

    expect(original).toEqual(['builtInTelephotoCamera', 'builtInUltraWideCamera']);
  });
});

describe('worthOffering', () => {
  // One lens is not a choice, and the front camera usually has exactly one.
  it('is false for nothing to choose between', () => {
    expect(worthOffering([])).toBe(false);
    expect(worthOffering(['builtInWideAngleCamera'])).toBe(false);
  });

  it('is true once there is a choice', () => {
    expect(worthOffering(['builtInWideAngleCamera', 'builtInTelephotoCamera'])).toBe(true);
  });
});
