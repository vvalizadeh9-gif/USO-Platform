// D1: how long a site has been waiting, in colour. One place for the rule
// instead of a `> 7` scattered across tabs.
//
// Each queue has its own bands, because "a long time" depends on the work:
//
// * the default (review queues): grey under 4 days, amber 4-7, red past 7 --
//   the boundary DtReviewTab already used before this existed;
// * the HC Pool: neutral up to 30 days, pending 31-60, danger past 60 -- the
//   pool is a programme quantity, and a month in it is ordinary;
// * DT Assignment: neutral up to 7 days, pending 8-14, danger past 14 -- a
//   site confirmed Ready should be with a contractor within the week.
export const WAITING_THRESHOLDS = {
  amberAt: 4,
  redAfter: 7,
}
export const HC_POOL_WAITING = { amberAt: 31, redAfter: 60 }
export const DT_ASSIGNMENT_WAITING = { amberAt: 8, redAfter: 14 }

//: A health check out with a subcontractor for longer than this is late.
//: The server counts the In Progress tab's "N late" chip by the same line
//: (hc_queues.HC_LATE_AFTER_DAYS).
export const HC_LATE_AFTER_DAYS = 14

export function waitingTone(days, thresholds = WAITING_THRESHOLDS) {
  if (days == null) return 'grey'
  if (days > thresholds.redAfter) return 'red'
  if (days >= thresholds.amberAt) return 'amber'
  return 'grey'
}
