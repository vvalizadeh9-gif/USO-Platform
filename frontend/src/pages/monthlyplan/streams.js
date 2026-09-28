// The two streams the PIP vs Achieved tab switches between; the key is what
// the address carries (?stream=acceptance). Acceptance has no Assignment.
export const PIP_STREAMS = {
  dt: { key: 'dt', stream: 'DT', title: 'DT Delivery', hasAssignment: true },
  acceptance: { key: 'acceptance', stream: 'ACCEPTANCE', title: 'Acceptance', hasAssignment: false },
}

/** A revision request's reason, as the PM reads it (services/monthly_plan.py). */
export const REASON_LABEL = {
  SITES_BLOCKED: 'Sites blocked',
  SCOPE_CHANGE: 'Scope change',
  PERMITS: 'Permits',
  OTHER: 'Other',
}
