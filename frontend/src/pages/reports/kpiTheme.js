// The KPI page's colour rules, kept out of the component so they can be
// tested on their own and reused by the mapping screen.
//
// The thresholds here must agree with `services/kpi_export.py`, which paints
// the same cells in the Excel and PDF exports. They are stated in both places
// rather than sent down with each row, because the server would then be
// deciding a colour and the two would still have to agree about what to do
// with it.

/** Difference from the country average, in points, at which a shade deepens. */
export const STRONG_AT = 5

export const SHADES = {
  betterStrong: '#9FDDD2',
  better: '#E3F5F2',
  worse: '#FCE9E7',
  worseStrong: '#F4B9B3',
  none: 'transparent',
}

/** The four steps of the funnel, darkening along it. */
export const FUNNEL_STEPS = ['#D5DBE3', '#9FDDD2', '#5CC4B3', '#0EA394']

/**
 * The background a heatmap cell gets.
 *
 * Two rules, both of which change the answer:
 *
 * A low-sample province is never coloured. Three DT-done villages, all
 * approved, is not "23 points better than the country" — it is three
 * villages, and painting it the strongest green puts it at the top of a
 * page people make decisions from.
 *
 * For the rejected columns lower is better, so the comparison is inverted.
 * Without that, a province refused less often than the rest of the country
 * would be painted red for it.
 */
export function cellShade(cell, lowSample) {
  if (lowSample || cell?.delta == null) return SHADES.none
  const delta = cell.lower_is_better ? -cell.delta : cell.delta
  if (delta >= STRONG_AT) return SHADES.betterStrong
  if (delta >= 0) return SHADES.better
  if (delta > -STRONG_AT) return SHADES.worse
  return SHADES.worseStrong
}

/** A percentage, or an em dash where there is nothing to divide by. */
export function fmtPct(value) {
  return value == null ? '—' : `${value.toFixed(1)}%`
}

/** A difference in points, always signed, so +0.0 reads as "level". */
export function fmtDelta(value) {
  return value == null ? '—' : `${value >= 0 ? '+' : ''}${value.toFixed(1)} pts`
}

/** Which way a pill reads: ahead of the country, behind it, or neither. */
export function deltaTone(cell) {
  if (cell?.delta == null) return 'flat'
  const delta = cell.lower_is_better ? -cell.delta : cell.delta
  return delta >= 0 ? 'up' : 'down'
}

/** A whole number with thousands separators, for counts. */
export function fmtCount(value) {
  return value == null ? '—' : value.toLocaleString('en-US')
}

export const LENSES = [
  { key: 'rm', label: 'Regional Manager' },
  { key: 'coordinator', label: 'PSO Coordinator' },
  { key: 'contractor', label: 'Contractor' },
  { key: 'region', label: 'CRA Region' },
]

export function lensLabel(key) {
  return LENSES.find((lens) => lens.key === key)?.label ?? key
}

/** The eight columns of the heatmap, after Province and Villages. */
export const HEATMAP_COLUMNS = [
  { key: 'on_air', label: 'On air' },
  { key: 'dt_done', label: 'DT done' },
  { key: 'ict_approved', label: 'ICT approved' },
  { key: 'ict_rejected', label: 'ICT rejected' },
  { key: 'cra_approved', label: 'CRA approved' },
  { key: 'cra_rejected', label: 'CRA rejected' },
]

/** "Last CPM import · 12 Sep 2026, 14:20", or nothing when never imported. */
export function importStamp(value) {
  if (!value) return 'No CPM import yet'
  const when = new Date(value)
  if (Number.isNaN(when.getTime())) return 'No CPM import yet'
  return when.toLocaleString('en-GB', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  })
}
