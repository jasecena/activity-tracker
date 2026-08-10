import { labelOf, measuredSpans, record, timed, __resetTimings } from '../timing';

/**
 * The clock is mocked so a span has a duration at all — but note *which* one is
 * mocked. `timing.ts` reads `monotonicNow`, never `now`, because it measures
 * durations and the wall clock is corrected under a phone that has been running
 * all day. Mocking `now` here and having these pass would mean the module was
 * still reading the wrong clock.
 */
jest.mock('../clock', () => {
  let at = 1_000;
  return {
    now: jest.fn(() => {
      throw new Error('timing must measure with monotonicNow, not the wall clock');
    }),
    monotonicNow: jest.fn(() => (at += 25)),
  };
});

beforeEach(() => {
  __resetTimings();
});

describe('timed', () => {
  it('measures the work under its name and returns its result', async () => {
    const result = await timed('read something', async () => 'the value');

    expect(measuredSpans()[0]?.name).toBe('read something');
    expect(measuredSpans()[0]?.ms).toBeGreaterThan(0);
    expect(result).toBe('the value');
  });

  it('records the time even when the work throws, because failures are slow too', async () => {
    await expect(timed('explodes', async () => Promise.reject(new Error('no')))).rejects.toThrow('no');

    expect(measuredSpans().some((span) => span.name === 'explodes')).toBe(true);
  });
});

describe('measuredSpans', () => {
  it('answers slowest first, which is the only order that says what was slow', () => {
    record('quick', 5);
    record('slow', 500);
    record('middling', 50);

    expect(measuredSpans().map((span) => span.name)).toEqual(['slow', 'middling', 'quick']);
  });

  // A long session must not grow the list without bound: this is a diagnosis
  // aid, not the app surveilling itself.
  it('stops recording at the cap rather than growing forever', () => {
    for (let index = 0; index < 300; index += 1) record(`span ${index}`, index);

    expect(measuredSpans().length).toBeLessThanOrEqual(120);
  });
});

/**
 * The count is stored as a number and turned into words only for the rows that
 * are drawn. Recording it pre-formatted meant every store read paid for a
 * string — including the reads past the cap, whose string `record` then threw
 * away, which is work at exactly the point the cap exists to prevent work.
 */
describe('labelOf', () => {
  it('says the name alone when there is nothing to count', () => {
    record('freeze finished days', 12);

    expect(labelOf(measuredSpans()[0]!)).toBe('freeze finished days');
  });

  it('appends the count and its unit when there is', () => {
    record('fold', 340, 4_200, 'fixes');

    expect(labelOf(measuredSpans()[0]!)).toBe('fold (4200 fixes)');
  });

  it('keeps the count as a number on the span rather than in the name', () => {
    record('read fix buffer', 40, 118, 'kB');
    const [span] = measuredSpans();

    expect(span?.name).toBe('read fix buffer');
    expect(span?.amount).toBe(118);
    expect(span?.unit).toBe('kB');
  });

  // Zero is a count, not a missing one — "fold (0 fixes)" is the answer to why
  // a launch was fast, and it must not read as an unmeasured span.
  it('treats a count of zero as a count', () => {
    record('fold', 1, 0, 'fixes');

    expect(labelOf(measuredSpans()[0]!)).toBe('fold (0 fixes)');
  });
});
