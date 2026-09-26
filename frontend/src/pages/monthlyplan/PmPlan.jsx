import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { Loading } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { currentShamsiPeriod, nextPeriod, previousPeriod, shamsiMonthName } from '../../lib/shamsi'
import DecisionDrawer from './DecisionDrawer'
import StreamPanel from './StreamPanel'
import { STREAM_META } from './streams'
import { downloadXlsx } from './xlsx'

const VIEWS = [
  { value: 'month', label: 'Month' },
  { value: 'year', label: 'Year' },
  { value: 'since_start', label: 'Since start' },
]

/** Chip colours by what needs doing: warning orange, revision purple,
 * awaiting blue. */
const ATTENTION_COLOR = {
  not_submitted: 'var(--amber)',
  pip_above_assignment: 'var(--amber)',
  revision_requested: 'var(--violet)',
  awaiting_approval: 'var(--blue)',
}

/**
 * The PM's side of the Monthly Plan: DT Delivery and Acceptance side by side.
 *
 * One read (GET /pip/overview) feeds the whole page; it reloads when the
 * period or month changes and after any approve or return. Decisions are
 * made in a side drawer, opened from a Needs attention chip or a contractor
 * row, so the page itself stays one screen.
 *
 * Opens on the month now running. The planning month (next month) is reached
 * through the Needs attention chips -- a plan awaiting approval opens straight
 * into its drawer -- or the › arrow.
 *
 * Role checks decide what is offered, not what is allowed: the page is
 * behind MONTHLY_PLAN_ROLES, Approve and Return only show for canDecide, and
 * the server re-checks both.
 */
export default function PmPlan({ canDecide, canSetTarget }) {
  const toast = useToast()
  const running = currentShamsiPeriod()
  const [view, setView] = useState('month')
  const [period, setPeriod] = useState(running || { year: 0, month: 0 })
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [drawer, setDrawer] = useState(null)

  const load = useCallback(() => {
    setFailed(false)
    const params = { period: view }
    if (view !== 'since_start' && period.year && period.month) {
      params.year = period.year
      params.month = period.month
    }
    api
      .get('/pip/overview', { params })
      .then((r) => setData(r.data))
      .catch(() => setFailed(true))
  }, [view, period])

  useEffect(() => {
    load()
  }, [load])

  function step(direction) {
    if (view === 'year') {
      setPeriod((p) => ({ ...p, year: p.year + direction }))
    } else {
      setPeriod((p) => (direction < 0 ? previousPeriod(p.year, p.month) : nextPeriod(p.year, p.month)))
    }
  }

  async function exportExcel() {
    try {
      // The period on the page, both streams: a "DT Delivery" and an
      // "Acceptance" sheet (the MTN internal PIP rows are the server's to add
      // for staff).
      const params = { period: view }
      if (view === 'year') params.year = period.year
      if (view === 'month') Object.assign(params, { year: period.year, month: period.month })
      await downloadXlsx('/pip/scorecard.xlsx', params, 'pip-plan.xlsx')
    } catch {
      toast.error('Could not build the file', 'Please try again.')
    }
  }

  const monthName = data?.shamsi_month_name || shamsiMonthName(period.month)
  const pickerLabel =
    view === 'since_start' ? 'Since start' : view === 'year' ? String(period.year) : `${monthName} ${period.year}`
  const attention = data?.needs_attention ?? []

  return (
    <div className="mp-page">
      <div className="mp-head">
        <h1 className="mp-title">Monthly Plan</h1>
        <div className="mp-head-right">
          <div className="seg" role="group" aria-label="Period">
            {VIEWS.map((v) => (
              <button key={v.value} type="button" aria-pressed={view === v.value} onClick={() => setView(v.value)}>
                {v.label}
              </button>
            ))}
          </div>
          <div className="mp-picker">
            <div className="row" style={{ gap: 4 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label="Previous"
                disabled={view === 'since_start'}
                onClick={() => step(-1)}
              >
                <ChevronLeft size={15} />
              </button>
              <span className="mp-picker-label" data-testid="mp-period">{pickerLabel}</span>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                aria-label="Next"
                disabled={view === 'since_start'}
                onClick={() => step(1)}
              >
                <ChevronRight size={15} />
              </button>
            </div>
            {view === 'month' && data?.day_of_month != null && (
              <div className="mp-picker-sub">
                Day {data.day_of_month} of {data.days_in_month} ·{' '}
                {data.revision_window_open ? 'revisions until day 15' : 'revisions closed'}
              </div>
            )}
          </div>
          <button type="button" className="btn btn-sm" onClick={exportExcel}>
            <Download size={14} /> Export Excel
          </button>
        </div>
      </div>

      {failed ? (
        <div className="card"><div className="empty">Could not load the monthly plan.</div></div>
      ) : !data ? (
        <Loading label="Loading the monthly plan" />
      ) : (
        <>
          <div className="mp-attention" aria-label="Needs attention">
            <span className="mp-attention-title">Needs attention · {attention.length}</span>
            {attention.length === 0 && <span className="dim">Nothing waiting on you.</span>}
            {attention.map((n) => (
              <button
                key={`${n.kind}-${n.stream}-${n.contractor_id}-${n.shamsi_year}-${n.shamsi_month}`}
                type="button"
                className="mp-chip"
                data-kind={n.kind}
                onClick={() =>
                  setDrawer({
                    contractorId: n.contractor_id,
                    name: n.name,
                    stream: n.stream,
                    year: n.shamsi_year,
                    month: n.shamsi_month,
                  })
                }
              >
                <i style={{ background: ATTENTION_COLOR[n.kind] || 'var(--text-dim)' }} aria-hidden="true" />
                <b>{n.name}</b>
                <span>{n.label}</span>
              </button>
            ))}
          </div>

          <div className="mp-halves">
            {['dt', 'acceptance'].map((key) => (
              <StreamPanel
                key={key}
                meta={STREAM_META[key]}
                data={data[key]}
                view={view}
                period={period}
                canSetTarget={canSetTarget}
                onTargetSaved={load}
                onOpen={(row) =>
                  setDrawer({
                    contractorId: row.contractor_id,
                    name: row.name,
                    stream: STREAM_META[key].stream,
                    year: data.months[data.months.length - 1].shamsi_year,
                    month: data.months[data.months.length - 1].shamsi_month,
                  })
                }
              />
            ))}
          </div>
        </>
      )}

      {drawer && (
        <DecisionDrawer
          target={drawer}
          canDecide={canDecide}
          onClose={() => setDrawer(null)}
          onDecided={load}
        />
      )}
    </div>
  )
}
