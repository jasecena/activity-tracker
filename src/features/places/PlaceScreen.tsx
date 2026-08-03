import { useState } from 'react';
import { Alert, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatClockTime, formatDayTitle, formatDistance, formatDuration } from '@/core/format';
import { visitsByPlace, type Place } from '@/core/places';
import type { Segment } from '@/core/segments';
import { MenuSheet } from '@/components/MenuSheet';
import { ScreenHeader } from '@/components/ScreenHeader';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface PlaceScreenProps {
  readonly place: Place;
  readonly allSegments: readonly Segment[];
  readonly tzOffsetMinutes: number;
  readonly onBack: () => void;
  readonly onRename: (id: string, name: string) => void;
  readonly onForget: (id: string) => void;
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
        action={{ label: 'Place options', icon: 'ellipsis-horizontal', onPress: () => setMenuOpen(true) }}
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

      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.card}>
          <Text style={styles.cardLabel}>RECOGNISED WITHIN</Text>
          <Text style={styles.cardValue}>{formatDistance(place.radiusM)}</Text>
          {/* Explains why the radius is what it is, and why it sometimes grows. */}
          <Text style={styles.cardNote}>
            Any stay this close counts as here. It widens automatically when you confirm a visit that fell just outside.
          </Text>
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
  empty: { ...typography.caption, color: colors.textMuted, paddingVertical: spacing.md },
  renameRow: { paddingHorizontal: spacing.md, paddingBottom: spacing.sm },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
});
