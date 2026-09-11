// Formatting and colour rules shared by every part of the Drive Test
// dashboard. They live here rather than in each component because the whole
// point of most of them is that two figures on the same screen cannot
// disagree about how a number is written or what a colour means.

/** A count, with thousands separators.
 *
 * Latin digits with grouping, even though half the labels on this page are
 * Persian: the figures sit in `tnum` columns that are meant to line up and be
 * compared down the column, and mixing digit systems inside one table breaks
 * both the alignment and the comparison.
 */
export function count(value) {
  if (value == null) return '—'
  return Number(value).toLocaleString('en-US')
}

/** A share of a whole, as a percentage string.
 *
 * Whole numbers. The old dashboard carried one decimal everywhere, which
 * claimed a precision counts of sites do not have — 25.1% of 812 is not a
 * different fact from 25%, it just looks like one. The single exception is
 * `achievement` below, where a threshold sits at exactly 100.
 */
export function share(value, total) {
  if (!total) return '—'
  return `${Math.round((value / total) * 100)}%`
}

/** Achievement against a plan, where the decimal earns its place.
 *
 * 99.6% and 100% land in different bands and mean different things to the
 * contractor being measured, so this is the one figure on the page that keeps
 * a decimal — and drops it when there is nothing after the point.
 */
export function achievement(value) {
  if (value == null) return null
  return `${Number.isInteger(value) ? value : value.toFixed(1)}%`
}

/** Whole percent for a completion rate. */
export function percent(value) {
  if (value == null) return '—'
  return `${Math.round(value)}%`
}

// ---------------------------------------------------------------------------
// Direction and colour
// ---------------------------------------------------------------------------

/** Whether a delta is good news, given which way good points.
 *
 * The old DeltaChip had no notion of this: it painted every rise green and
 * every fall red. Three of the six KPI cards count things you want to go
 * *down* — remaining, ongoing, problematic — so a month that cleared 55 sites
 * rendered in alarm red, and a month that gained 17 problematic sites
 * rendered in reassuring green. Direction is now something each card states.
 *
 * Returns null for a zero delta: no movement is neither good nor bad, and
 * colouring it either way overstates a flat month.
 */
export function deltaTone(delta, goodDirection = 'up') {
  if (delta == null || delta === 0) return null
  const rising = delta > 0
  const good = goodDirection === 'up' ? rising : !rising
  return good ? 'good' : 'bad'
}

export const TONE_COLOR = {
  good: 'var(--green)',
  bad: 'var(--red)',
  flat: 'var(--text-dim)',
}

/** At or above target, close to it, or short of it.
 *
 * Three bands rather than a gradient, because the question a reader asks of
 * an achievement row is which of the three it is in. Unchanged from the
 * dashboard this replaces — the thresholds were right.
 */
export function bandColor(value) {
  if (value == null) return 'var(--text-dim)'
  if (value >= 100) return 'var(--green)'
  if (value >= 80) return 'var(--amber)'
  return 'var(--red)'
}

/** Progress colour for a completion percentage. */
export function progressColor(value) {
  if (value >= 70) return 'var(--green)'
  if (value >= 30) return 'var(--amber)'
  return 'var(--red)'
}

/** How stale a payload is, in words.
 *
 * The dashboard used to describe itself as live while fetching once on mount,
 * so a tab left open all morning quietly served breakfast's numbers. This is
 * what lets it say how old the figures actually are.
 */
export function freshness(generatedAt, now = Date.now()) {
  if (!generatedAt) return null
  const then = new Date(generatedAt).getTime()
  if (Number.isNaN(then)) return null
  const seconds = Math.max(0, Math.round((now - then) / 1000))
  if (seconds < 60) return 'just now'
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 24) return `${hours} hr ago`
  const days = Math.round(hours / 24)
  return `${days} day${days === 1 ? '' : 's'} ago`
}

/** The upper bound of the contractor bullet chart, in drive tests.
 *
 * A count rather than a percentage, because the bars now carry both the size
 * of each commitment and what was delivered against it — see
 * `charts/BulletBar`. Rounded up to a readable step so the axis ends on a
 * number, and padded so a contractor who overshot their plan has room to
 * visibly pass their target rather than pinning to the end of the track.
 */
export function planScale(rows) {
  const highest = Math.max(1, ...rows.flatMap((r) => [r.pip || 0, r.actual || 0]))
  const padded = highest * 1.08
  const step = padded > 240 ? 50 : padded > 120 ? 25 : padded > 60 ? 10 : 5
  return Math.ceil(padded / step) * step
}
