import { useState } from 'react';
import { Alert, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatClockTime, formatDayTitle, formatDistance, formatDuration } from '@/core/format';
import { distanceM, mapsUrl } from '@/core/geo';
import { visitsByPlace, type Place } from '@/core/places';
import type { Segment, StaySegment } from '@/core/segments';
import { MenuSheet } from '@/components/MenuSheet';
import { ScreenHeader } from '@/components/ScreenHeader';
import { openInMaps } from '@/services/openMap';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface PlaceScreenProps {
  readonly place: Place;
  readonly allSegments: readonly Segment[];
  readonly tzOffsetMinutes: number;
  readonly onBack: () => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onForget: (id: string) => void;
}

/**
 * Open a coordinate in Maps, and say so when it will not.
 *
 * **A failure here is worth a dialog rather than a silence.** Every other
 * outcome of pressing this is a whole other app appearing, so nothing happening
 * reads as a dead button rather than as an error — and a dead button is the
 * thing somebody presses four more times.
 */
async function showOnMap(at: Parameters<typeof openInMaps>[0], label: string) {
  const outcome = await openInMaps(at, label);
  if (outcome.ok) return;
  Alert.alert(
    'Could not open Maps',
    outcome.reason === 'no-coordinate'
      ? 'This stay has no usable position, so there is nowhere to open.'
      : 'iOS would not open the link. Maps may be restricted on this device.',
  );
}

/** One place, and every visit to it. */
export function PlaceScreen({ place, allSegments, tzOffsetMinutes, onBack, onRename, onForget }: PlaceScreenProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(place.name);

  const entry = visitsByPlace(allSegments, [place])[0];
  const visits = entry?.visits ?? [];

  const confirmForget = () => {
    Alert.alert(
      `Forget ${place.name}?`,
      'The visits stay in your timeline — they just go back to being unnamed stays.',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Forget',
          style: 'destructive',
          onPress: () => {
            onForget(place.id);
            onBack();
          },
        },
      ],
    );
  };

  return (
    <View style={styles.screen}>
      <ScreenHeader
        title={place.name}
        subtitle={
          entry
            ? `${visits.length === 1 ? '1 visit' : `${visits.length} visits`} · ${formatDuration(entry.totalMs)}`
            : 'No visits recorded yet'
        }
        onBack={onBack}
        actions={[{ label: 'Place options', icon: 'ellipsis-horizontal', onPress: () => setMenuOpen(true) }]}
      />

      {renaming ? (
        <View style={styles.renameRow}>
          <TextInput
            value={draft}
            onChangeText={setDraft}
            style={styles.input}
            accessibilityLabel="New place name"
            autoFocus
            returnKeyType="done"
            onSubmitEditing={() => {
              onRename(place.id, draft);
              setRenaming(false);
            }}
          />
        </View>
      ) : null}

      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <View style={styles.card}>
          <Text style={styles.cardLabel}>RECOGNISED WITHIN</Text>
          <Text style={styles.cardValue}>{formatDistance(place.radiusM)}</Text>
          {/* Explains why the radius is what it is, and why it sometimes grows. */}
          <Text style={styles.cardNote}>
            Any stay this close counts as here. It widens automatically when you confirm a visit that fell just outside.
          </Text>
          {mapsUrl(place) ? (
            <Pressable
              style={styles.mapLink}
              accessibilityRole="link"
              accessibilityLabel={`Open ${place.name} in Maps`}
              onPress={() => void showOnMap(place, place.name)}
            >
              <Text style={styles.mapLinkText}>Open the centre in Maps</Text>
            </Pressable>
          ) : null}
        </View>

        <Text style={styles.sectionLabel}>VISITS</Text>
        {visits.length === 0 ? (
          <Text style={styles.empty}>No recorded visits yet.</Text>
        ) : (
          [...visits]
            .sort((a, b) => b.startedAt - a.startedAt)
            .map((visit) => (
              <View key={visit.id} style={styles.visit}>
                <Text style={styles.visitDate}>{formatDayTitle(visit.startedAt, tzOffsetMinutes)}</Text>
                <Text style={styles.visitDetail}>
                  {formatClockTime(visit.startedAt, tzOffsetMinutes)}–{formatClockTime(visit.endedAt, tzOffsetMinutes)}{' '}
                  · {formatDuration(visit.endedAt - visit.startedAt)}
                </Text>
                {/* **This is the list the purpose exists for.** The name above
                    is the same on every row here — that is what a place is —
                    so without this the page reads as a column of identical
                    entries distinguished only by date. With it, it reads as
                    what you actually did: groceries, haircut, met Sam. */}
                {visit.purpose ? <Text style={styles.visitPurpose}>{visit.purpose}</Text> : null}
                {mapsUrl(visit.center) ? (
                  <Pressable
                    style={styles.mapLink}
                    accessibilityRole="link"
                    accessibilityLabel={`Open the stay on ${formatDayTitle(visit.startedAt, tzOffsetMinutes)} in Maps`}
                    onPress={() =>
                      void showOnMap(
                        visit.center,
                        `${place.name} · ${formatDayTitle(visit.startedAt, tzOffsetMinutes)}`,
                      )
                    }
                  >
                    {/* **The offset is the reason this link is per visit rather
                        than one for the whole page.** Every row here shares the
                        place's name and the place's coordinate; what differs is
                        where the phone actually sat, and a stay eighty metres
                        out is how you find out the radius is wrong or that two
                        places are being read as one. */}
                    <Text style={styles.mapLinkText}>Open in Maps{offsetNote(visit, place)}</Text>
                  </Pressable>
                ) : null}
              </View>
            ))
        )}
      </ScrollView>

      <MenuSheet
        visible={menuOpen}
        title={place.name}
        onClose={() => setMenuOpen(false)}
        items={[
          {
            label: 'Rename',
            onPress: () => {
              setDraft(place.name);
              setRenaming(true);
            },
          },
          { label: 'Forget this place', onPress: confirmForget, destructive: true },
        ]}
      />
    </View>
  );
}

/**
 * How far this stay sat from the place's centre, when that is worth saying.
 *
 * Below the accuracy of the readings that produced it the number is noise
 * dressed as precision, so it is left off entirely rather than printed small.
 */
function offsetNote(visit: StaySegment, place: Place): string {
  const away = distanceM(visit.center, { lat: place.lat, lon: place.lon });
  return away >= NOTABLE_OFFSET_M ? ` · ${formatDistance(away)} from the centre` : '';
}

/**
 * Ten metres, which is about the accuracy of a good fix in the open.
 *
 * Under it, the difference between the stay and the place is the GPS being GPS.
 */
const NOTABLE_OFFSET_M = 10;

const styles = StyleSheet.create({
  screen: { flex: 1 },
  content: { paddingHorizontal: spacing.md, paddingBottom: spacing.xxl, gap: spacing.xs },
  card: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: spacing.xs },
  cardLabel: { ...typography.label, fontSize: 10, color: colors.textMuted },
  cardValue: { ...typography.title, color: colors.stay },
  cardNote: { ...typography.caption, color: colors.textSecondary },
  sectionLabel: { ...typography.label, fontSize: 11, color: colors.textMuted, marginTop: spacing.md },
  visit: { backgroundColor: colors.surface, borderRadius: radius.md, padding: spacing.md, gap: 2 },
  visitDate: { ...typography.body, color: colors.textPrimary },
  visitDetail: { ...typography.caption, color: colors.textSecondary },
  visitPurpose: { ...typography.body, color: colors.stay, marginTop: spacing.xs },
  empty: { ...typography.caption, color: colors.textMuted, paddingVertical: spacing.md },
  mapLink: { paddingTop: spacing.xs },
  mapLinkText: { ...typography.caption, color: colors.move, fontWeight: '600' },
  renameRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
});
