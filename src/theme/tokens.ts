/**
 * Design tokens. Every colour, space and type size in the app comes from here,
 * so a restyle is a one-file change rather than a hunt through StyleSheets.
 */
import type { TextStyle } from 'react-native';

export const colors = {
  background: '#0B0F14',
  surface: '#151C24',
  surfaceRaised: '#1E2833',
  border: '#2A3644',

  textPrimary: '#F2F6FA',
  textSecondary: '#9AAABC',
  textMuted: '#64748B',

  /** Movement — the "you went somewhere" state. */
  move: '#38BDF8',
  /** Being somewhere. Deliberately calmer than movement so a glance tells the timeline apart. */
  stay: '#A78BFA',
  /** A stretch you claimed by hand. */
  manual: '#FBBF24',
  success: '#34D399',
  danger: '#F87171',

  onAccent: '#0B0F14',
} as const;

/** One colour per travel mode, so a day reads as a shape before it reads as text. */
export const modeColors = {
  walk: '#38BDF8',
  run: '#34D399',
  cycle: '#FBBF24',
  drive: '#F472B6',
  unknown: '#64748B',
} as const;

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
  xxl: 48,
} as const;

export const radius = {
  sm: 8,
  md: 12,
  lg: 20,
  pill: 999,
} as const;

export const typography = {
  /** The day's headline number. Tabular figures stop the layout jittering as it updates. */
  hero: { fontSize: 44, fontWeight: '200', fontVariant: ['tabular-nums'] },
  title: { fontSize: 24, fontWeight: '600' },
  body: { fontSize: 16, fontWeight: '400' },
  /** Times down the left of the timeline. Tabular, or the rows do not line up. */
  clock: { fontSize: 14, fontWeight: '500', fontVariant: ['tabular-nums'] },
  label: { fontSize: 13, fontWeight: '600', letterSpacing: 1.2 },
  caption: { fontSize: 13, fontWeight: '400' },
} satisfies Record<string, TextStyle>;
