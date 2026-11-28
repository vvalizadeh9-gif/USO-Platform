// Admin › Data import (UEP-29): the pure helpers the page draws from, kept
// apart so they can be tested without rendering.

export const GROUPS = [
  { key: 'dt', label: 'Drive test', unit: 'sites' },
  { key: 'ict', label: 'ICT', unit: 'villages' },
  { key: 'cra', label: 'CRA', unit: 'villages' },
]

export const SEGMENTS = [
  { key: 'new', label: 'New', tone: 'new' },
  { key: 'same', label: 'No change', tone: 'same' },
  { key: 'conflicts', label: 'Conflicts', tone: 'conflict' },
  { key: 'errors', label: 'Errors', tone: 'error' },
]

export const STATUS_LABEL = {
  previewed: 'Previewed',
  applied: 'Applied',
  undone: 'Undone',
  expired: 'Expired',
}

/** Totals per segment across drive test, ICT and CRA. */
export function totals(counts) {
  const out = { new: 0, same: 0, conflicts: 0, errors: 0 }
  for (const g of GROUPS) {
    const c = counts?.[g.key] || {}
    for (const s of SEGMENTS) out[s.key] += c[s.key] || 0
  }
  return out
}

/** Bar segments with their share of the whole, empty ones dropped. */
export function barSegments(counts) {
  const t = totals(counts)
  const sum = Object.values(t).reduce((a, b) => a + b, 0)
  if (!sum) return []
  return SEGMENTS.filter((s) => t[s.key] > 0).map((s) => ({
    ...s, value: t[s.key], share: t[s.key] / sum,
  }))
}

const nf = new Intl.NumberFormat('en-US')
export const fmt = (n) => nf.format(n || 0)

/** The primary button's words, and why it is disabled when it is. */
export function applyState(decisions, busy = false) {
  const d = decisions || {}
  if (d.undecided > 0) {
    return { disabled: true, label: `Apply ${fmt(d.to_apply)} changes`,
      reason: d.undecided === 1 ? '1 conflict still needs a choice' : `${fmt(d.undecided)} conflicts still need a choice` }
  }
  if (!d.to_apply) return { disabled: true, label: 'Apply 0 changes', reason: 'Nothing to apply' }
  return { disabled: busy, label: `Apply ${fmt(d.to_apply)} change${d.to_apply === 1 ? '' : 's'}`, reason: null }
}

/** "12 Oct 2026" for an ISO date or timestamp. */
export function shortDate(iso) {
  if (!iso) return '—'
  const d = new Date(iso.length === 10 ? `${iso}T12:00:00` : iso)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

/** A value as shown in a table cell: ISO dates read as "12 Oct 2026". */
export function showValue(value) {
  if (value == null || value === '') return '—'
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? shortDate(value) : String(value)
}

export const STEPS = [
  { key: 'template', label: 'Template' },
  { key: 'upload', label: 'Upload' },
  { key: 'review', label: 'Review' },
]
