/**
 * Design tokens — the single source of truth for color, type and spacing.
 * Components never hard-code values; they read CSS custom properties which are
 * emitted from THESE objects into index.css (see [data-theme="evening"|"daylight"]).
 */

export type ThemeName = 'evening' | 'daylight'

export interface ThemeTokens {
  background: string
  backgroundSoft: string
  felt: string
  feltDeep: string
  feltLight: string
  rail: string
  railLight: string
  brass: string
  gold: string
  goldSoft: string
  vermilion: string
  vermilionSoft: string
  cream: string
  creamDim: string
  ink: string
  panel: string
  panelBorder: string
  good: string
  warn: string
  tierTrail: string
  tierPureRun: string
  tierRun: string
  tierColor: string
  tierPair: string
  tierHighCard: string
}

export const EVENING: ThemeTokens = {
  background: '#14100d',
  backgroundSoft: '#1d1712',
  felt: '#0f3d2e',
  feltDeep: '#09301f',
  feltLight: '#155a43',
  rail: '#2b1d12',
  railLight: '#4a3220',
  brass: '#b98a2f',
  gold: '#e8b64c',
  goldSoft: '#f5d98b',
  vermilion: '#e4572e',
  vermilionSoft: '#ff8a63',
  cream: '#f5ead9',
  creamDim: '#c8b8a4',
  ink: '#f5ead9',
  panel: 'rgba(28, 21, 15, 0.78)',
  panelBorder: 'rgba(232, 182, 76, 0.18)',
  good: '#7fd08f',
  warn: '#ffb454',
  tierTrail: '#e8b64c',
  tierPureRun: '#b78cff',
  tierRun: '#6cb4ff',
  tierColor: '#4fd0c2',
  tierPair: '#7fd08f',
  tierHighCard: '#9aa3ad'
}

export const DAYLIGHT: ThemeTokens = {
  background: '#f3ede2',
  backgroundSoft: '#e9e1d2',
  felt: '#1d5c40',
  feltDeep: '#123f2a',
  feltLight: '#2a7350',
  rail: '#4a3220',
  railLight: '#6b4c30',
  brass: '#a5761f',
  gold: '#b57f1e',
  goldSoft: '#8f6313',
  vermilion: '#c2401d',
  vermilionSoft: '#9c3312',
  cream: '#f7f1e6',
  creamDim: '#5e5344',
  ink: '#2c241a',
  panel: 'rgba(255, 252, 245, 0.86)',
  panelBorder: 'rgba(90, 60, 20, 0.18)',
  good: '#1f7a38',
  warn: '#9a6200',
  tierTrail: '#9a6d00',
  tierPureRun: '#7a3fd6',
  tierRun: '#0f6fd6',
  tierColor: '#0b8377',
  tierPair: '#1f7a38',
  tierHighCard: '#5b6670'
}

/** Convert a ThemeTokens object to CSS custom property declarations for index.css. */
export const themeToCssVars = (t: ThemeTokens): string =>
  Object.entries(t)
    .map(([k, v]) => `--${k.replace(/[A-Z]/g, m => '-' + m.toLowerCase())}: ${v};`)
    .join('\n    ')
