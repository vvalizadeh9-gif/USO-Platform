// D1: how long a site has been waiting, in colour. One constant so the rule
// lives in exactly one place instead of a `> 7` scattered across tabs.
//
// grey under 4 days, amber 4-7 days, red past 7 days -- the boundary matches
// the rule DtReviewTab already used before this existed.
export const WAITING_THRESHOLDS = {
  amberAt: 4,
  redAfter: 7,
}

export function waitingTone(days) {
  if (days == null) return 'grey'
  if (days > WAITING_THRESHOLDS.redAfter) return 'red'
  if (days >= WAITING_THRESHOLDS.amberAt) return 'amber'
  return 'grey'
}
