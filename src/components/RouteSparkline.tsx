import { useMemo } from 'react';
import { View } from 'react-native';
import Svg, { Circle, Polyline } from 'react-native-svg';

import type { PathPoint } from '@/core/geo';
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
 * Not a map, on purpose. A map means tiles, tiles mean a network request per
 * route, and a network request carrying your coordinates to somebody else's
 * server is the one thing this app is built not to do. The shape alone is
 * enough to recognise a journey you took — the loop round the park, the dogleg
 * to the shops — which is what a timeline row actually needs.
 *
 * Latitude is flipped because SVG's y axis grows downward and north does not.
 * Longitude is scaled by cos(latitude) so the shape is not stretched sideways;
 * without it, a route at 55° comes out nearly twice as wide as it was.
 */
export function RouteSparkline({ path, color, width = 72, height = 28 }: RouteSparklineProps) {
  const points = useMemo(() => {
    if (path.length < 2) return null;

    const first = path[0];
    if (!first) return null;

    const lonScale = Math.cos((first.lat * Math.PI) / 180);
    const xs = path.map((point) => point.lon * lonScale);
    const ys = path.map((point) => point.lat);

    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);

    // A route can be a straight line, in which case one span is zero and the
    // scale would divide by it. Falling back to 1 centres it instead.
    const spanX = maxX - minX || 1;
    const spanY = maxY - minY || 1;
    const scale = Math.min((width - 4) / spanX, (height - 4) / spanY);

    const offsetX = (width - spanX * scale) / 2;
    const offsetY = (height - spanY * scale) / 2;

    return xs
      .map((x, index) => {
        const y = ys[index] ?? minY;
        const px = offsetX + (x - minX) * scale;
        // Flipped: SVG's y grows downward, north does not.
        const py = height - (offsetY + (y - minY) * scale);
        return `${px.toFixed(1)},${py.toFixed(1)}`;
      })
      .join(' ');
  }, [path, width, height]);

  if (!points) {
    return <View style={{ width, height }} />;
  }

  return (
    <Svg width={width} height={height} accessibilityRole="image" accessibilityLabel="Route shape">
      <Polyline points={points} fill="none" stroke={color} strokeWidth={2} strokeLinejoin="round" />
      <Circle
        cx={Number(points.split(' ')[0]?.split(',')[0] ?? 0)}
        cy={Number(points.split(' ')[0]?.split(',')[1] ?? 0)}
        r={2.5}
        fill={colors.textMuted}
      />
    </Svg>
  );
}
