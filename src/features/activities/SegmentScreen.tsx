import { ScrollView, StyleSheet, Text, View } from 'react-native';

import { formatClockTime, formatDistance, formatDuration, formatPace, formatSpeed, modeLabel } from '@/core/format';
import { matchPlace, type Place } from '@/core/places';
import { averageSpeedMps, durationMs, type Segment } from '@/core/segments';
import { MapCanvas } from '@/components/MapCanvas';
import { ScreenHeader } from '@/components/ScreenHeader';
import { StatTile } from '@/components/StatTile';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

interface SegmentScreenProps {
  readonly segment: Segment;
  readonly places: readonly Place[];
  readonly tzOffsetMinutes: number;
  readonly mapsEnabled: boolean;
  readonly onBack: () => void;
  /** Stays only: opens the place picker. Absent where naming makes no sense. */
  readonly onNamePlace?: () => void;
  /** Moves only: opens the journey sheet. The counterpart to naming a place. */
  readonly onNameJourney?: () => void;
}

/** Every field the app holds for one row of the timeline. */
export function SegmentScreen({
  segment,
  places,
  tzOffsetMinutes,
  mapsEnabled,
  onBack,
  onNamePlace,
  onNameJourney,
}: SegmentScreenProps) {
  const span = `${formatClockTime(segment.startedAt, tzOffsetMinutes)}–${formatClockTime(segment.endedAt, tzOffsetMinutes)}`;
  const elapsed = durationMs(segment);

  if (segment.kind === 'stay') {
    const place = matchPlace(segment, places);
    return (
      <View style={styles.screen}>
        <ScreenHeader
          title={place?.name ?? 'Unnamed place'}
          subtitle={`${span} · ${formatDuration(elapsed)}`}
          onBack={onBack}
          actions={
            onNamePlace
              ? [
                  {
                    label: place ? 'Rename this place' : 'Name this place',
                    icon: 'pricetag-outline',
                    onPress: onNamePlace,
                  },
                ]
              : undefined
          }
        />
        <ScrollView contentContainerStyle={styles.content}>
          <View style={styles.stats}>
            <StatTile label="Duration" value={formatDuration(elapsed)} accent={colors.stay} />
            <StatTile label="Wander" value={formatDistance(segment.radiusM)} />
            <StatTile label="Fixes" value={`${segment.fixCount}`} />
          </View>

          {/* The ring is the radius drawn to scale, not a decoration: it is the
              difference between "you were here" and "you were somewhere in
              here", and a stop recorded indoors is often the latter. */}
          <MapCanvas
            mapsEnabled={mapsEnabled}
            tracks={[]}
            marks={[{ id: segment.id, at: segment.center, label: place?.name ?? 'Stop', kind: 'stay' }]}
            circles={[{ id: `${segment.id}-radius`, at: segment.center, radiusM: segment.radiusM }]}
            label={`Map of ${place?.name ?? 'this stop'}`}
          />

          <Text style={styles.sectionLabel}>WHAT IS STORED</Text>
          <View style={styles.card}>
            <Field label="Latitude" value={segment.center.lat.toFixed(7)} />
            <Field label="Longitude" value={segment.center.lon.toFixed(7)} />
            <Field label="Radius" value={formatDistance(segment.radiusM)} />
            <Field label="Readings behind it" value={`${segment.fixCount}`} />
            <Field label="Identifier" value={segment.id} />
          </View>
          {/* A stop is stored as a centre and a radius, not as a track — the
              individual readings are gone once the day is frozen. */}
          <Text style={styles.footnote}>
            A stop keeps only where it was and how far the readings wandered. The radius is measured from the first
            reading, not the centre, which is what lets it be maintained without keeping every fix.
          </Text>
        </ScrollView>
      </View>
    );
  }

  const average = averageSpeedMps(segment);
  const withSpeed = segment.path.filter((point) => point.speedMps !== null);

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={segment.label ?? modeLabel(segment.mode)}
        subtitle={`${span} · ${formatDuration(elapsed)}`}
        onBack={onBack}
        actions={
          onNameJourney
            ? [
                {
                  label: segment.label ? 'Rename this journey' : 'Name this journey',
                  icon: 'pricetag-outline',
                  onPress: onNameJourney,
                },
              ]
            : undefined
        }
      />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.stats}>
          <StatTile label="Distance" value={formatDistance(segment.distanceM)} accent={modeColors[segment.mode]} />
          <StatTile label="Average" value={formatSpeed(average)} />
          <StatTile label="Top" value={formatSpeed(segment.topSpeedMps)} />
        </View>

        <MapCanvas
          mapsEnabled={mapsEnabled}
          tracks={[{ id: segment.id, points: segment.path, color: modeColors[segment.mode] }]}
          height={240}
          label={`Map of this ${modeLabel(segment.mode).toLowerCase()}`}
        />

        <Text style={styles.sectionLabel}>WHAT IS STORED</Text>
        <View style={styles.card}>
          <Field
            label="Mode"
            value={`${modeLabel(segment.mode)}${segment.modeIsManual ? ' (yours)' : ' (inferred)'}`}
          />
          <Field label="Distance" value={`${segment.distanceM.toFixed(1)} m`} />
          <Field label="Duration" value={formatDuration(elapsed)} />
          <Field label="Average speed" value={formatSpeed(average)} />
          <Field label="Top speed" value={formatSpeed(segment.topSpeedMps)} />
          <Field label="Pace" value={formatPace(average)} />
          <Field label="Readings behind it" value={`${segment.fixCount}`} />
          <Field label="Route points kept" value={`${segment.path.length}`} />
          <Field label="Identifier" value={segment.id} />
        </View>

        <Text style={styles.sectionLabel}>ROUTE POINTS</Text>
        <View style={styles.card}>
          <View style={styles.pointHeader}>
            <Text style={[styles.pointCell, styles.pointTime]}>TIME</Text>
            <Text style={[styles.pointCell, styles.pointCoord]}>LAT, LON</Text>
            <Text style={[styles.pointCell, styles.pointSpeed]}>SPEED</Text>
          </View>
          {segment.path.map((point) => (
            <View key={point.at} style={styles.pointRow}>
              <Text style={[styles.pointCell, styles.pointTime]}>{formatClockTime(point.at, tzOffsetMinutes)}</Text>
              <Text style={[styles.pointCell, styles.pointCoord]}>
                {point.lat.toFixed(5)}, {point.lon.toFixed(5)}
              </Text>
              <Text style={[styles.pointCell, styles.pointSpeed]}>
                {point.speedMps === null ? '—' : formatSpeed(point.speedMps)}
              </Text>
            </View>
          ))}
        </View>

        <Text style={styles.footnote}>
          {segment.path.length} of {segment.fixCount} readings were kept: a point is stored only once you have moved
          about 25 m from the last one. Speed is worked out from the distance and time between two readings, never taken
          from the platform&apos;s own estimate — so it can never disagree with the distance above.
          {withSpeed.length < segment.path.length
            ? ' The first point has no reading before it, so it has no speed.'
            : ''}
        </Text>
      </ScrollView>
    </View>
  );
}

function Field({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.field} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.fieldLabel}>{label}</Text>
      <Text style={styles.fieldValue} numberOfLines={1}>
        {value}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  stats: { flexDirection: 'row', gap: spacing.sm },
  sectionLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, marginTop: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  field: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  fieldLabel: { ...typography.body, color: colors.textSecondary, flexShrink: 0 },
  fieldValue: { ...typography.clock, color: colors.textPrimary, flexShrink: 1, textAlign: 'right' },
  pointHeader: {
    flexDirection: 'row',
    paddingVertical: spacing.xs,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: colors.border,
  },
  pointRow: { flexDirection: 'row', paddingVertical: spacing.xs },
  pointCell: { ...typography.caption, fontVariant: ['tabular-nums'], color: colors.textSecondary },
  pointTime: { width: 52 },
  pointCoord: { flex: 1 },
  pointSpeed: { width: 76, textAlign: 'right' },
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs },
});
