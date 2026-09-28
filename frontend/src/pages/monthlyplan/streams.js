// The two halves of the PM's Monthly Plan page. The accents are the only
// colours that page adds, with MISS for a month that fell short.
export const STREAM_META = {
  dt: { stream: 'DT', title: 'DT Delivery', unit: 'drive tests', accent: '#1F5E8C', hasAssignment: true },
  acceptance: { stream: 'ACCEPTANCE', title: 'Acceptance', unit: 'sites accepted', accent: '#6B4FA0', hasAssignment: false },
}
export const MISS = '#E3A25B'

/** A revision request's reason, as the PM reads it (services/monthly_plan.py). */
export const REASON_LABEL = {
  SITES_BLOCKED: 'Sites blocked',
  SCOPE_CHANGE: 'Scope change',
  PERMITS: 'Permits',
  OTHER: 'Other',
}
