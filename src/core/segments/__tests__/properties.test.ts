import fc from 'fast-check';

import type { Fix } from '../../geo';
import { summarizeDay } from '../../day';
import { formatDistance, formatDuration, formatPace, formatSpeed } from '../../format';
import {
  applyJourneyLabels,
  DEFAULT_SEGMENT_CONFIG,
  segmentFixes,
  splitSegment,
  type JourneyLabel,
  type Segment,
} from '../index';

import { fix, T0 } from './fixtures';

/**
 * Invariants, over fix streams nobody thought to write down.
 *
 * The example-based tests say what the engine does for the days its author
 * imagined. These say what must hold for every day, including the ones an
 * iPhone produces at 3 a.m. in a lift: fixes a millisecond apart, jumps across
 * a continent, hours of silence, a stream that is nothing but noise.
 */

const CONFIG = DEFAULT_SEGMENT_CONFIG;

/** A step in a synthetic journey: wait `dtSeconds`, end up `dNorthM` further north. */
const step = fc.record({
  dtSeconds: fc.integer({ min: 1, max: 900 }),
  dNorthM: fc.integer({ min: -300, max: 300 }),
});

const fixStream = fc.array(step, { minLength: 1, maxLength: 80 }).map((steps) => {
  let at = T0;
  let northM = 0;
  const fixes: Fix[] = [fix(at, northM)];
  for (const { dtSeconds, dNorthM } of steps) {
    at += dtSeconds * 1000;
    northM += dNorthM;
    fixes.push(fix(at, northM));
  }
  return fixes;
});

function totalMoveDistance(segments: readonly Segment[]): number {
  return segments.reduce((sum, segment) => sum + (segment.kind === 'move' ? segment.distanceM : 0), 0);
}

describe('the timeline, for any stream of fixes', () => {
  it('is ordered and never overlaps itself', () => {
    fc.assert(
      fc.property(fixStream, (fixes) => {
        const { segments } = segmentFixes(fixes, CONFIG);
        for (let i = 1; i < segments.length; i += 1) {
          const previous = segments[i - 1];
          const current = segments[i];
          if (!previous || !current) return false;
          // Equal, not merely ordered, everywhere except across a gap — where
          // the timeline is allowed a hole because nothing was recorded.
          if (previous.endedAt > current.startedAt) return false;
          if (current.startedAt > current.endedAt) return false;
        }
        return true;
      }),
    );
  });

  it('gives every segment a distinct id', () => {
    fc.assert(
      fc.property(fixStream, (fixes) => {
        const { segments } = segmentFixes(fixes, CONFIG);
        return new Set(segments.map((segment) => segment.id)).size === segments.length;
      }),
    );
  });

  it('reports distances that are real numbers and never negative', () => {
    fc.assert(
      fc.property(fixStream, (fixes) => {
        const { segments } = segmentFixes(fixes, CONFIG);
        return segments.every(
          (segment) =>
            segment.kind === 'stay' ||
            (Number.isFinite(segment.distanceM) && segment.distanceM >= 0 && Number.isFinite(segment.topSpeedMps)),
        );
      }),
    );
  });

  it('keeps every route point inside the segment that owns it', () => {
    fc.assert(
      fc.property(fixStream, (fixes) => {
        const { segments } = segmentFixes(fixes, CONFIG);
        return segments.every(
          (segment) =>
            segment.kind === 'stay' ||
            segment.path.every((point) => point.at >= segment.startedAt && point.at <= segment.endedAt),
        );
      }),
    );
  });

  // The property the whole persistence design leans on. If this ever fails, the
  // app cannot rebuild the day from the fix buffer, and every recovery path in
  // `useActivities` is unsound.
  it('is the same timeline every time it is computed', () => {
    fc.assert(
      fc.property(fixStream, (fixes) => {
        expect(segmentFixes(fixes, CONFIG)).toEqual(segmentFixes(fixes, CONFIG));
      }),
    );
  });

  it('accounts for no more time than it observed', () => {
    fc.assert(
      fc.property(fixStream, (fixes) => {
        const { segments } = segmentFixes(fixes, CONFIG);
        const summary = summarizeDay(segments);
        return summary.movingMs + summary.stillMs <= summary.spanMs + 1;
      }),
    );
  });
});

describe('cutting the timeline', () => {
  // Labelling part of a walk must never change how far you went. A day's total
  // that drifts every time you touch it is the kind of bug nobody reports and
  // everybody stops trusting the app over.
  it('never changes the total distance', () => {
    fc.assert(
      fc.property(fixStream, fc.integer({ min: 0, max: 3_600_000 }), (fixes, offsetMs) => {
        const { segments } = segmentFixes(fixes, CONFIG);
        const cut = segments.flatMap((segment) => splitSegment(segment, T0 + offsetMs));
        expect(totalMoveDistance(cut)).toBeCloseTo(totalMoveDistance(segments), 6);
      }),
    );
  });

  it('never changes the span of the day', () => {
    fc.assert(
      fc.property(fixStream, fc.integer({ min: 0, max: 3_600_000 }), (fixes, offsetMs) => {
        const { segments } = segmentFixes(fixes, CONFIG);
        if (segments.length === 0) return true;
        const cut = segments.flatMap((segment) => splitSegment(segment, T0 + offsetMs));
        const first = segments[0];
        const last = segments[segments.length - 1];
        const cutFirst = cut[0];
        const cutLast = cut[cut.length - 1];
        return cutFirst?.startedAt === first?.startedAt && cutLast?.endedAt === last?.endedAt;
      }),
    );
  });
});

describe('manual recordings', () => {
  const windowArb = fc
    .record({
      startOffset: fc.integer({ min: 0, max: 3_600_000 }),
      lengthMs: fc.integer({ min: 1, max: 3_600_000 }),
      mode: fc.constantFrom('walk' as const, 'run' as const, 'cycle' as const, 'drive' as const),
    })
    .map(({ startOffset, lengthMs, mode }): JourneyLabel => ({
      id: 'w',
      label: 'Recorded',
      mode,
      startedAt: T0 + startOffset,
      endedAt: T0 + startOffset + lengthMs,
    }));

  it('never changes the total distance of the day', () => {
    fc.assert(
      fc.property(fixStream, windowArb, (fixes, window) => {
        const { segments } = segmentFixes(fixes, CONFIG);
        const labelled = applyJourneyLabels(segments, [window]);
        expect(totalMoveDistance(labelled)).toBeCloseTo(totalMoveDistance(segments), 6);
      }),
    );
  });

  it('leaves the result ordered', () => {
    fc.assert(
      fc.property(fixStream, windowArb, (fixes, window) => {
        const { segments } = segmentFixes(fixes, CONFIG);
        const labelled = applyJourneyLabels(segments, [window]);
        for (let i = 1; i < labelled.length; i += 1) {
          if ((labelled[i - 1]?.startedAt ?? 0) > (labelled[i]?.startedAt ?? 0)) return false;
        }
        return true;
      }),
    );
  });
});

describe('the formatters', () => {
  // They render whatever the engine produces, including the values a bad day
  // produces. A crash in a label is a crash in the timeline.
  it('always return something printable, for any number at all', () => {
    fc.assert(
      fc.property(fc.double({ noDefaultInfinity: false, noNaN: false }), (value) => {
        for (const rendered of [formatDistance(value), formatDuration(value), formatSpeed(value), formatPace(value)]) {
          if (typeof rendered !== 'string' || rendered.length === 0) return false;
        }
        return true;
      }),
    );
  });
});
