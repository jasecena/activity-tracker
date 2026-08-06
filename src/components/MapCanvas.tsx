import { AppleMaps } from 'expo-maps';
import { useMemo, useState } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import Svg, { Circle, G, Line, Polyline, Text as SvgText } from 'react-native-svg';

import {
  boundsOf,
  centerOf,
  niceScaleMetres,
  padBounds,
  projectToBox,
  spanMetresOf,
  unionBounds,
  zoomForBounds,
  type Bounds,
  type LatLon,
} from '@/core/geo';
import { formatDistance } from '@/core/format';
import { colors, radius, spacing, typography } from '@/theme/tokens';

/**
 * Every map in the app, and the only file that knows Apple Maps exists.
 *
 * Two backends behind one prop shape, chosen by `mapsEnabled`:
 *
 * - **on** — `AppleMaps.View`, with the route as an overlay. This is the one
 *   thing in the app that makes a network request, which is why it is a setting
 *   that starts off rather than a default. Apple sees the region being looked
 *   at; it never sees the track, which is drawn on this device from coordinates
 *   that never leave it.
 * - **off** — the canvas: the same route, the same stops, a scale bar and a
 *   north mark, drawn from nothing but your own data. Not a lesser fallback so
 *   much as the honest version — it shows exactly what the app knows and
 *   invents no streets around it.
 *
 * Callers never branch on the setting, and nothing outside this file imports
 * `expo-maps`. That matters more than usual here: the module is alpha and
 * documents frequent breaking changes, so the blast radius is one file.
 *
 * The framing is worked out here, by `zoomForBounds`, rather than left to
 * whichever backend is drawing — flipping the setting should change what is
 * *under* the line, not where the line sits.
 */

export interface MapTrack {
  readonly id: string;
  readonly points: readonly LatLon[];
  readonly color: string;
}

export type MarkKind = 'stay' | 'place' | 'media';

export interface MapMark {
  readonly id: string;
  readonly at: LatLon;
  readonly label: string;
  readonly kind: MarkKind;
}

/** A stay's wander, drawn to scale. Only meaningful on a map of one stop. */
export interface MapCircle {
  readonly id: string;
  readonly at: LatLon;
  readonly radiusM: number;
}

interface MapCanvasProps {
  readonly tracks: readonly MapTrack[];
  readonly marks?: readonly MapMark[];
  readonly circles?: readonly MapCircle[];
  /** The replay icon: where the day was at the instant being played. */
  readonly cursor?: LatLon | null;
  readonly mapsEnabled: boolean;
  readonly height?: number;
  /** Announced to a screen reader, which cannot see either backend. */
  readonly label?: string;
}

const MARK_COLORS: Readonly<Record<MarkKind, string>> = {
  stay: colors.stay,
  place: colors.success,
  media: colors.manual,
};

/** SF Symbols, so a mark reads the same on Apple Maps as its dot does on the canvas. */
const MARK_SYMBOLS: Readonly<Record<MarkKind, string>> = {
  stay: 'circle.fill',
  place: 'mappin.circle.fill',
  media: 'camera.fill',
};

/**
 * The smallest area worth framing, in metres.
 *
 * A stay is a dot with a few metres of jitter around it. Framed to fit, that
 * jitter fills the screen and the app appears to claim you paced in circles for
 * two hours.
 */
const MIN_SPAN_M = 250;

function everyPoint(tracks: readonly MapTrack[], marks: readonly MapMark[], cursor: LatLon | null): LatLon[] {
  return [
    ...tracks.flatMap((track) => [...track.points]),
    ...marks.map((mark) => mark.at),
    ...(cursor ? [cursor] : []),
  ];
}

export function MapCanvas({
  tracks,
  marks = [],
  circles = [],
  cursor = null,
  mapsEnabled,
  height = 220,
  label = 'Route map',
}: MapCanvasProps) {
  const bounds = useMemo(() => {
    const points = everyPoint(tracks, marks, cursor);
    const raw = boundsOf(points);
    if (!raw) return null;

    // A stay's circle must fit too, or the ring is drawn off the edge of its
    // own map.
    const widened = circles.reduce<Bounds | null>(
      (accumulated, circle) => unionBounds(accumulated, boundsOf([circle.at])),
      raw,
    );
    return padBounds(widened ?? raw, MIN_SPAN_M);
  }, [tracks, marks, circles, cursor]);

  if (!bounds) {
    return (
      <View style={[styles.empty, { height }]} accessibilityLabel={`${label}: nothing to show`}>
        <Text style={styles.emptyText}>No route recorded</Text>
      </View>
    );
  }

  if (mapsEnabled) {
    return (
      <AppleMapsBackend
        bounds={bounds}
        tracks={tracks}
        marks={marks}
        circles={circles}
        cursor={cursor}
        height={height}
        label={label}
      />
    );
  }

  return (
    <OfflineCanvas
      bounds={bounds}
      tracks={tracks}
      marks={marks}
      circles={circles}
      cursor={cursor}
      height={height}
      label={label}
    />
  );
}

interface BackendProps {
  readonly bounds: Bounds;
  readonly tracks: readonly MapTrack[];
  readonly marks: readonly MapMark[];
  readonly circles: readonly MapCircle[];
  readonly cursor: LatLon | null;
  readonly height: number;
  readonly label: string;
}

function AppleMapsBackend({ bounds, tracks, marks, circles, cursor, height, label }: BackendProps) {
  const center = centerOf(bounds);

  return (
    <View style={[styles.frame, { height }]} accessibilityLabel={label}>
      <AppleMaps.View
        style={StyleSheet.absoluteFill}
        // Zoom worked out from the content rather than left to the map, so the
        // same day is framed identically whether or not imagery is on.
        cameraPosition={{
          coordinates: { latitude: center.lat, longitude: center.lon },
          zoom: zoomForBounds(bounds, { width: 360, height }),
        }}
        properties={{
          isMyLocationEnabled: false,
          isTrafficEnabled: false,
          selectionEnabled: false,
        }}
        uiSettings={{ compassEnabled: true, scaleBarEnabled: true, myLocationButtonEnabled: false }}
        polylines={tracks
          .filter((track) => track.points.length > 1)
          .map((track) => ({
            id: track.id,
            color: track.color,
            width: 4,
            coordinates: track.points.map((point) => ({ latitude: point.lat, longitude: point.lon })),
          }))}
        circles={circles.map((circle) => ({
          id: circle.id,
          center: { latitude: circle.at.lat, longitude: circle.at.lon },
          radius: circle.radiusM,
          color: 'rgba(167,139,250,0.18)',
          lineColor: colors.stay,
          lineWidth: 1,
        }))}
        annotations={[
          ...marks.map((mark) => ({
            id: mark.id,
            title: mark.label,
            text: mark.label,
            coordinates: { latitude: mark.at.lat, longitude: mark.at.lon },
            backgroundColor: MARK_COLORS[mark.kind],
            textColor: colors.onAccent,
            systemImage: MARK_SYMBOLS[mark.kind],
          })),
          ...(cursor
            ? [
                {
                  id: 'cursor',
                  title: 'You',
                  coordinates: { latitude: cursor.lat, longitude: cursor.lon },
                  backgroundColor: colors.move,
                  textColor: colors.onAccent,
                  systemImage: 'location.fill',
                },
              ]
            : []),
        ]}
      />
    </View>
  );
}

/**
 * The same map, drawn from nothing but the coordinates on this phone.
 *
 * Width comes from `onLayout` into state rather than a ref: this app treats
 * `react-hooks/refs` as an error, and a value the render depends on belongs in
 * `useState`. Until the first layout there is nothing to draw, which lasts one
 * frame.
 */
function OfflineCanvas({ bounds, tracks, marks, circles, cursor, height, label }: BackendProps) {
  const [width, setWidth] = useState(0);

  const box = useMemo(() => ({ width, height, padding: 16 }), [width, height]);

  const drawn = useMemo(() => {
    if (width === 0) return null;

    const project = (points: readonly LatLon[]) => projectToBox(points, bounds, box);

    const span = spanMetresOf(bounds);
    // A quarter of the visible width, rounded to something a person would say.
    const scaleMetres = niceScaleMetres(span.eastWest / 4);
    const scalePixels = span.eastWest > 0 ? (scaleMetres / span.eastWest) * (box.width - box.padding * 2) : 0;

    // One metre in pixels, for drawing a stay's wander at its true size.
    const metreInPixels = span.eastWest > 0 ? (box.width - box.padding * 2) / span.eastWest : 0;

    return {
      polylines: tracks
        .filter((track) => track.points.length > 1)
        .map((track) => ({
          id: track.id,
          color: track.color,
          points: project(track.points)
            .map((point) => `${point.x.toFixed(1)},${point.y.toFixed(1)}`)
            .join(' '),
        })),
      // Start and end caps, so a route reads in the direction it was travelled.
      ends: tracks
        .filter((track) => track.points.length > 1)
        .flatMap((track) => {
          const projected = project(track.points);
          const start = projected[0];
          const end = projected[projected.length - 1];
          return start && end ? [{ id: track.id, color: track.color, start, end }] : [];
        }),
      marks: marks.flatMap((mark) => {
        const [point] = project([mark.at]);
        return point ? [{ ...mark, point }] : [];
      }),
      circles: circles.flatMap((circle) => {
        const [point] = project([circle.at]);
        return point ? [{ id: circle.id, point, r: Math.max(3, circle.radiusM * metreInPixels) }] : [];
      }),
      cursor: cursor ? project([cursor])[0] : null,
      scaleMetres,
      scalePixels,
    };
  }, [bounds, box, tracks, marks, circles, cursor, width]);

  return (
    <View
      style={[styles.frame, styles.canvas, { height }]}
      onLayout={(event) => setWidth(event.nativeEvent.layout.width)}
      accessibilityLabel={label}
    >
      {drawn ? (
        <Svg width={width} height={height}>
          {drawn.circles.map((circle) => (
            <Circle
              key={circle.id}
              cx={circle.point.x}
              cy={circle.point.y}
              r={circle.r}
              fill="rgba(167,139,250,0.14)"
              stroke={colors.stay}
              strokeWidth={1}
            />
          ))}

          {drawn.polylines.map((line) => (
            <Polyline
              key={line.id}
              points={line.points}
              fill="none"
              stroke={line.color}
              strokeWidth={3}
              strokeLinejoin="round"
              strokeLinecap="round"
            />
          ))}

          {drawn.ends.map((end) => (
            <G key={`ends-${end.id}`}>
              <Circle
                cx={end.start.x}
                cy={end.start.y}
                r={4}
                fill={colors.background}
                stroke={end.color}
                strokeWidth={2}
              />
              <Circle cx={end.end.x} cy={end.end.y} r={4} fill={end.color} />
            </G>
          ))}

          {drawn.marks.map((mark) => (
            <G key={mark.id}>
              <Circle cx={mark.point.x} cy={mark.point.y} r={5} fill={MARK_COLORS[mark.kind]} />
              <SvgText
                x={mark.point.x + 8}
                y={mark.point.y + 4}
                fill={colors.textSecondary}
                fontSize={10}
                // Long place names would otherwise run off the edge of a map
                // that has no edge to scroll to.
              >
                {mark.label.length > 18 ? `${mark.label.slice(0, 17)}…` : mark.label}
              </SvgText>
            </G>
          ))}

          {drawn.cursor ? (
            <G>
              <Circle cx={drawn.cursor.x} cy={drawn.cursor.y} r={9} fill="rgba(56,189,248,0.25)" />
              <Circle cx={drawn.cursor.x} cy={drawn.cursor.y} r={5} fill={colors.move} />
            </G>
          ) : null}

          {/* North is up: the projection flips latitude so that it is. */}
          <SvgText x={12} y={20} fill={colors.textMuted} fontSize={11}>
            N ↑
          </SvgText>

          {drawn.scalePixels > 0 ? (
            <G>
              <Line
                x1={12}
                y1={height - 18}
                x2={12 + drawn.scalePixels}
                y2={height - 18}
                stroke={colors.textMuted}
                strokeWidth={2}
              />
              <SvgText x={12} y={height - 24} fill={colors.textMuted} fontSize={10}>
                {formatDistance(drawn.scaleMetres)}
              </SvgText>
            </G>
          ) : null}
        </Svg>
      ) : null}
    </View>
  );
}

const styles = StyleSheet.create({
  frame: { borderRadius: radius.md, overflow: 'hidden', backgroundColor: colors.surface },
  canvas: { borderWidth: StyleSheet.hairlineWidth, borderColor: colors.border },
  empty: {
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    alignItems: 'center',
    justifyContent: 'center',
    padding: spacing.md,
  },
  emptyText: { ...typography.caption, color: colors.textMuted },
});
