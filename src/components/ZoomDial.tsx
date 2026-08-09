import Svg, { Circle, Line, Path, Text as SvgText } from 'react-native-svg';
import { StyleSheet, View } from 'react-native';

import { colors, radius } from '@/theme/tokens';

const SIZE = 148;
const RADIUS = 62;
const CENTRE = SIZE / 2;

/** How many degrees of arc the whole range occupies. Half a circle, opening left. */
const SWEEP = 180;
const START_ANGLE = -90;

const TICKS = 21;

/** Where a fraction of the range sits on the arc, in screen coordinates. */
function pointAt(fraction: number, distance: number): { readonly x: number; readonly y: number } {
  const degrees = START_ANGLE + fraction * SWEEP;
  const radians = (degrees * Math.PI) / 180;
  return { x: CENTRE + Math.cos(radians) * distance, y: CENTRE + Math.sin(radians) * distance };
}

function arc(from: number, to: number, distance: number): string {
  const start = pointAt(from, distance);
  const end = pointAt(to, distance);
  const large = (to - from) * SWEEP > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${distance} ${distance} 0 ${large} 1 ${end.x} ${end.y}`;
}

interface ZoomDialProps {
  /** 0 to 1 across whatever range the lens offers. */
  readonly zoom: number;
  /** False once the finger lifts, which fades it out rather than leaving it over the picture. */
  readonly active: boolean;
}

/**
 * The zoom, as a lens collar.
 *
 * A dial rather than a bar because that is what the gesture *is*: a hand
 * turning something. The ticks give the movement somewhere to land, and the
 * number in the middle is the only honest label available — `CameraView`'s zoom
 * is a fraction of whatever range the lens has, not a magnification, and there
 * is no way to ask what "2×" would be on this device. Printing 2× would be
 * printing a guess as a fact.
 *
 * It appears while you are turning it and goes when you let go. A camera
 * sitting at the wide end is a camera, and saying so permanently is furniture
 * over the picture.
 */
export function ZoomDial({ zoom, active }: ZoomDialProps) {
  const knob = pointAt(zoom, RADIUS);

  return (
    <View
      style={[styles.dial, !active && styles.inactive]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={SIZE} height={SIZE}>
        {/* The whole range, dim, so there is something to be part-way along. */}
        <Path d={arc(0, 1, RADIUS)} stroke={colors.border} strokeWidth={3} fill="none" strokeLinecap="round" />
        {/* How far along it you are. */}
        {zoom > 0 ? (
          <Path d={arc(0, zoom, RADIUS)} stroke={colors.move} strokeWidth={3} fill="none" strokeLinecap="round" />
        ) : null}

        {Array.from({ length: TICKS }, (_, index) => {
          const fraction = index / (TICKS - 1);
          // Longer every fifth, like a lens barrel: something to count by
          // without printing twenty numbers over the viewfinder.
          const major = index % 5 === 0;
          const inner = pointAt(fraction, RADIUS - (major ? 11 : 6));
          const outer = pointAt(fraction, RADIUS - 1);
          return (
            <Line
              key={fraction}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke={fraction <= zoom ? colors.move : colors.textMuted}
              strokeWidth={major ? 2 : 1}
            />
          );
        })}

        <Circle cx={knob.x} cy={knob.y} r={7} fill={colors.textPrimary} />

        <SvgText x={CENTRE} y={CENTRE + 6} fill={colors.textPrimary} fontSize={20} fontWeight="600" textAnchor="middle">
          {`${Math.round(zoom * 100)}%`}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  dial: {
    position: 'absolute',
    alignSelf: 'center',
    top: '50%',
    marginTop: -SIZE / 2,
    width: SIZE,
    height: SIZE,
    borderRadius: radius.pill,
    // Its own backing: an outline over a live image disappears against a bright
    // sky, which is exactly where anyone reaches for the zoom.
    backgroundColor: 'rgba(11,15,20,0.55)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  inactive: { opacity: 0 },
});
