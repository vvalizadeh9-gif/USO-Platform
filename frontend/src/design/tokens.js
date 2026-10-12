// UEP design tokens, for script.
//
// src/styles/uep-tokens.css is the source of truth; this mirrors the values a
// script needs (a chart colour, an animation length) so they are never typed
// in by hand. tokens.test.js fails if the two disagree.

/** @typedef {'home'|'driveTest'|'acceptance'|'monthlyPlan'|'insights'|'data'|'admin'} AppId */

export const color = Object.freeze({
  accent: '#1D4ED8',
  accentHover: '#1E40AF',
  accentTint: '#E8EEFC',
  accentOnTint: '#DCE6FD',
  brandDeep: '#0F1F4B',
  brandWave: '#93B2FF',
  text: '#14171F',
  text2: '#3B4250',
  text3: '#4B5260',
  page: '#F5F6F8',
  surface: '#FFFFFF',
  border: '#E3E6EC',
  borderStrong: '#C9CFD9',
  divider: '#EEF0F3',
  danger: '#B42318',
  dangerTint: '#FDECEC',
  approved: '#146C2E',
  approvedTint: '#E7F5EC',
  filed: '#5B21B6',
  filedTint: '#F1ECFB',
})

/** @type {Readonly<Record<AppId, { tile: string, tint: string | null }>>} */
export const appColor = Object.freeze({
  driveTest: { tile: '#0F766E', tint: '#EDF6F5' },
  acceptance: { tile: '#6D28D9', tint: '#F3EFFC' },
  monthlyPlan: { tile: '#B45309', tint: '#FBF3EA' },
  insights: { tile: '#0369A1', tint: null },
  data: { tile: '#475569', tint: null },
  admin: { tile: '#57534E', tint: null },
  home: { tile: '#14171F', tint: null },
})

export const motion = Object.freeze({
  durFast: 150,
  durPop: 160,
  durEnter: 320,
  durSlow: 900,
  easeProductive: 'cubic-bezier(0.2, 0, 0.38, 0.9)',
  easeEntrance: 'cubic-bezier(0, 0, 0.3, 1)',
  easeExpressive: 'cubic-bezier(0.16, 1, 0.3, 1)',
})

/**
 * A token as a CSS `var()` reference, for inline styles.
 * @param {string} name  without the leading `--uep-`, e.g. `accent`
 * @returns {string}
 */
export const cssVar = (name) => `var(--uep-${name})`
