import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatClockTime, formatDistance, formatDuration, formatPace, formatSpeed, modeLabel } from '@/core/format';
import { directionsUrl, mapsUrl } from '@/core/geo';
import { matchPlace, type Place } from '@/core/places';
import { averageSpeedMps, durationMs, type Segment } from '@/core/segments';
import { MapCanvas } from '@/components/MapCanvas';
import { ScreenHeader } from '@/components/ScreenHeader';
import { openInMaps, openRouteInMaps } from '@/services/openMap';
import { StatTile } from '@/components/StatTile';
import { colors, modeColors, radius, spacing, typography } from '@/theme/tokens';

/**
 * Open something in Maps, and say so when it will not.
 *
 * **A failure here is worth a dialog rather than a silence.** Every other
 * outcome of pressing this is a whole other app appearing, so nothing happening
 * reads as a dead button — and a dead button is the one people press again.
 */
async function showOnMap(open: () => Promise<{ ok: boolean; reason?: string }>) {
  const outcome = await open();
  if (outcome.ok) return;
  Alert.alert(
    'Could not open Maps',
    outcome.reason === 'no-coordinate'
      ? 'This has no usable position, so there is nowhere to open.'
      : 'iOS would not open the link. Maps may be restricted on this device.',
  );
}

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
  /**
   * Stays only: say why you were here, or pass empty to stop saying it.
   *
   * Absent where the timeline is read-only. In place rather than behind a sheet
   * — unlike naming the place, which is a picker over a list of candidates,
   * this is one line of free text about one stop, and the page it belongs to is
   * the page you are already on.
   */
  readonly onSetPurpose?: (purpose: string) => void;
  /**
   * What has been written about this stop, read live rather than off the
   * segment.
   *
   * **The page is opened with a snapshot of the stay** — deliberately, because
   * writing a purpose needs the range the page was opened with — and a snapshot
   * cannot know what has been typed since. Passing the current text separately
   * is what stops the field going blank the moment it is saved.
   */
  readonly purpose?: string | null;
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
  onSetPurpose,
  purpose,
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
          actions={[
            // **Beside the map of it, which is where you are already looking.**
            // The canvas below draws the centre and its radius to scale; this
            // opens the same point in Maps, where the streets have names and
            // you can work out what the building actually was.
            ...(mapsUrl(segment.center)
              ? [
                  {
                    label: 'Open this stop in Maps',
                    icon: 'map-outline' as const,
                    onPress: () => void showOnMap(() => openInMaps(segment.center)),
                  },
                ]
              : []),
            ...(onNamePlace
              ? [
                  {
                    label: place ? 'Rename this place' : 'Name this place',
                    icon: 'pricetag-outline' as const,
                    onPress: onNamePlace,
                  },
                ]
              : []),
          ]}
        />
        {/* iOS's own inset, so the field is scrolled clear of the keyboard
            rather than typed into from behind it. A plain scrolling page needs
            this and not the `KeyboardAvoidingView` the sheets need — those are
            anchored to the bottom rather than scrolling. */}
        <ScrollView contentContainerStyle={styles.content} automaticallyAdjustKeyboardInsets>
          {/* **First on the page, above the measurements.** Everything below is
              something the app worked out; this is the only thing here that
              nobody but you could supply, and it is what you came back to this
              stop to read. */}
          {onSetPurpose ? <Purpose value={purpose ?? segment.purpose} onSet={onSetPurpose} /> : null}

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
        actions={[
          // **A route, not a pin.** Where a journey went is the question, and
          // Maps will draw it from the two ends. It is Maps' own idea of the
          // route rather than the one walked — the fixes behind it are gone
          // once the day is frozen — which is honest for orienting yourself.
          ...(directionsUrl(segment.path.at(0), segment.path.at(-1))
            ? [
                {
                  label: 'Open this journey in Maps',
                  icon: 'map-outline' as const,
                  onPress: () => void showOnMap(() => openRouteInMaps(segment.path.at(0), segment.path.at(-1))),
                },
              ]
            : []),
          ...(onNameJourney
            ? [
                {
                  label: segment.label ? 'Rename this journey' : 'Name this journey',
                  icon: 'pricetag-outline' as const,
                  onPress: onNameJourney,
                },
              ]
            : []),
        ]}
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

/**
 * Why you were here.
 *
 * **Saved on blur rather than by a button**, which is the difference between a
 * field and a form. There is one thing to type and nothing to confirm: leaving
 * the field is the whole gesture, and a Save button beside a single line would
 * be a second decision to make about a sentence you have already finished
 * writing.
 *
 * **Emptying it deletes it, with nothing asked.** The bar `confirmDestructive`
 * draws is data its owner made that nothing can reconstruct — a note, a
 * recording, a name. This is one line, in a field, undone by retyping it in the
 * place you are already standing. A dialog there would be a dialog in front of
 * the thing the field is for.
 *
 * The draft is `null` until something is typed, so the field starts at what is
 * stored and a purpose changed elsewhere is not held stale behind a copy of
 * itself — the same reason `NoteSheet` keeps nullable drafts rather than seeding
 * state in an effect.
 */
/**
 * One line about why you were here, saved as you leave the field.
 *
 * **No Save button, and the last thing typed is the answer.** There is one
 * purpose per stop and no versions of it: leaving the field writes what is in
 * it, emptying the field deletes it, and the undo is typing again in the place
 * you are already standing.
 *
 * **Once anything is typed, the field shows that and nothing else.** It used to
 * drop the draft on blur and fall back to the stored value, which read as the
 * field clearing itself — the page is opened with a snapshot of the stay taken
 * when the row was tapped, so the stored value it fell back to was the one from
 * before anything was written. The text vanished in front of somebody who had
 * just typed it.
 *
 * Keeping the draft is both the fix and the simpler rule: there is one purpose
 * per stop and no versions of it, so what is in the field is what was meant.
 * `value` is what the field opens with, and after that the person typing is the
 * authority until they leave the page.
 */
function Purpose({ value, onSet }: { readonly value: string | null; readonly onSet: (purpose: string) => void }) {
  const [draft, setDraft] = useState<string | null>(null);
  const text = draft ?? value ?? '';

  return (
    <View style={styles.purpose}>
      <Text style={styles.purposeLabel}>WHY YOU WERE HERE</Text>
      <TextInput
        value={text}
        onChangeText={setDraft}
        placeholder="Groceries, haircut, waiting for the train…"
        placeholderTextColor={colors.textMuted}
        style={styles.purposeInput}
        accessibilityLabel="Why you were here"
        multiline
        // Saved on the way out, which is the whole of it. The effect above
        // hands the field back to the stored value once the two agree.
        onBlur={() => {
          if (draft !== null) onSet(draft);
        }}
      />
      <Text style={styles.purposeNote}>
        Kept with this stop, not with the place — so the next visit here can have a reason of its own. Clear the field
        to remove it.
      </Text>
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
  purpose: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  purposeLabel: { ...typography.label, fontSize: 10, color: colors.textMuted },
  purposeInput: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    minHeight: 44,
  },
  purposeNote: { ...typography.caption, color: colors.textSecondary },
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
