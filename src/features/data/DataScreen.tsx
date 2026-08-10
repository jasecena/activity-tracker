import { useEffect, useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';

import { exportFilename, fixesToCsv, pointsToCsv, segmentsToCsv } from '@/core/export';
import { formatDistance, formatIsoWithOffset } from '@/core/format';
import type { Fix, RejectionReason } from '@/core/geo';
import { totalBytes, type MediaItem } from '@/core/media';
import type { Place } from '@/core/places';
import type { Segment } from '@/core/segments';
import { measuredSpans } from '@/services/timing';
import { ScreenHeader } from '@/components/ScreenHeader';
import { shareCsv } from '@/services/exportFile';
import { allFixes, archivedCount } from '@/services/fixBuffer';
import { TRACKING_PRESETS, type TrackingPresetId } from '@/services/location';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface DataScreenProps {
  readonly fixes: readonly Fix[];
  readonly segments: readonly Segment[];
  readonly places: readonly Place[];
  readonly media: readonly MediaItem[];
  readonly rejected: Readonly<Record<RejectionReason, number>> | null;
  readonly preset: TrackingPresetId;
  readonly now: number;
  readonly tzOffsetMinutes: number;
  readonly onBack: () => void;
  /**
   * Make every thumbnail again from its capture. A repair, offered where the
   * other repairs live, rather than something the app does on its own.
   */
  readonly onRebuildThumbnails: () => Promise<number>;
}

const REJECTION_LABELS: Readonly<Record<RejectionReason, string>> = {
  inaccurate: 'Too vague to use',
  teleport: 'Impossible jumps',
  'out-of-order': 'Arrived out of order',
  'too-soon': 'Faster than the sample rate',
  malformed: 'Malformed',
};

function Row({ label, value }: { readonly label: string; readonly value: string }) {
  return (
    <View style={styles.row} accessible accessibilityLabel={`${label}: ${value}`}>
      <Text style={styles.rowLabel}>{label}</Text>
      <Text style={styles.rowValue}>{value}</Text>
    </View>
  );
}

/**
 * What the app is actually holding, and how to get it out.
 *
 * Exists because "why are there only this many rows?" is a fair question with a
 * six-part answer, and no amount of prose beats showing the counts. A day with
 * four rows and eleven hundred rejected fixes was spent indoors; a day with four
 * rows and forty accepted fixes means tracking was off. Those look identical on
 * the timeline and are nothing alike.
 */
export function DataScreen({
  fixes,
  segments,
  places,
  media,
  rejected,
  preset,
  now,
  tzOffsetMinutes,
  onBack,
  onRebuildThumbnails,
}: DataScreenProps) {
  const [rebuilding, setRebuilding] = useState(false);
  const [rebuilt, setRebuilt] = useState<number | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  // Counted a day at a time, never held: this is a year of readings at its
  // largest, and the only thing this screen does with them is say how many
  // there are and write them out when asked.
  const [archived, setArchived] = useState(0);
  useEffect(() => {
    let live = true;
    void archivedCount().then((total) => {
      if (live) setArchived(total);
    });
    return () => {
      live = false;
    };
  }, []);

  const moves = segments.filter((segment) => segment.kind === 'move');
  const stays = segments.filter((segment) => segment.kind === 'stay');
  const points = moves.reduce((sum, segment) => sum + (segment.kind === 'move' ? segment.path.length : 0), 0);
  const droppedTotal = rejected ? Object.values(rejected).reduce((a, b) => a + b, 0) : 0;

  const first = fixes[0];
  const last = fixes[fixes.length - 1];

  const run = (what: string, build: () => string | Promise<string>) => {
    setBusy(what);
    void (async () => {
      const result = await shareCsv(exportFilename(what, now, tzOffsetMinutes), await build());
      setBusy(null);
      if (!result.ok && result.reason === 'unavailable') {
        Alert.alert('Sharing unavailable', 'This device has no way to share a file.');
      }
    })();
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader title="Raw data" subtitle="What is stored, and how to get it out" onBack={onBack} />

      <ScrollView contentContainerStyle={styles.content}>
        <Text style={styles.sectionLabel}>WHAT IS STORED</Text>
        <View style={styles.card}>
          <Row label="Raw fixes (not yet frozen)" value={`${fixes.length}`} />
          <Row label="Raw fixes (archived)" value={`${archived}`} />
          <Row label="Route points (all history)" value={`${points}`} />
          <Row label="Journeys" value={`${moves.length}`} />
          <Row label="Stops" value={`${stays.length}`} />
          <Row label="Named places" value={`${places.length}`} />
          <Row label="Photos, video and voice notes" value={`${media.length}`} />
          <Row label="  Their size on disk" value={`${Math.round(totalBytes(media) / 1024)} kB`} />
        </View>

        {first && last ? (
          <Text style={styles.footnote}>
            Raw fixes cover {formatIsoWithOffset(first.at, tzOffsetMinutes).slice(0, 16).replace('T', ' ')} to{' '}
            {formatIsoWithOffset(last.at, tzOffsetMinutes).slice(0, 16).replace('T', ' ')}. Older raw fixes are deleted
            once their day is finished — only the route points and the timeline survive.
          </Text>
        ) : (
          <Text style={styles.footnote}>
            No raw fixes held. Either tracking is off, or every reading so far was rejected.
          </Text>
        )}

        {/* The honest answer to "why so few rows", in numbers rather than prose. */}
        <Text style={styles.sectionLabel}>WHY THERE ARE NOT MORE</Text>
        <View style={styles.card}>
          <Row label="Readings the OS sends" value={`one per ${TRACKING_PRESETS[preset].distanceInterval} m moved`} />
          <Row label="Dropped before use" value={`${droppedTotal}`} />
          {rejected
            ? (Object.keys(REJECTION_LABELS) as RejectionReason[])
                .filter((reason) => rejected[reason] > 0)
                .map((reason) => (
                  <Row key={reason} label={`  ${REJECTION_LABELS[reason]}`} value={`${rejected[reason]}`} />
                ))
            : null}
        </View>
        <Text style={styles.footnote}>
          Standing still produces no readings at all — the OS only reports once you have moved{' '}
          {formatDistance(TRACKING_PRESETS[preset].distanceInterval)}, which is what makes tracking cheap. A stop of two
          hours can be built from a handful of fixes. Short segments are then folded away: a stop under 3 minutes, or a
          movement under 60 m or 45 seconds, is merged into what surrounds it rather than becoming its own row.
        </Text>

        {/* A repair, not a routine: for a library whose thumbnails drifted
            from their captures. Named for what it does rather than for the bug
            that made it necessary, because it stays useful afterwards. */}
        <Text style={styles.sectionLabel}>REPAIR</Text>
        <View style={styles.card}>
          <Pressable
            onPress={() => {
              setRebuilding(true);
              void onRebuildThumbnails()
                .then((count) => setRebuilt(count))
                .finally(() => setRebuilding(false));
            }}
            disabled={rebuilding || media.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Rebuild every thumbnail"
            style={({ pressed }) => [
              styles.action,
              (rebuilding || media.length === 0) && styles.actionOff,
              pressed && styles.pressed,
            ]}
          >
            <Text style={styles.actionText}>
              {rebuilding ? 'Rebuilding…' : rebuilt === null ? 'Rebuild every thumbnail' : `Rebuilt ${rebuilt}`}
            </Text>
          </Pressable>
        </View>
        <Text style={styles.footnote}>
          Makes each capture&apos;s small picture again from the capture itself. Nothing is re-encoded and no capture is
          touched — only the thumbnail beside it, which is what the filmstrip and the map pin draw.
        </Text>

        {/* Where this launch's time went, slowest first. The measurements the
            performance work on the backlog will rank by — printed here because
            a number nobody can see is a number nobody acts on. */}
        <Text style={styles.sectionLabel}>THIS SESSION, MEASURED</Text>
        <View style={styles.card}>
          {measuredSpans().length === 0 ? (
            <Text style={styles.footnote}>Nothing measured yet this session.</Text>
          ) : (
            measuredSpans()
              .slice(0, 12)
              .map((span, position) => (
                <Row key={`${span.name}-${position}`} label={span.name} value={`${span.ms} ms`} />
              ))
          )}
        </View>

        <Text style={styles.sectionLabel}>EXPORT</Text>
        <View style={styles.card}>
          <Pressable
            // Read from the store rather than from the timeline's live buffer.
            // The buffer holds only what has not been frozen yet, which is why
            // this file used to contain today and nothing else.
            onPress={() => run('fixes', async () => fixesToCsv(await allFixes(), tzOffsetMinutes))}
            disabled={busy !== null}
            accessibilityRole="button"
            accessibilityLabel="Export raw fixes as CSV"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={styles.actionText}>Raw fixes (CSV)</Text>
            <Text style={styles.actionDetail}>
              Every reading still on the phone: position, accuracy, altitude, and the platform&apos;s own speed
              estimate. Days frozen before this version was installed kept their timeline and not their readings, so the
              file starts where the archive does.
            </Text>
          </Pressable>

          <Pressable
            onPress={() => run('points', () => pointsToCsv(segments, tzOffsetMinutes))}
            disabled={busy !== null || points === 0}
            accessibilityRole="button"
            accessibilityLabel="Export route points as CSV"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={[styles.actionText, points === 0 && styles.disabled]}>Route points (CSV)</Text>
            <Text style={styles.actionDetail}>
              Every point kept across all history, roughly one per 25 m, each with the speed at that moment.
            </Text>
          </Pressable>

          <Pressable
            onPress={() => run('segments', () => segmentsToCsv(segments, places, tzOffsetMinutes))}
            disabled={busy !== null || segments.length === 0}
            accessibilityRole="button"
            accessibilityLabel="Export timeline as CSV"
            style={({ pressed }) => [styles.action, pressed && styles.pressed]}
          >
            <Text style={[styles.actionText, segments.length === 0 && styles.disabled]}>Timeline (CSV)</Text>
            <Text style={styles.actionDetail}>
              One row per stop and journey, with distance, duration, average and top speed, and the place name.
            </Text>
          </Pressable>
        </View>

        {/* Said before the button is used, not after. */}
        <Text style={styles.warning}>
          An exported file is plain text. Your days are encrypted on this phone with a key that never leaves it, and
          nothing the app stores is copied into a backup — a CSV is neither, and once you save or send it, that
          protection no longer applies to that copy.
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.sm },
  sectionLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, marginTop: spacing.md },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, paddingHorizontal: spacing.md },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: spacing.sm,
    paddingVertical: spacing.sm,
  },
  rowLabel: { ...typography.body, color: colors.textSecondary, flex: 1 },
  rowValue: { ...typography.clock, color: colors.textPrimary },
  footnote: { ...typography.caption, color: colors.textMuted, paddingHorizontal: spacing.xs },
  action: { paddingVertical: spacing.md, gap: 2 },
  actionText: { ...typography.body, color: colors.move, fontWeight: '600' },
  actionOff: { opacity: 0.45 },
  actionDetail: { ...typography.caption, color: colors.textSecondary },
  disabled: { color: colors.textMuted },
  warning: {
    ...typography.caption,
    color: colors.textSecondary,
    backgroundColor: colors.surfaceRaised,
    borderLeftWidth: 3,
    borderLeftColor: colors.manual,
    borderRadius: radius.sm,
    padding: spacing.sm,
    marginTop: spacing.sm,
  },
  pressed: { opacity: 0.6 },
});
