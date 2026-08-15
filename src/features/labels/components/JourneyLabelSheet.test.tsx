import { fireEvent, render, screen } from '@testing-library/react-native';

import type { MoveSegment } from '@/core/segments';

import { expectSheetIsBoundedAndScrolls } from '@/__tests__/sheetLayout';

import { JourneyLabelSheet } from './JourneyLabelSheet';

/**
 * Naming a journey, after it happened — the counterpart to `PlacePicker` and
 * the third sheet in the app with a text field in it.
 *
 * It had the same defect as the other two and for the same reason: a sheet
 * anchored to the bottom of the screen with nothing between it and the
 * keyboard. Here it was worse than it looked, because the field sits near the
 * top with the mode chips, Save and a footnote under it — so the keyboard both
 * covered the field and pushed everything below it off the screen.
 */

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);

function journey(): MoveSegment {
  return {
    id: `seg-${T0}`,
    kind: 'move',
    startedAt: T0,
    endedAt: T0 + 1_800_000,
    distanceM: 4200,
    mode: 'walk',
    modeIsManual: false,
    label: '',
    path: [],
    topSpeedMps: 1.6,
    fixCount: 40,
  };
}

function sheet(overrides: Partial<React.ComponentProps<typeof JourneyLabelSheet>> = {}) {
  return (
    <JourneyLabelSheet journey={journey()} tzOffsetMinutes={0} onSave={jest.fn()} onClose={jest.fn()} {...overrides} />
  );
}

it('saves the name that was typed', async () => {
  const onSave = jest.fn();
  await render(sheet({ onSave }));

  await fireEvent.changeText(screen.getByLabelText('Journey name'), 'School run');
  await fireEvent.press(screen.getByLabelText('Save this name'));

  expect(onSave).toHaveBeenCalledWith('School run', 'walk');
});

/**
 * Everything scrolls together here, unlike `PlacePicker`: this sheet is a form
 * read top to bottom rather than a list with a field pinned under it, so the
 * field scrolling with the rest is what you want.
 */
it('scrolls inside a bounded container rather than growing past the screen', async () => {
  // With a name typed, so nothing is disabled and the footnote is showing —
  // the tallest this sheet gets.
  await render(sheet({ onForget: jest.fn() }));

  expectSheetIsBoundedAndScrolls(screen.toJSON(), ['Journey name', 'Save this name', 'Remove this name']);
});
