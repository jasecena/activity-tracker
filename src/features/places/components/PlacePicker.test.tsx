import { fireEvent, render, screen } from '@testing-library/react-native';
import { StyleSheet, type ViewStyle } from 'react-native';

import { placeFromStay } from '@/core/places';
import type { StaySegment } from '@/core/segments';

import { labelsUnder, pathTo } from '@/__tests__/sheetLayout';

import { PlacePicker } from './PlacePicker';

/**
 * Naming a place: the one sheet in the app whose entire reason for opening is a
 * text field.
 *
 * Which is why the layout matters more here than anywhere. This shipped with no
 * keyboard avoidance at all — the sheet sat at the bottom of the screen with
 * nothing between it and the keyboard — so naming a place meant typing a name
 * you could not read. Reported from a phone, and the worst possible place for
 * it to happen.
 */

const T0 = Date.UTC(2026, 0, 5, 8, 0, 0);
const HOUR = 3_600_000;

/**
 * At the equator, like every fixture here. A coordinate from a real track is a
 * permanent record of where its author was, and gitleaks scans for them.
 */
function stay(): StaySegment {
  return {
    id: `seg-${T0}`,
    kind: 'stay',
    startedAt: T0,
    endedAt: T0 + HOUR,
    center: { lat: 0, lon: 0 },
    radiusM: 12,
    purpose: null,
    fixCount: 40,
  };
}

function picker(overrides: Partial<React.ComponentProps<typeof PlacePicker>> = {}) {
  return (
    <PlacePicker
      stay={stay()}
      places={[]}
      visits={[]}
      tzOffsetMinutes={0}
      onPickExisting={jest.fn()}
      onCreate={jest.fn()}
      onClose={jest.fn()}
      {...overrides}
    />
  );
}

it('names a place from what was typed', async () => {
  const onCreate = jest.fn();
  await render(picker({ onCreate }));

  await fireEvent.changeText(screen.getByLabelText('Place name'), 'The market');
  await fireEvent.press(screen.getByLabelText('Save place'));

  expect(onCreate).toHaveBeenCalledWith('The market');
});

/**
 * **The field must survive the keyboard, and the candidate list must not push it
 * out.**
 *
 * Two failures that arrive together. Without the `KeyboardAvoidingView` the
 * whole sheet stays behind the keyboard; with one but without `flexShrink` on
 * the candidate list, the sheet rides up correctly and the list — which will not
 * give up its height — pushes the name box out through the bottom of it instead.
 * A fix for only one of them looks like a fix for both until somebody has a
 * dozen named places nearby.
 *
 * **This sheet is deliberately not shaped like `NoteSheet`.** There, everything
 * scrolls together. Here only the candidates do, and the label, the field and
 * Save stay pinned beneath them — which is the whole point: the thing you are
 * typing into must not be able to scroll away from under your thumb. So the
 * assertion is the inverse containment, and it is exactly what would have caught
 * the bug: the field is *outside* the scroller, and something above is capped.
 */
it('pins the name field outside the scrolling list, inside a bounded sheet', async () => {
  // Enough nearby places that the list would fill the sheet on its own, which is
  // the case where the field gets pushed out.
  const nearby = Array.from({ length: 12 }, (_, index) =>
    placeFromStay({ ...stay(), center: { lat: index * 0.0001, lon: 0 } }, `Place ${index}`),
  );
  await render(picker({ places: nearby }));

  const path = pathTo(screen.toJSON(), 'RCTScrollView');
  expect(path).not.toBeNull();

  // The candidates scroll...
  const list = path![path!.length - 1]!;
  expect(labelsUnder(list).some((label) => label.startsWith('This is Place'))).toBe(true);

  // ...and the field does not go with them.
  const pinned = labelsUnder(list);
  expect(pinned).not.toContain('Place name');
  expect(pinned).not.toContain('Save place');

  // Both still rendered, and the sheet above the list refuses to outgrow the
  // room the keyboard leaves it.
  expect(screen.getByLabelText('Place name')).toBeTruthy();
  expect(screen.getByLabelText('Save place')).toBeTruthy();
  const capped = path!
    .slice(0, -1)
    .some((node) => StyleSheet.flatten(node.props?.style as ViewStyle)?.maxHeight !== undefined);
  expect(capped).toBe(true);
});
