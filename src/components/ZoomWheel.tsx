import Svg, { G, Line, Path, Polygon, Text as SvgText } from 'react-native-svg';
import { StyleSheet, View, useWindowDimensions } from 'react-native';

import { dialPositionOf, formatDisplayFactor, mmAt, type DialSpec } from '@/core/media';
import { colors } from '@/theme/tokens';

/**
 * The zoom, as the wheel the built-in camera shows.
 *
 * A large circle whose hub sits below the screen, so what is visible is the
 * top of its rim rising over the shutter. The wheel turns under a fixed marker
 * as the finger drags, ticks ride the rim, and each real lens is a labelled
 * stop — `0.5 13MM`, `1 24MM` — with the current value printed large at the
 * marker.
 *
 * Every number on it is a fact from AVFoundation, arrived at in
 * `core/media/optics.ts`: the stops sit where the lenses actually take over
 * and the millimetres are derived from each lens's measured field of view.
 * That is the whole reason the native module exists — a dial that printed
 * guesses would be worse than the percentage it replaced.
 *
 * Drawing only: the gesture lives in the capture screen, which owns the zoom.
 */

/** Angular length of the whole dial range, degrees of arc. */
const SWEEP_DEG = 150;
/** Minor ticks across the range — dense enough to read as a machined wheel. */
const TICKS = 72;

interface ZoomWheelProps {
  readonly spec: DialSpec;
  /** Current display-space factor — the number a person means by "2×". */
  readonly display: number;
  /** True while a finger is on it; faded out otherwise. */
  readonly active: boolean;
}

export function ZoomWheel({ spec, display, active }: ZoomWheelProps) {
  const { width } = useWindowDimensions();

  // The rim's radius: comfortably wider than the screen, so the visible arc is
  // shallow like a wheel seen edge-on rather than a lollipop.
  const radius = width * 0.78;
  /**
   * Tall enough for the arc to dip to the screen edges, the way the built-in
   * camera's does. The first build sized this from a fraction of the radius
   * that put the rim's crown below the canvas — reported from a phone as a
   * wheel of which "a very small part is visible". The height is derived from
   * the same angles the drawing uses, so the two cannot disagree again: the
   * crown sits at CROWN_Y and the ±72° endpoints define the bottom.
   */
  const CROWN_Y = 28;
  const height = CROWN_Y + radius * (1 - Math.cos((72 * Math.PI) / 180)) + 24;
  const hubX = width / 2;
  // The hub is below the canvas; the crown of the rim sits CROWN_Y from its top.
  const hubY = CROWN_Y + radius;

  /** Angle of a display factor, given the wheel's current rotation. */
  const angleOf = (factor: number) => -90 + (dialPositionOf(spec, factor) - dialPositionOf(spec, display)) * SWEEP_DEG;

  const pointAt = (degrees: number, distance: number) => {
    const radians = (degrees * Math.PI) / 180;
    return { x: hubX + Math.cos(radians) * distance, y: hubY + Math.sin(radians) * distance };
  };

  /** Whether an angle is on the visible part of the rim. */
  const visible = (degrees: number) => degrees > -90 - 70 && degrees < -90 + 70;

  const rim = () => {
    const from = pointAt(-90 - 72, radius);
    const to = pointAt(-90 + 72, radius);
    return `M ${from.x} ${from.y} A ${radius} ${radius} 0 0 1 ${to.x} ${to.y}`;
  };

  const ticks = Array.from({ length: TICKS + 1 }, (_, index) => {
    const factor = spec.minDisplay * Math.exp((index / TICKS) * Math.log(spec.maxDisplay / spec.minDisplay));
    return { factor, angle: angleOf(factor) };
  }).filter((tick) => visible(tick.angle));

  const stops = spec.stops
    .map((stop) => ({ ...stop, angle: angleOf(stop.display) }))
    .filter((stop) => visible(stop.angle));

  const marker = pointAt(-90, radius + 10);

  return (
    <View
      style={[styles.wheel, { height: height + 12 }, !active && styles.faded]}
      pointerEvents="none"
      accessibilityElementsHidden
      importantForAccessibility="no-hide-descendants"
    >
      <Svg width={width} height={height + 12} style={styles.backdrop}>
        {/* The rim's backing disc: just the sliver above the screen edge. */}
        <Path d={`${rim()} L ${hubX} ${hubY} Z`} fill="rgba(11,15,20,0.62)" />
        <Path d={rim()} stroke={colors.border} strokeWidth={1} fill="none" />

        {ticks.map((tick) => {
          const outer = pointAt(tick.angle, radius - 4);
          const inner = pointAt(tick.angle, radius - 14);
          return (
            <Line
              key={tick.factor}
              x1={inner.x}
              y1={inner.y}
              x2={outer.x}
              y2={outer.y}
              stroke={colors.textMuted}
              strokeWidth={1}
            />
          );
        })}

        {stops.map((stop) => {
          const outer = pointAt(stop.angle, radius - 2);
          const inner = pointAt(stop.angle, radius - 20);
          const label = pointAt(stop.angle, radius - 36);
          const mm = pointAt(stop.angle, radius - 54);
          const upright = stop.angle + 90;
          const near = Math.abs(stop.angle + 90) < SWEEP_DEG / (TICKS / 2);
          return (
            <G key={stop.display}>
              <Line
                x1={inner.x}
                y1={inner.y}
                x2={outer.x}
                y2={outer.y}
                stroke={near ? colors.manual : colors.textPrimary}
                strokeWidth={2}
              />
              {/* Rotated to lie along the rim, the way a lens barrel prints
                  them. The active stop keeps out of the way of the big
                  readout at the marker. */}
              {near ? null : (
                <G>
                  <SvgText
                    x={label.x}
                    y={label.y}
                    fill={colors.textPrimary}
                    fontSize={15}
                    fontWeight="600"
                    textAnchor="middle"
                    transform={`rotate(${upright} ${label.x} ${label.y})`}
                  >
                    {formatDisplayFactor(stop.display)}
                  </SvgText>
                  <SvgText
                    x={mm.x}
                    y={mm.y}
                    fill={colors.textMuted}
                    fontSize={9}
                    textAnchor="middle"
                    transform={`rotate(${upright} ${mm.x} ${mm.y})`}
                  >
                    {`${stop.mm}MM`}
                  </SvgText>
                </G>
              )}
            </G>
          );
        })}

        {/* The fixed marker the wheel turns under. */}
        <Polygon
          points={`${marker.x - 5},${marker.y - 10} ${marker.x + 5},${marker.y - 10} ${marker.x},${marker.y}`}
          fill={colors.manual}
        />

        {/* What you are at, in the built-in camera's own words: "2x 48MM". */}
        <SvgText
          x={hubX}
          y={hubY - radius + 42}
          fill={colors.manual}
          fontSize={19}
          fontWeight="700"
          textAnchor="middle"
        >
          {`${formatDisplayFactor(display)}x`}
        </SvgText>
        <SvgText x={hubX} y={hubY - radius + 58} fill={colors.manual} fontSize={10} textAnchor="middle">
          {`${mmAt(spec, display)}MM`}
        </SvgText>
      </Svg>
    </View>
  );
}

const styles = StyleSheet.create({
  wheel: {
    position: 'absolute',
    left: 0,
    right: 0,
    // Above the shutter row, which is what the wheel wraps around.
    bottom: 96,
  },
  backdrop: { position: 'absolute', bottom: 0 },
  faded: { opacity: 0 },
});
