// D1: how long a site has been waiting, in colour. One place for the rule
// instead of a `> 7` scattered across tabs.
//
// Grey under 4 days, amber 4-7, red past 7: the contractor's own My Drive
// Tests list. The Health check and Drive test work pages measure waiting
// against each queue's configured SLA instead (components/work/parts.jsx,
// WaitingCell), so their numbers agree with Home's.
export const WAITING_THRESHOLDS = {
  amberAt: 4,
  redAfter: 7,
}

export function waitingTone(days, thresholds = WAITING_THRESHOLDS) {
  if (days == null) return 'grey'
  if (days > thresholds.redAfter) return 'red'
  if (days >= thresholds.amberAt) return 'amber'
  return 'grey'
}
