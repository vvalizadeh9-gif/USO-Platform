import { ChevronLeft, ChevronRight } from 'lucide-react'
import CardFailed from './CardFailed'
import PlanRing from './PlanRing'
import { fmt, monthKey, monthView } from './model'

/**
 * One month of one stream, beside the chart: what was approved, the two
 * plans as rings, and what it takes to finish (or how it finished).
 *
 * Reads the same /acceptance/progress payload as the chart, so the two
 * cannot disagree. The month comes from the page (?month=); the chooser
 * here and a click on the chart both set it. Previous and Next stay inside
 * the chart's window, and Next stops at the running month.
 */
export default function MonthPanel({ state, stream, month, onMonth, isContractor }) {
  if (state.error) {
    return (
      <section className="ui-card accd-panel" aria-label="Month">
        <CardFailed what="this month" error={state.error} onRetry={state.retry} />
      </section>
    )
  }
  if (!state.data) {
    return <section className="ui-card accd-panel accd-skeleton" aria-label="Month" aria-busy="true" data-testid="panel-skeleton" />
  }

  const progress = state.data
  const keys = progress.months.map(monthKey)
  const view = monthView(progress, stream, month, progress.today, { isContractor })
  if (!view) return null
  const at = keys.indexOf(month)

  return (
    <section className="ui-card accd-panel" aria-label={`${view.label} ${view.year}`}>
      <div className="accd-chooser">
        <button
          type="button"
          className="btn btn-ghost accd-step"
          aria-label="Previous month"
          disabled={at <= 0}
          onClick={() => onMonth(keys[at - 1])}
        >
          <ChevronLeft size={18} aria-hidden="true" />
        </button>
        <select
          className="accd-month-select"
          aria-label="Month"
          dir="auto"
          value={month}
          onChange={(e) => onMonth(e.target.value)}
        >
          {[...progress.months].reverse().map((m) => (
            <option key={monthKey(m)} value={monthKey(m)} dir="auto">
              {m.label} {m.shamsi_year}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="btn btn-ghost accd-step"
          aria-label="Next month"
          disabled={at >= keys.length - 1 || view.isCurrent}
          onClick={() => onMonth(keys[at + 1])}
        >
          <ChevronRight size={18} aria-hidden="true" />
        </button>
      </div>

      <div className="accd-headline">
        <span className="accd-headline-figure tnum" data-testid="panel-approved">{fmt(view.approved)}</span>
        <span className="accd-headline-side">
          <span className={`accd-pill accd-pill-${view.status.tone} tnum`}>{view.status.text}</span>
          <span className="accd-to-date tnum">To date {fmt(view.approvedToDate)}</span>
        </span>
      </div>

      <div className={`accd-rings${view.rings.length === 1 ? ' is-single' : ''}`}>
        {view.rings.map((ring) => (
          <PlanRing key={ring.kind} ring={ring} />
        ))}
      </div>

      <div className="accd-finish" data-testid="finish-box">
        <div className="accd-finish-title">{view.finish.title}</div>
        <div className={`accd-finish-cols${view.finish.columns.length === 1 ? ' is-single' : ''}`}>
          {view.finish.columns.map((col) => (
            <div key={col.kind} className="accd-finish-col">
              <b className="accd-finish-figure tnum">{col.figure}</b>
              <span className="accd-finish-line">{col.line}</span>
            </div>
          ))}
        </div>
      </div>
    </section>
  )
}
