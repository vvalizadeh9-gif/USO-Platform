import KpiSpark from '../../components/KpiSpark'
import { deltaText, deltaTone, weekDelta } from './homeLogic'
import { formatNumber } from '../../lib/numbers'

// Static figures: the queue rows on Home's work cards are the way into the work.
function Tile({ kpi, label, value, series, delta, hero, index }) {
  const text = deltaText(delta)
  return (
    <div
      className={`hk-tile ${hero ? 'is-hero' : ''}`.trim()}
      style={{ '--i': index }}
      data-kpi={kpi}
    >
      <span className="hk-label">{label}</span>
      <span className="hk-value">{formatNumber(value)}</span>
      <span className="hk-delta" data-tone={deltaTone(kpi, delta)}>{text ?? ' '}</span>
      <KpiSpark values={series} title={label} />
    </div>
  )
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
          <Tile key={t.kpi} {...t} index={i} />
        ))}
      </section>
      <p className="hk-caption">Trend lines show the last 14 days · change compared with 7 days ago</p>
    </div>
  )
}
