// Insights › Acceptance baskets (UEP-22 §3.2): how a grid cell is drawn.
// Under 3 months is the blue scale, older columns the red one, five steps by
// count against the column's largest cell; zero is an empty dashed square.

export const AGE_COLUMNS = ['u3', 'm3_6', 'm6_12', 'o1y']

/** 1..5: the cell's step in its column's scale; 0 for an empty cell. */
export function heatStep(value, max) {
  if (!value || !max) return 0
  return Math.min(5, 1 + Math.floor((value / max) * 4.99))
}

/** The class a count cell wears: `is-zero`, or `is-blue-N` / `is-red-N`. */
export function cellClass(column, value, max) {
  const step = heatStep(value, max)
  if (!step) return 'is-zero'
  return `is-${column === 'u3' ? 'blue' : 'red'}-${step}`
}

/** Each age column's largest cell, for the scale. */
export function columnMax(rows) {
  return Object.fromEntries(AGE_COLUMNS.map((c) => [c, Math.max(0, ...rows.map((r) => r.cells[c] || 0))]))
}

/** Rows grouped under their captions, in order. */
export function grouped(rows) {
  const out = []
  for (const row of rows) {
    if (out.at(-1)?.label !== row.group) out.push({ label: row.group, rows: [] })
    out.at(-1).rows.push(row)
  }
  return out
}

/** Two letters for a basket's mark ("Contractor A" -> "CA"). */
export function initials(label) {
  const words = String(label || '').replace(/[()]/g, '').split(/\s+/).filter(Boolean)
  if (!words.length) return '·'
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase()
  return (words[0][0] + words[1][0]).toUpperCase()
}

/** Filing, narrowed to one basket and age column (§3.2 "Open in Filing"). */
export function filingLink({ basket, column, authority }) {
  const params = new URLSearchParams({ authority: authority === 'cra' ? 'CRA' : 'ICT', basket })
  if (column && column !== 'total') params.set('bucket', column)
  return `/filing?${params}`
}

/** Filing with one village selected. */
export function villageLink(item) {
  return `/filing?${new URLSearchParams({ authority: item.authority, village: String(item.village_id) })}`
}
