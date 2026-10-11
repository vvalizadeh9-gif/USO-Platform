import { Link } from 'react-router-dom'
import { describeSeries, segments } from '../../components/Sparkline'
import { deltaText, deltaTone, weekDelta } from './homeLogic'

const W = 140
const H = 28
const PAD = 2

/** A 14-day line drawn left to right, its area fading in after it. Gaps
 * (days with no snapshot) stay gaps; with fewer than 14 days it shows what
 * exists. */
function Spark({ values, label }) {
  const known = values.filter((v) => v !== null && v !== undefined)
  const min = Math.min(0, ...known)
  const max = Math.max(1, ...known)
  const step = values.length > 1 ? W / (values.length - 1) : 0
  const y = (v) => PAD + (1 - (v - min) / (max - min)) * (H - 2 * PAD)
  const runs = segments(values).filter((r) => r.length > 1)
  const line = (run) => run.map(([i, v], n) => `${n ? 'L' : 'M'}${i * step} ${y(v)}`).join('')
  return (
    <svg className="hk-spark" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" role="img" aria-label={describeSeries(label, values)}>
      {runs.map((run) => (
        <path key={`a${run[0][0]}`} className="hk-area" d={`${line(run)}L${run[run.length - 1][0] * step} ${H}L${run[0][0] * step} ${H}Z`} />
      ))}
      {runs.map((run) => (
        <path key={`l${run[0][0]}`} className="hk-line" d={line(run)} pathLength="1" />
      ))}
    </svg>
  )
}

function Tile({ kpi, label, value, series, delta, to, hero, index }) {
  const text = deltaText(delta)
  return (
    <Link
      to={to}
      className={`hk-tile ${hero ? 'is-hero' : ''}`.trim()}
      style={{ '--i': index }}
      data-kpi={kpi}
    >
      <span className="hk-label">{label}</span>
      <span className="hk-value">{value}</span>
      <span className="hk-delta" data-tone={deltaTone(kpi, delta)}>{text ?? ' '}</span>
      <Spark values={series} label={label} />
    </Link>
  )
}

// Each tile opens My work filtered to its set.
const LINKS = {
  pending: '/action-center',
  overdue: '/action-center?view=overdue',
  dueSoon: '/action-center?view=due-soon',
  done: '/action-center?view=done',
}

/** Four tiles, scoped to the signed-in user's own actions. */
export default function KpiStrip({ totals, trends }) {
  const done = trends.done || []
  const tiles = [
    { kpi: 'pending', label: 'Waiting on you', value: totals.pending, series: trends.pending, delta: totals.pending_week_delta, hero: true },
    { kpi: 'overdue', label: 'Overdue', value: totals.overdue, series: trends.overdue, delta: totals.overdue_week_delta },
    { kpi: 'dueSoon', label: 'Due soon', value: totals.due_soon, series: trends.due_soon, delta: totals.due_soon_week_delta },
    { kpi: 'done', label: 'Done today', value: totals.done_today ?? 0, series: done, delta: weekDelta(done) },
  ]
  return (
    <div className="hk-wrap">
      <section className="hk-strip" aria-label="Your numbers">
        {tiles.map((t, i) => (
          <Tile key={t.kpi} {...t} to={LINKS[t.kpi]} index={i} />
        ))}
      </section>
      <p className="hk-caption">Trend lines show the last 14 days · change compared with 7 days ago</p>
    </div>
  )
}
