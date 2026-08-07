import { useMemo, useState, type ReactNode } from 'react';
import { Animated, Dimensions, PanResponder, StyleSheet } from 'react-native';

import { colors } from '@/theme/tokens';

interface SwipeBackPageProps {
  readonly children: ReactNode;
  readonly onBack: () => void;
}

/**
 * How far in from the left edge a drag has to start.
 *
 * Edge-initiated, exactly as iOS does it, and the reason is not fashion: a page
 * here contains horizontal scrollers — the mode chips, the speed buttons, the
 * route table — and a gesture that could begin anywhere would fight all of
 * them. Starting at the edge means the two can never both claim a touch.
 */
const EDGE_WIDTH = 28;

/** Past this, letting go goes back. Below it, the page springs home. */
const COMMIT_FRACTION = 0.35;

/** Enough horizontal intent to be a swipe rather than a scroll that wandered. */
const DIRECTION_RATIO = 1.5;

/** A flick this fast means "go back" without dragging the whole screen. */
const FLICK_VELOCITY = 0.5;

/**
 * Did this drag begin in the edge strip?
 *
 * `pageX` is where the finger is now, so subtracting the distance travelled
 * gives where it started. Exported because it is the whole gesture's
 * gatekeeper, and a `PanResponder` does not survive being driven by synthetic
 * events in a test renderer — the decision is testable even where the plumbing
 * is not.
 */
export function beganAtEdge(pageX: number, dx: number): boolean {
  return pageX - dx <= EDGE_WIDTH;
}

/** Far enough, or fast enough, that letting go should go back. */
export function shouldGoBack(dx: number, vx: number, width: number): boolean {
  return dx > width * COMMIT_FRACTION || vx > FLICK_VELOCITY;
}

/**
 * A detail page you can swipe away.
 *
 * The app has no navigation library — `usePageStack` is an array and three
 * functions — so the back gesture every iOS user expects has to be built rather
 * than inherited. It is thirty lines of `PanResponder` and one `Animated.Value`,
 * against a router brought in for one gesture.
 *
 * The page tracks the finger rather than animating on release, because a
 * transition that only begins once you let go feels like a button that was slow
 * to respond, not a page you dragged.
 *
 * `useNativeDriver` throughout: the drag runs on the UI thread, so a page whose
 * JS is busy re-deriving a timeline still slides at sixty frames a second. That
 * matters here more than in most apps — opening a day is exactly when the fold
 * is running.
 */
export function SwipeBackPage({ children, onBack }: SwipeBackPageProps) {
  const width = Dimensions.get('window').width;

  // Lazy state rather than the usual `useRef(new Animated.Value(0)).current`.
  // This repo makes `react-hooks/refs` an error, and building the responder
  // below means reading the value during render — which is exactly what the
  // rule forbids. A state initialiser gives the same single, stable instance
  // without a ref to read.
  const [translateX] = useState(() => new Animated.Value(0));

  const responder = useMemo(
    () =>
      PanResponder.create({
        // Never on touch-down: claiming the touch immediately would swallow a
        // tap on anything within the edge strip.
        onStartShouldSetPanResponder: () => false,
        onMoveShouldSetPanResponder: (event, gesture) =>
          beganAtEdge(event.nativeEvent.pageX, gesture.dx) &&
          gesture.dx > 8 &&
          gesture.dx > Math.abs(gesture.dy) * DIRECTION_RATIO,

        onPanResponderMove: (_event, gesture) => {
          // Rightward only. Dragging back past the origin would peel the page
          // off the wrong edge and reveal nothing behind it.
          translateX.setValue(Math.max(0, gesture.dx));
        },

        onPanResponderRelease: (_event, gesture) => {
          if (shouldGoBack(gesture.dx, gesture.vx, width)) {
            Animated.timing(translateX, {
              toValue: width,
              duration: 180,
              useNativeDriver: true,
            }).start(() => {
              // Reset before popping. The page component is reused for whatever
              // is underneath, and leaving it translated off-screen would show
              // the next page already gone.
              translateX.setValue(0);
              onBack();
            });
            return;
          }

          Animated.spring(translateX, {
            toValue: 0,
            useNativeDriver: true,
            bounciness: 0,
            speed: 14,
          }).start();
        },

        // A gesture interrupted by the system leaves the page where it was, so
        // it has to be put back or the screen keeps a permanent offset.
        onPanResponderTerminate: () => {
          Animated.spring(translateX, { toValue: 0, useNativeDriver: true, bounciness: 0, speed: 14 }).start();
        },
      }),
    [onBack, translateX, width],
  );

  return (
    // Deliberately *not* given an accessibilityLabel. iOS collapses a labelled
    // element, and its children stop existing for VoiceOver and for the smoke
    // test — which is precisely how the v0.1.0 release failed.
    <Animated.View style={[styles.page, { transform: [{ translateX }] }]} {...responder.panHandlers}>
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  page: {
    position: 'absolute',
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    backgroundColor: colors.background,
  },
});
