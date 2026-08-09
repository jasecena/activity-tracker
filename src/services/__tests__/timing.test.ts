import { measuredSpans, record, timed, __resetTimings } from '../timing';

jest.mock('../clock', () => {
  let at = 1_000;
  return {
    now: jest.fn(() => (at += 25)),
    __advance: (ms: number) => {
      at += ms;
    },
  };
});

beforeEach(() => {
  __resetTimings();
});

describe('timed', () => {
  it('measures the work under its name and returns its result', async () => {
    const result = await timed('read something', async () => 'the value');

    expect(result).toBe('the value');
    expect(measuredSpans()[0]?.name).toBe('read something');
    expect(measuredSpans()[0]?.ms).toBeGreaterThan(0);
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
