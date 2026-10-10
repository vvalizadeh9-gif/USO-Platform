import { Link } from 'react-router-dom'
import Sparkline from '../../components/Sparkline'
import HomeIcon from './homeIcons'

/**
 * A change, in a neutral badge: the arrow says which way, colour says
 * nothing (more waiting is bad, more done is good, so a colour would lie half
 * the time). Nothing at all when there is no figure to compare with.
 */
function Change({ delta, since }) {
  if (delta === null || delta === undefined) return null
  const words =
    delta === 0 ? `No change on ${since}` : `${delta > 0 ? 'Up' : 'Down'} ${Math.abs(delta)} on ${since}`
  return (
    <span className="h-change" title={words} aria-label={words}>
      {delta === 0 ? '0' : `${delta > 0 ? '▲' : '▼'} ${Math.abs(delta)}`}
    </span>
  )
}

/** One KPI: icon and label, the figure with its change, the 14-day line. A
 * link to the list behind it, where this person has one. */
function Cell({ icon, label, value, delta, since, series, to, hero = false }) {
  const body = (
    <>
      <span className="h-kl">
        <HomeIcon name={icon} size={28} tone={hero ? 'white' : 'color'} />
        {label}
      </span>
      <span className="h-kf">
        <span className="h-kv">{value}</span>
        <Change delta={delta} since={since} />
      </span>
      <Sparkline values={series} label={label} tone={hero ? 'white' : 'brand'} className="h-spark" />
    </>
  )
  const className = `h-k ${hero ? 'h-hero' : ''}`.trim()
  return to ? (
    <Link to={to} className={className}>{body}</Link>
  ) : (
    <div className={className}>{body}</div>
  )
}

// Where each figure opens. The Action Center has an Overdue view; it has no
// due-soon or done view yet, so those open the whole board.
const LINKS = {
  pending: '/action-center',
  overdue: '/action-center?view=overdue',
  dueSoon: '/action-center',
  done: '/action-center',
}

/**
 * Home's four figures (three for a role with no "Done today"), each with its
 * 14-day trend. `linked` is false for a role with no Action Center.
 */
export default function KpiStrip({ totals, trends, linked = true }) {
  const to = (key) => (linked ? LINKS[key] : undefined)
  const showDone = totals.done_today !== null && totals.done_today !== undefined
  const doneDelta =
    showDone && totals.done_yesterday !== null ? totals.done_today - totals.done_yesterday : null
  return (
    <div className="h-kpi-wrap">
      <section className="h-card h-kpis" aria-label="Your numbers">
        <Cell
          hero icon="inbox" label="Waiting on you" value={totals.pending}
          delta={totals.pending_week_delta} since="last week" series={trends.pending} to={to('pending')}
        />
        <Cell
          icon="clock" label="Overdue" value={totals.overdue}
          delta={totals.overdue_week_delta} since="last week" series={trends.overdue} to={to('overdue')}
        />
        <Cell
          icon="hourglass" label="Due soon" value={totals.due_soon}
          delta={totals.due_soon_week_delta} since="last week" series={trends.due_soon} to={to('dueSoon')}
        />
        {showDone && (
          <Cell
            icon="calendarCheck" label="Done today" value={totals.done_today}
            delta={doneDelta} since="yesterday" series={trends.done || []} to={to('done')}
          />
        )}
      </section>
      <p className="h-kpi-note">Trend lines show the last {trends.days.length} days</p>
    </div>
  )
}
