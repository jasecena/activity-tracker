import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import { boundsOf, projectToBox, type PathPoint } from '@/core/geo';
import { colors } from '@/theme/tokens';

interface RouteSparklineProps {
  readonly path: readonly PathPoint[];
  readonly color: string;
  readonly width?: number;
  readonly height?: number;
}

/**
 * The shape of a route, in the space of a row.
 *
 * Deliberately not a map, even now that the app has one. A timeline row does
 * not need streets — it needs "which journey was this", and the shape alone
 * answers that: the loop round the park, the dogleg to the shops. It also costs
 * nothing and asks nobody, which the map cannot say.
 *
 * The projection itself lives in `core/geo/project.ts`, shared with the offline
 * map canvas, so the two cannot disagree about which way is north or how much a
 * degree of longitude is worth at this latitude.
 */
export function RouteSparkline({ path, color, width = 72, height = 28 }: RouteSparklineProps) {
  const points = useMemo(() => {
    if (path.length < 2) return null;

    const bounds = boundsOf(path);
    if (!bounds) return null;

    return projectToBox(path, bounds, { width, height, padding: 2 });
  }, [path, width, height]);

  if (!points) {
    return <View style={{ width, height }} />;
  }

  const start = points[0];

  return (
    <Svg width={width} height={height} accessibilityRole="image" accessibilityLabel="Route shape">
      <Polyline
        points={points.map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`).join(' ')}
        fill="none"
        stroke={color}
        strokeWidth={2}
        strokeLinejoin="round"
      />
      {start ? <Circle cx={start.x} cy={start.y} r={2.5} fill={colors.textMuted} /> : null}
    </Svg>
  );
}
