import { useState } from 'react'
import { Card, Loading } from '../../components/ui'
import { SetTargetForm } from './AcceptanceTargetCard'
import { sharePercent } from './figures'

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))
const TREND_MONTHS = 7

/**
 * The PIP vs Achieved tab: one stream of GET /pip/overview at a time -- KPI
 * cards, one row per contractor, and the last seven months for all of them.
 *
 * Every figure is the server's. The only arithmetic here is delivered as a
 * share of PIP (figures.sharePercent), taken from totals for a year or since
 * start -- the rows are already period totals, so it is never an average of
 * monthly percentages. "Expected by today" (the tick) and Pace are shown for
 * the running month only.
 */
export default function PipTab({ data, failed, meta, view, period, canSetTarget, canSeeInternal, onTargetSaved, onOpen }) {
  if (failed) {
    return <div className="card"><div className="empty">Could not load the monthly plan.</div></div>
  }
  if (!data) return <Loading label="Loading the monthly plan" />

  const stream = data[meta.key]
  const isRunning =
    view === 'month' && data.shamsi_year === data.running_year && data.shamsi_month === data.running_month
  const last = data.months[data.months.length - 1]

  return (
    <div className="pv-tab" data-stream={meta.stream}>
      <Kpis
        meta={meta}
        kpis={stream.kpis}
        isRunning={isRunning}
        internal={
          canSeeInternal && (
            <InternalKpi meta={meta} kpis={stream.kpis} view={view} period={period} canSetTarget={canSetTarget} onSaved={onTargetSaved} />
          )
        }
      />
      <ContractorTable
        meta={meta}
        stream={stream}
        view={view}
        isRunning={isRunning}
        onOpen={(row) =>
          onOpen({ contractorId: row.contractor_id, name: row.name, stream: meta.stream, year: last.shamsi_year, month: last.shamsi_month })
        }
      />
      <Trend trend={stream.trend.slice(-TREND_MONTHS)} />
    </div>
  )
}

// ---------------------------------------------------------------------- KPIs
function Kpis({ meta, kpis, isRunning, internal }) {
  return (
    <div className="pv-kpis">
      {meta.hasAssignment && <Kpi label="Assignment" value={fmt(kpis.assignment)} note="sites held" />}
      {internal}
      <Kpi label="Contractor PIP" value={fmt(kpis.contractor_pip)} note={pipNote(meta, kpis)} />
      <Kpi label="Delivered" value={fmt(kpis.delivered)} note={deliveredNote(kpis, isRunning)} warn={isRunning && kpis.pace_diff < 0} />
    </div>
  )
}

function Kpi({ label, value, note, warn, children }) {
  return (
    <div className="pv-kpi">
      <div className="pv-kpi-label">{label}</div>
      <div className="pv-kpi-line">
        <span className="pv-kpi-value tnum">{value}</span>
        {note && <span className={`pv-kpi-note ${warn ? 'pv-warn' : ''}`}>{note}</span>}
      </div>
      {children}
    </div>
  )
}

function pipNote(meta, kpis) {
  const gap = kpis.gap_vs_internal
  if (gap != null) {
    return gap < 0 ? `${fmt(-gap)} below internal` : gap > 0 ? `${fmt(gap)} above internal` : 'matches internal'
  }
  if (meta.hasAssignment && kpis.contractor_pip != null && kpis.assignment) {
    return `${sharePercent(kpis.contractor_pip, kpis.assignment)}% of assignment`
  }
  return kpis.contractor_pip == null ? 'no plan approved' : 'approved plans in force'
}

function deliveredNote(kpis, isRunning) {
  if (isRunning && kpis.expected_by_today != null) {
    const d = kpis.pace_diff
    const target = `today’s target of ${fmt(kpis.expected_by_today)}`
    return d < 0 ? `${fmt(-d)} behind ${target}` : d > 0 ? `${fmt(d)} ahead of ${target}` : `on ${target}`
  }
  const share = sharePercent(kpis.delivered, kpis.contractor_pip)
  return share == null ? 'no PIP to measure against' : `${share}% of PIP`
}

/** MTN's internal target: "Not set" rather than 0, and for the PM a Set link
 * that opens the existing target editor for the stream. */
function InternalKpi({ meta, kpis, view, period, canSetTarget, onSaved }) {
  const [open, setOpen] = useState(false)
  const set = kpis.internal_pip != null
  return (
    <Kpi label="MTN internal PIP" value={set ? fmt(kpis.internal_pip) : <span className="pv-unset">Not set</span>} note="target to management">
      {canSetTarget && (
        <button type="button" className="pv-link" onClick={() => setOpen((o) => !o)} aria-label={`Set the ${meta.title} internal target`}>
          Set
        </button>
      )}
      {open && (
        <SetTargetForm
          stream={meta.stream}
          initialPeriod={view === 'month' ? period : undefined}
          onClose={() => setOpen(false)}
          onSaved={() => {
            setOpen(false)
            onSaved?.()
          }}
        />
      )}
    </Kpi>
  )
}

// --------------------------------------------------------------------- table
/** Lowest share of PIP first; a contractor with no plan goes last. */
function sortRows(rows) {
  const share = (r) => sharePercent(r.delivered, r.pip)
  return [...rows].sort((a, b) => {
    const sa = share(a)
    const sb = share(b)
    if (sa == null || sb == null) return (sa == null) - (sb == null) || (a.name || '').localeCompare(b.name || '')
    return sa - sb || (a.name || '').localeCompare(b.name || '')
  })
}

function ContractorTable({ meta, stream, view, isRunning, onOpen }) {
  const rows = sortRows(stream.rows)
  const all = stream.all_contractors
  const noPlan = view === 'month' ? 'no plan this month' : 'no plan this period'
  return (
    <Card className="pv-card">
      <div className="pv-table-wrap">
        <table className="table table-compact pv-table" aria-label={`${meta.title} by contractor`}>
          <thead>
            <tr>
              <th>Contractor</th>
              {meta.hasAssignment && <th className="num">Assignment</th>}
              <th className="num">PIP</th>
              <th>Delivered</th>
              <th className="num">% of PIP</th>
              {isRunning && <th>Pace</th>}
              <th className="num">Met last 6</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.contractor_id} data-contractor={r.contractor_id}>
                <th scope="row">
                  <button type="button" className="pv-name" onClick={() => onOpen(r)}>{r.name}</button>
                </th>
                {meta.hasAssignment && <td className="num">{fmt(r.assignment)}</td>}
                {r.pip == null ? (
                  <>
                    <td className="num">—</td>
                    <td className="pv-delivered-plain tnum">{fmt(r.delivered)} delivered</td>
                    <td className="num pv-noplan" colSpan={isRunning ? 2 : 1}>{noPlan}</td>
                  </>
                ) : (
                  <>
                    <td className="num">{fmt(r.pip)}</td>
                    <td><DeliveredBar delivered={r.delivered} pip={r.pip} expected={isRunning ? r.expected_by_today : null} /></td>
                    <td className="num">{sharePercent(r.delivered, r.pip)}%</td>
                    {isRunning && <td><Pace diff={r.pace_diff} /></td>}
                  </>
                )}
                <td className="num"><Met hit={r.hit_last_6} /></td>
              </tr>
            ))}
          </tbody>
          <tfoot>
            <tr className="pv-total">
              <th scope="row">All contractors</th>
              {meta.hasAssignment && <td className="num">{fmt(all.assignment)}</td>}
              <td className="num">{fmt(all.pip)}</td>
              <td>
                {all.pip == null ? (
                  <span className="tnum">{fmt(all.delivered)} delivered</span>
                ) : (
                  <DeliveredBar delivered={all.delivered} pip={all.pip} expected={isRunning ? stream.kpis.expected_by_today : null} />
                )}
              </td>
              <td className="num">{all.pip == null ? '—' : `${sharePercent(all.delivered, all.pip)}%`}</td>
              {isRunning && <td><Pace diff={stream.kpis.pace_diff} /></td>}
              <td className="num"><Met hit={all.hit_last_6} /></td>
            </tr>
          </tfoot>
        </table>
        {rows.length === 0 && <div className="empty">No contractors in this period.</div>}
      </div>
    </Card>
  )
}

/** Delivered against the row's own PIP, with a tick at expected-by-today. */
function DeliveredBar({ delivered, pip, expected }) {
  const at = (v) => `${Math.min(100, (100 * v) / Math.max(1, pip))}%`
  return (
    <span className="pv-bar-cell">
      <span className="pv-bar" aria-hidden="true">
        <i className="pv-bar-fill" style={{ width: at(delivered) }} />
        {expected != null && <i className="pv-bar-tick" data-testid="pv-tick" style={{ left: at(expected) }} />}
      </span>
      <span className="pv-bar-text tnum">{fmt(delivered)} of {fmt(pip)}</span>
    </span>
  )
}

function Pace({ diff }) {
  if (diff == null) return <span className="dim">—</span>
  if (diff === 0) return <span>On pace</span>
  return diff < 0 ? <span className="pv-warn">{fmt(-diff)} behind</span> : <span>{fmt(diff)} ahead</span>
}

function Met({ hit }) {
  if (!hit?.of) return <span className="dim">—</span>
  return <span className="tnum">{hit.hit} of {hit.of}</span>
}

// --------------------------------------------------------------------- trend
function Trend({ trend }) {
  const max = Math.max(1, ...trend.map((p) => Math.max(p.pip ?? 0, p.delivered)))
  return (
    <Card className="pv-card">
      <div className="pv-trend-head">
        <span className="pv-card-title">All contractors · last {trend.length} months</span>
        <span className="pv-legend">
          <span><i className="pv-key-met" />met</span>
          <span><i className="pv-key-below" />below</span>
          <span><i className="pv-key-pip" />PIP</span>
        </span>
      </div>
      <div className="pv-trend" role="img" aria-label="All contractors, delivered against PIP by month">
        {trend.map((p) => {
          const kind = p.in_progress ? 'running' : p.pip == null ? 'noplan' : p.delivered >= p.pip ? 'met' : 'below'
          return (
            <div key={`${p.shamsi_year}-${p.shamsi_month}`} className="pv-col" data-kind={kind}>
              <span className="pv-col-plot">
                <i className={`pv-col-bar pv-col-${kind}`} style={{ height: `${(100 * p.delivered) / max}%` }} />
                {p.pip != null && <i className="pv-col-pip" style={{ bottom: `${(100 * p.pip) / max}%` }} />}
              </span>
              <span className="pv-col-name">{p.shamsi_month_name}</span>
              <span className="pv-col-num tnum">{p.pip == null ? 'no plan' : `${fmt(p.delivered)} / ${fmt(p.pip)}`}</span>
            </div>
          )
        })}
      </div>
    </Card>
  )
}
