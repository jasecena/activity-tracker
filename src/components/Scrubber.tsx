import { useMemo, useState } from 'react';
import { PanResponder, StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme/tokens';

interface ScrubberProps {
  readonly from: number;
  readonly to: number;
  readonly value: number;
  /** Stretches the app knows nothing about, drawn as breaks in the track. */
  readonly holes?: readonly { readonly from: number; readonly to: number }[];
  readonly onChange: (value: number) => void;
  /** Announced as the current position, since a screen reader cannot see the handle. */
  readonly label: string;
}

/**
 * Drag along a day.
 *
 * A `PanResponder` over a bar rather than a slider dependency, for the same
 * reason this app has no navigation library: it is thirty lines against a
 * package, and the thirty lines do the one thing needed.
 *
 * The track width comes from `onLayout` into state — `react-hooks/refs` is an
 * error here, and a value the render depends on belongs in `useState`.
 *
 * Holes are drawn rather than skipped. You can scrub into one, and the player
 * will say it has nothing; hiding them would make a day look continuous when
 * it is not, which is the one thing the timeline refuses to do elsewhere.
 */
export function Scrubber({ from, to, value, holes = [], onChange, label }: ScrubberProps) {
  const [width, setWidth] = useState(0);

  const span = Math.max(1, to - from);
  const fraction = Math.min(1, Math.max(0, (value - from) / span));

  const responder = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: () => true,
        onPanResponderGrant: (event) => {
          if (width > 0) onChange(from + (event.nativeEvent.locationX / width) * span);
        },
        onPanResponderMove: (event, gesture) => {
          if (width === 0) return;
          // `moveX` is in window coordinates and `locationX` is relative to the
          // track, so the offset between them is fixed once the gesture starts.
          const x = Math.min(width, Math.max(0, gesture.moveX - (gesture.x0 - event.nativeEvent.locationX)));
          onChange(from + (x / width) * span);
        },
      }),
    [from, span, width, onChange],
  );

  return (
    <View
      style={styles.hitArea}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityRole="adjustable"
      accessibilityLabel={label}
      {...responder.panHandlers}
    >
      <View style={styles.track}>
        <View style={[styles.filled, { width: `${fraction * 100}%` }]} />
        {holes.map((hole) => (
          <View
            key={`${hole.from}-${hole.to}`}
            style={[
              styles.hole,
              {
                left: `${(Math.max(0, hole.from - from) / span) * 100}%`,
                width: `${(Math.max(0, hole.to - hole.from) / span) * 100}%`,
              },
            ]}
          />
        ))}
      </View>
      <View style={[styles.handle, { left: Math.max(0, fraction * width - 9) }]} />
    </View>
  );
}

const styles = StyleSheet.create({
  // Taller than the track it draws: a 4-point bar is not something anyone can
  // reliably put a thumb on.
  hitArea: { height: 36, justifyContent: 'center' },
  track: { height: 4, borderRadius: radius.pill, backgroundColor: colors.border, overflow: 'hidden' },
  filled: { position: 'absolute', left: 0, top: 0, bottom: 0, backgroundColor: colors.move },
  hole: { position: 'absolute', top: 0, bottom: 0, backgroundColor: colors.background },
  handle: {
    position: 'absolute',
    width: 18,
    height: 18,
    borderRadius: radius.pill,
    backgroundColor: colors.move,
    borderWidth: 2,
    borderColor: colors.background,
  },
});
