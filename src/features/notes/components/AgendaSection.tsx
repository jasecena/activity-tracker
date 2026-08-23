import { Ionicons } from '@expo/vector-icons';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { nextUp, type Agenda, type AgendaItem } from '@/core/agenda';
import { formatClockTime, formatDayTitle, formatDuration } from '@/core/format';
import { colors, radius, spacing } from '@/theme/tokens';

/** How many suggestions are worth a glance. The rest is a list to scroll, not a next thing. */
const SHOWN = 5;

interface AgendaSectionProps {
  readonly agenda: Agenda;
  readonly tzOffsetMinutes: number;
  readonly now: number;
  readonly busy: boolean;
  /** Set when the last refresh did not work, or the agenda is old. Shown, never logged. */
  readonly note: string | null;
  readonly onRefresh: () => void;
}

/**
 * What the machine at home decided, above the plans it decided them from.
 *
 * **It sits on the Plans list rather than in a page of its own**, and that is
 * the whole of the UI decision. A page would be somewhere to go and look, and
 * the one thing this has to be is already in front of you when you open the
 * list you speak into — the same reasoning that put the diary in a tab instead
 * of under each day.
 *
 * **Every row says why it is there, in the model's own sentence.** A system that
 * decides things about your week and cannot say why is one you stop opening in a
 * fortnight, and `why` is the cheapest possible version of not being that.
 *
 * **What it does not show is your own words**, and that is a change from the
 * first version. This section is what the machine decided; the plans underneath
 * it are what you said, and printing a quotation from one inside the other put
 * both on the same screen twice over. The two lists are separate on purpose —
 * recordings under Plans, decisions under here — and a row that carried both was
 * the seam between them showing through.
 *
 * The citation is still in the data: `quote` and `mentions` arrive on every item
 * and are validated. They belong behind a tap on the row, where the whole
 * relationship can be shown at once rather than one line of it squeezed under a
 * heading. That is a later stage, and until it exists a row is not a control —
 * a tap target that opened nothing would be worse than none.
 *
 * **Nothing here is a control.** You cannot accept, decline or reschedule from
 * this screen, because the phone has no way to tell the machine anything yet —
 * the channel is one-way in this direction on purpose. Drawing buttons that only
 * changed something locally would be the app pretending to a conversation it is
 * not having.
 */
export function AgendaSection({ agenda, tzOffsetMinutes, now, busy, note, onRefresh }: AgendaSectionProps) {
  const items = nextUp(agenda, SHOWN);
  if (items.length === 0 && note === null) return null;

  return (
    <View style={styles.section}>
      <View style={styles.head}>
        <Text style={styles.heading}>WHAT&apos;S NEXT</Text>
        <Pressable
          onPress={onRefresh}
          disabled={busy}
          accessibilityRole="button"
          accessibilityLabel="Check for a new agenda"
          accessibilityState={{ disabled: busy }}
          style={({ pressed }) => [styles.refresh, pressed && styles.pressed]}
        >
          <Ionicons name="refresh" size={16} color={busy ? colors.textMuted : colors.textSecondary} />
        </Pressable>
      </View>

      {items.map((item) => (
        <Row key={item.id} item={item} tzOffsetMinutes={tzOffsetMinutes} now={now} />
      ))}

      {note ? <Text style={styles.note}>{note}</Text> : null}
    </View>
  );
}

/** When a suggestion is for, said the way somebody would say it. */
function whenFor(item: AgendaItem, tzOffsetMinutes: number, now: number): string | null {
  if (item.suggestedAt === null) return null;
  const clock = formatClockTime(item.suggestedAt, tzOffsetMinutes);
  const day = formatDayTitle(item.suggestedAt, tzOffsetMinutes);
  const today = formatDayTitle(now, tzOffsetMinutes);
  return day === today ? clock : `${day}, ${clock}`;
}

function Row({
  item,
  tzOffsetMinutes,
  now,
}: {
  readonly item: AgendaItem;
  readonly tzOffsetMinutes: number;
  readonly now: number;
}) {
  const when = whenFor(item, tzOffsetMinutes, now);
  const facts = [
    item.effortMinutes ? formatDuration(item.effortMinutes * 60_000) : null,
    item.context,
    item.deadline ? `by ${item.deadline}` : null,
  ].filter((one): one is string => typeof one === 'string' && one.length > 0);

  return (
    <View style={styles.row} accessibilityLabel={[item.title, when, item.why].filter(Boolean).join('. ')} accessible>
      <View style={styles.rowHead}>
        <Text style={styles.title}>{item.title}</Text>
        {/* A suggested time is the reason the row is at the top, so it is the one
            thing on it that is not muted. Something only on the list has no
            badge rather than an empty one. */}
        {when ? <Text style={styles.when}>{when}</Text> : null}
      </View>

      {item.why ? <Text style={styles.why}>{item.why}</Text> : null}

      {facts.length > 0 ? <Text style={styles.facts}>{facts.join(' · ')}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  section: {
    marginHorizontal: spacing.md,
    marginBottom: spacing.md,
    padding: spacing.md,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    gap: spacing.sm,
  },
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  heading: { fontSize: 11, fontWeight: '700', letterSpacing: 1, color: colors.textMuted },
  refresh: { padding: spacing.xs },
  pressed: { opacity: 0.6 },
  row: {
    gap: 2,
    paddingTop: spacing.sm,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
  },
  rowHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', gap: spacing.sm },
  title: { flex: 1, fontSize: 15, fontWeight: '600', color: colors.textPrimary },
  when: { fontSize: 13, fontWeight: '600', color: colors.move, fontVariant: ['tabular-nums'] },
  why: { fontSize: 13, color: colors.textSecondary },
  facts: { fontSize: 12, color: colors.textMuted },
  note: { fontSize: 12, color: colors.textMuted, paddingTop: spacing.xs },
});
