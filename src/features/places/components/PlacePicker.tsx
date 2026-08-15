import { useState } from 'react';
import { KeyboardAvoidingView, Modal, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { formatClockTime, formatDistance, formatDuration } from '@/core/format';
import { isAmbiguous, rankPlaceCandidates, type Place, type PlaceVisits } from '@/core/places';
import type { StaySegment } from '@/core/segments';
import { colors, radius, spacing, typography } from '@/theme/tokens';

interface PlacePickerProps {
  /** The stay being named. Null closes the picker. */
  readonly stay: StaySegment | null;
  readonly places: readonly Place[];
  /** Visit history, for the context under each option. */
  readonly visits: readonly PlaceVisits[];
  readonly tzOffsetMinutes: number;
  /** "This is that place." Widens the place if the stay fell outside it. */
  readonly onPickExisting: (place: Place) => void;
  readonly onCreate: (name: string) => void;
  readonly onClose: () => void;
}

function contextFor(place: Place, visits: readonly PlaceVisits[]): string | null {
  const entry = visits.find((visit) => visit.place.id === place.id);
  if (!entry || entry.visits.length === 0) return null;
  const times = entry.visits.length === 1 ? 'once' : `${entry.visits.length} times`;
  return `Visited ${times} · ${formatDuration(entry.totalMs)} in total`;
}

/**
 * Naming a stay, when the answer is not obvious.
 *
 * The engine can say which named places are near and which of them claim this
 * stay. It cannot say whether the café and the shopping centre it sits inside
 * are the same visit, or whether the reading 200 m from your usual spot is the
 * same restaurant on a day with bad signal. Only the person who was there knows,
 * so the picker asks — and gives them what the engine *does* know to decide on:
 * how far each candidate is, whether it currently matches, and how often you
 * have been there.
 *
 * When exactly one place claims the stay the timeline already shows it, and this
 * is only reached by choosing to rename. When two or more do, the timeline is
 * showing the nearest — a guess — and the banner says so.
 */
export function PlacePicker({
  stay,
  places,
  visits,
  tzOffsetMinutes,
  onPickExisting,
  onCreate,
  onClose,
}: PlacePickerProps) {
  const [draft, setDraft] = useState('');

  const candidates = stay ? rankPlaceCandidates(stay, places) : [];
  const ambiguous = isAmbiguous(candidates);

  return (
    <Modal visible={stay !== null} transparent animationType="slide" onRequestClose={onClose}>
      {/* **The field is what the sheet is for, so the keyboard must not cover
          it.** This sat at the bottom of the screen with nothing between it and
          the keyboard, so naming a place meant typing a name you could not
          read — reported from a phone, and the worst possible place for it: the
          one control here whose entire job is to be looked at while it is being
          typed into.

          `padding` on a full-height wrapper, and the sheet is already capped
          and already anchored to the bottom of it, so the whole thing simply
          rides up. Same shape as `NoteSheet` — see the note there on why a
          bounded, scrolling sheet is the version that cannot go wrong. */}
      <KeyboardAvoidingView behavior="padding" style={styles.avoider}>
        <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" accessibilityLabel="Close">
          <Pressable style={styles.sheet} onPress={() => {}}>
            <Text style={styles.title} accessibilityRole="header">
              Name this place
            </Text>
            {stay ? (
              <Text style={styles.subtitle}>
                {formatClockTime(stay.startedAt, tzOffsetMinutes)}–{formatClockTime(stay.endedAt, tzOffsetMinutes)} ·{' '}
                {formatDuration(stay.endedAt - stay.startedAt)}
              </Text>
            ) : null}

            {/* Only shown when the automatic answer really is a coin toss. */}
            {ambiguous ? (
              <View style={styles.warning}>
                <Text style={styles.warningText}>
                  More than one place you have named covers this spot. The timeline is showing the nearest — pick the
                  right one below.
                </Text>
              </View>
            ) : null}

            <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
              {candidates.map(({ place, distanceM, withinRadius }) => {
                const context = contextFor(place, visits);
                return (
                  <Pressable
                    key={place.id}
                    onPress={() => onPickExisting(place)}
                    accessibilityRole="button"
                    accessibilityLabel={`This is ${place.name}, ${formatDistance(distanceM)} away`}
                    style={({ pressed }) => [styles.candidate, pressed && styles.pressed]}
                  >
                    <View style={styles.candidateText}>
                      <Text style={styles.candidateName}>{place.name}</Text>
                      <Text style={styles.candidateDetail}>
                        {formatDistance(distanceM)} away
                        {/* The distinction that decides what tapping does: an
                          inside match relabels, an outside one widens. */}
                        {withinRadius ? ' · already covers this spot' : ' · just outside'}
                      </Text>
                      {context ? <Text style={styles.candidateDetail}>{context}</Text> : null}
                    </View>
                  </Pressable>
                );
              })}

              {candidates.length === 0 ? (
                <Text style={styles.empty}>No named places nearby. Give this one a name.</Text>
              ) : null}
            </ScrollView>

            <View style={styles.newPlace}>
              <Text style={styles.newLabel}>{candidates.length > 0 ? 'Or name it something new' : 'Name'}</Text>
              <TextInput
                value={draft}
                onChangeText={setDraft}
                placeholder="e.g. abc restaurant"
                placeholderTextColor={colors.textMuted}
                style={styles.input}
                accessibilityLabel="Place name"
                returnKeyType="done"
                onSubmitEditing={() => {
                  if (draft.trim().length > 0) onCreate(draft.trim());
                  setDraft('');
                }}
              />
              <Pressable
                onPress={() => {
                  if (draft.trim().length > 0) onCreate(draft.trim());
                  setDraft('');
                }}
                accessibilityRole="button"
                accessibilityLabel="Save place"
                style={({ pressed }) => [styles.save, pressed && styles.pressed]}
              >
                <Text style={styles.saveText}>Save</Text>
              </Pressable>
            </View>
          </Pressable>
        </Pressable>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  avoider: { flex: 1 },
  backdrop: { flex: 1, backgroundColor: '#000000AA', justifyContent: 'flex-end' },
  sheet: {
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.lg,
    borderTopRightRadius: radius.lg,
    padding: spacing.lg,
    paddingBottom: spacing.xl,
    gap: spacing.sm,
    maxHeight: '85%',
  },
  title: { ...typography.title, fontSize: 20, color: colors.textPrimary },
  subtitle: { ...typography.caption, color: colors.textSecondary },
  warning: {
    backgroundColor: colors.surfaceRaised,
    borderLeftWidth: 3,
    borderLeftColor: colors.manual,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  warningText: { ...typography.caption, color: colors.textSecondary },
  // **`flexShrink` is the half that matters once the keyboard is up.** The
  // sheet is capped, so something inside it has to give — and it must be this
  // and never the field below it. Without it the list keeps its full height and
  // pushes the name box out through the bottom of the sheet, which is the same
  // bug wearing a different hat.
  list: { flexGrow: 0, flexShrink: 1 },
  candidate: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: spacing.md,
    marginBottom: spacing.xs,
  },
  candidateText: { flex: 1, gap: 2 },
  candidateName: { ...typography.body, color: colors.textPrimary },
  candidateDetail: { ...typography.caption, color: colors.textSecondary },
  empty: { ...typography.caption, color: colors.textMuted, paddingVertical: spacing.sm },
  // Never shrinks: the label, the field and Save are the reason the sheet is
  // open, and they are the last thing that should give up room.
  newPlace: { gap: spacing.sm, flexShrink: 0 },
  newLabel: { ...typography.label, fontSize: 11, color: colors.textMuted },
  input: {
    ...typography.body,
    color: colors.textPrimary,
    backgroundColor: colors.surfaceRaised,
    borderRadius: radius.sm,
    padding: spacing.sm,
  },
  save: { backgroundColor: colors.move, borderRadius: radius.sm, paddingVertical: spacing.sm, alignItems: 'center' },
  saveText: { ...typography.body, fontWeight: '600', color: colors.onAccent },
  pressed: { opacity: 0.6 },
});
