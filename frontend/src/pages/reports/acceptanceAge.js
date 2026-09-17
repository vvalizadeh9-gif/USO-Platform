// The vocabulary of aging, in one place — shared by the dashboard's bars, its
// legend and its aging column.
//
// Two clocks exist and they answer different questions. This file is the
// *programme* clock: how long a village has been eligible for acceptance,
// measured from its drive test. The other one — how long the current round has
// sat with an authority — lives in My Work and is what someone quotes on the
// telephone to a province office. Do not merge them: a letter filed yesterday
// on a village drive-tested two years ago is 1 day old to the office and 730
// days old to the programme, and both facts are true.
//
// The band names come from the API (services/acceptance_workflow.AGE_BUCKETS);
// the labels and colours are what a person reads.

/** Band keys, youngest first — the order they stack in a bar. */
export const AGE_BANDS = ['lt_warn', 'warn', 'critical', 'unknown']

// A severity ramp, not a categorical palette: three steps rather than the four
// an accounts-receivable aging report would use, because at the width a table
// cell affords, a four-step ramp leaves the two worst bands closer than a
// full-colour reader can separate. "Unknown" is deliberately grey and sits
// outside the ramp — a village whose DT date never came through the import is
// unmeasured, not new, and colouring it as the youngest band would rebuild the
// blind spot this clock exists to remove.
export const AGE_META = {
  lt_warn: { label: 'Under 90d', color: '#7f97c4' },
  warn: { label: '90–180d', color: '#cf8c1a' },
  critical: { label: 'Over 180d', color: '#c4342f' },
  unknown: { label: 'No DT date', color: 'var(--text-dim)' },
}

// Where a single age number turns amber and then red. These mirror
// acceptance_workflow.AGE_WARN_DAYS / AGE_CRITICAL_DAYS and are PLACEHOLDERS
// until the programme sets them; they colour text and nothing else, so moving
// one changes what reads as urgent and never a count.
export const AGE_WARN_DAYS = 90
export const AGE_CRITICAL_DAYS = 180

/** The tone class for one age in days. */
export function ageTone(days) {
  if (days == null) return 'is-none'
  if (days >= AGE_CRITICAL_DAYS) return 'is-bad'
  if (days >= AGE_WARN_DAYS) return 'is-slipping'
  return 'is-ok'
}

/** Total villages across an age-bucket map, tolerating a missing map. */
export const bandTotal = (buckets) =>
  AGE_BANDS.reduce((n, band) => n + (buckets?.[band] ?? 0), 0)
