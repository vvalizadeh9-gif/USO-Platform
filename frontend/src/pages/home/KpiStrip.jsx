import { ArrowDown, ArrowUp, CircleCheck, ClockAlert, Hourglass } from 'lucide-react'

/**
 * A change, in a neutral chip: the arrow says which way, colour says nothing
 * (more waiting is bad, more done is good, so a colour would lie half the
 * time). Nothing at all when there is no figure to compare with.
 */
function Trend({ delta, suffix = '' }) {
  if (delta === null || delta === undefined) return null
  if (delta === 0) {
    return <span className="h-chip">No change{suffix}</span>
  }
  const Arrow = delta > 0 ? ArrowUp : ArrowDown
  const words = `${delta > 0 ? 'up' : 'down'} ${Math.abs(delta)}${suffix}`
  return (
    <span className="h-chip" aria-label={words}>
      <Arrow size={12} strokeWidth={2.6} aria-hidden="true" />
      {Math.abs(delta)}
      {suffix}
    </span>
  )
}

function Cell({ icon: Icon, tint, label, value, tone, children }) {
  return (
    <div className="h-k">
      <span className="h-kl">
        <span className="h-icon" data-tint={tint} aria-hidden="true">
          <Icon size={17} strokeWidth={2} />
        </span>
        {label}
      </span>
      <span className={`h-kv ${tone || ''}`.trim()}>{value}</span>
      <span className="h-km">{children}</span>
    </div>
  )
}

export default function KpiStrip({ totals, slaDays, dueSoonDays }) {
  const queues = totals.queues === 1 ? '1 queue' : `${totals.queues} queues`
  const doneDelta = totals.done_today - totals.done_yesterday
  return (
    <section className="h-card h-kpis" aria-label="Your numbers">
      <div className="h-hero">
        <span className="h-hero-top">
          Waiting on you
          <Trend delta={totals.pending_week_delta} suffix=" this week" />
        </span>
        <span className="h-hero-fig">
          <b>{totals.pending}</b>
          <span>
            {totals.pending === 1 ? 'item' : 'items'} in
            <br />
            {queues}
          </span>
        </span>
      </div>
      {/* A status colour only when there is something to warn about: a red
          or amber zero sends people looking for a problem that isn't there. */}
      <Cell icon={ClockAlert} tint="red" label="Overdue" value={totals.overdue} tone={totals.overdue > 0 ? 'late' : ''}>
        <Trend delta={totals.overdue_week_delta} />
        {slaDays ? `past the ${slaDays}-day SLA` : 'past their SLA'}
      </Cell>
      <Cell icon={Hourglass} tint="amber" label="Due soon" value={totals.due_soon} tone={totals.due_soon > 0 ? 'soon' : ''}>
        within {dueSoonDays} {dueSoonDays === 1 ? 'day' : 'days'}
      </Cell>
      <Cell icon={CircleCheck} tint="slate" label="Done today" value={totals.done_today}>
        <Trend delta={doneDelta} />
        vs yesterday
      </Cell>
    </section>
  )
}
