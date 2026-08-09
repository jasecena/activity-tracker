import { useState, type ReactNode } from 'react';
import { Animated, PanResponder, StyleSheet, View } from 'react-native';

import { colors, radius, spacing } from '@/theme/tokens';

/** Past this, the drag is a swipe rather than a scroll that wandered. */
const COMMIT_X = 64;

/**
 * How much more horizontal than vertical a drag has to be before this claims
 * it.
 *
 * The timeline scrolls vertically, and a row that grabs anything with sideways
 * movement in it turns every flick down the day into a jitter. Requiring the
 * horizontal component to dominate is what lets the two live on the same pixel.
 */
const DOMINANCE = 1.6;

/**
 * Whether a drag is a deliberate sideways one, leftward.
 *
 * Exported and tested directly, for the same reason `SwipeBackPage`'s decisions
 * are: a `PanResponder` cannot be driven faithfully by synthetic events, so a
 * test that fires them through the renderer proves the plumbing and nothing
 * about the rule. The rule is the part that can be wrong.
 */
export function isLeftwardSwipe(dx: number, dy: number): boolean {
  return dx < 0 && Math.abs(dx) > Math.abs(dy) * DOMINANCE;
}

/** Far enough to mean it, once you let go. */
export function shouldCommit(dx: number): boolean {
  return -dx >= COMMIT_X;
}

interface SwipeToCorrectProps {
  readonly children: ReactNode;
  /** Fired once, when a leftward swipe is let go past the threshold. */
  readonly onSwipe: () => void;
  readonly accessibilityLabel: string;
}

/**
 * A row you can pull to the left to correct it.
 *
 * The row follows the finger and springs back; the swipe opens the picker
 * rather than revealing a button to tap. One gesture instead of two, and
 * nothing is left half-open on a timeline you then scroll away from — a
 * revealed action on a list is a small piece of state that has to be closed
 * again by everything else that happens.
 *
 * Only journeys get one. A stay has no activity type, so a stay that slid
 * sideways would be a gesture that leads nowhere.
 */
export function SwipeToCorrect({ children, onSwipe, accessibilityLabel }: SwipeToCorrectProps) {
  // Lazy state rather than a ref: this repo makes reading a ref during render
  // an error, and the responder below is built once from this value.
  const [offset] = useState(() => new Animated.Value(0));
  const [responder] = useState(() =>
    PanResponder.create({
      // Never on the start of a touch. Claiming a press before it has moved
      // takes the tap away from the row underneath, which opens the segment.
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_event, gesture) => isLeftwardSwipe(gesture.dx, gesture.dy),
      onPanResponderMove: (_event, gesture) => {
        // Leftward only, and never past twice the threshold: this is a hint
        // that something is behind the row, not a drawer being opened.
        offset.setValue(Math.max(-COMMIT_X * 2, Math.min(0, gesture.dx)));
      },
      onPanResponderRelease: (_event, gesture) => {
        const commit = shouldCommit(gesture.dx);
        Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
        if (commit) onSwipe();
      },
      onPanResponderTerminate: () => {
        Animated.spring(offset, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
      },
    }),
  );

  return (
    <View>
      {/* Behind the row and revealed by it moving, so there is something to
          have been pulling towards. */}
      <View style={styles.behind} pointerEvents="none">
        <View style={styles.hint} />
      </View>
      <Animated.View
        {...responder.panHandlers}
        accessibilityLabel={accessibilityLabel}
        style={{ transform: [{ translateX: offset }] }}
      >
        {children}
      </Animated.View>
    </View>
  );
}

const styles = StyleSheet.create({
  behind: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    alignItems: 'flex-end',
    justifyContent: 'center',
  },
  hint: { width: 4, height: 24, borderRadius: radius.pill, backgroundColor: colors.manual, marginRight: spacing.xs },
});
