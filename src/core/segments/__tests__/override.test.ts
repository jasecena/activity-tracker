import { overrideFor, saysSomething } from '../override';
import type { JourneyLabel } from '../manual';

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const SPAN = { startedAt: T0, endedAt: T0 + 600_000 };

const idFor = (startedAt: number) => `j-${startedAt}`;

function label(overrides: Partial<JourneyLabel> = {}): JourneyLabel {
  return { id: idFor(T0), label: '', mode: null, startedAt: T0, endedAt: T0 + 600_000, ...overrides };
}

describe('overrideFor', () => {
  it('writes a nameless label carrying only the mode', () => {
    const made = overrideFor(SPAN, 'cycle', undefined, idFor);

    expect(made).toEqual({ id: `j-${T0}`, label: '', mode: 'cycle', startedAt: SPAN.startedAt, endedAt: SPAN.endedAt });
  });

  it('derives the id from the start, so correcting twice replaces rather than stacks', () => {
    const first = overrideFor(SPAN, 'walk', undefined, idFor);
    const second = overrideFor(SPAN, 'run', first ?? undefined, idFor);

    expect(second?.id).toBe(first?.id);
    expect(second?.mode).toBe('run');
  });

  /**
   * Naming a journey and correcting its mode are two sentences about the same
   * stretch. Either one silently undoing the other is the bug this guards.
   */
  it('carries an existing name through untouched', () => {
    const named = label({ label: 'The commute', mode: 'drive' });

    expect(overrideFor(SPAN, 'cycle', named, idFor)).toEqual(
      expect.objectContaining({ label: 'The commute', mode: 'cycle' }),
    );
  });

  it('keeps the name when the correction is taken back', () => {
    const named = label({ label: 'The commute', mode: 'cycle' });

    expect(overrideFor(SPAN, null, named, idFor)).toEqual(
      expect.objectContaining({ label: 'The commute', mode: null }),
    );
  });

  /**
   * The whole point of reverting: nothing is left behind. A nameless, modeless
   * label is not a neutral record — it is exactly the shape a merge had, so it
   * would say nothing and be swept on the next launch anyway.
   */
  it('emits nothing at all when there is no name and no opinion left', () => {
    expect(overrideFor(SPAN, null, undefined, idFor)).toBeNull();
    expect(overrideFor(SPAN, null, label({ mode: 'run' }), idFor)).toBeNull();
  });

  it('covers exactly the span it was given', () => {
    const made = overrideFor({ startedAt: 10_000, endedAt: 20_000 }, 'walk', undefined, idFor);

    expect(made?.startedAt).toBe(10_000);
    expect(made?.endedAt).toBe(20_000);
  });
});

describe('saysSomething', () => {
  it('keeps a name', () => {
    expect(saysSomething(label({ label: 'The commute' }))).toBe(true);
  });

  /**
   * The rule this widened. A correction is nameless by design, and the old
   * test — name only — would have deleted every one of them on the next
   * launch, silently, while the app looked like it had saved them.
   */
  it('keeps a correction that has no name', () => {
    expect(saysSomething(label({ mode: 'cycle' }))).toBe(true);
  });

  // A merge was nameless and modeless. Those still go, which is the reason the
  // sweep exists at all.
  it('drops what an old merge left behind', () => {
    expect(saysSomething(label())).toBe(false);
  });
});
