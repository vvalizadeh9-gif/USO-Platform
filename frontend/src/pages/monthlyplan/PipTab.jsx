import { CalendarRange, PackageCheck, Target, Users, Building2 } from 'lucide-react'
import { useState } from 'react'
import { Card, KpiCard, Loading, Meter } from '../../components/ui'
import SetTargetForm from './SetTargetForm'
import { sharePercent } from './figures'

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))
const TREND_MONTHS = 7

/** A share to one decimal, dropped when it is zero: 26.7%, 40%. */
const oneDecimal = (part, whole) =>
  whole ? `${((100 * part) / whole).toLocaleString('en-US', { maximumFractionDigits: 1 })}%` : '—'

/** Where `value` sits on a track that ends at `whole`, 0-100. */
const along = (value, whole) => (100 * value) / Math.max(1, whole)

/**
 * The PIP vs Achieved tab: one stream of GET /pip/overview at a time -- four
 * KPI cards, then the contractors beside the last seven months, filling the
 * rest of the screen.
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
        stream={stream}
        isRunning={isRunning}
        internal={
          canSeeInternal && (
            <InternalKpi meta={meta} kpis={stream.kpis} view={view} period={period} canSetTarget={canSetTarget} onSaved={onTargetSaved} />
          )
        }
      />
      <div className="pv-body">
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
    </div>
  )
}

// ---------------------------------------------------------------------- KPIs
function Kpis({ meta, stream, isRunning, internal }) {
  const { kpis, rows } = stream
  return (
    <div className="pv-kpis">
      {meta.hasAssignment && (
        <KpiCard
          icon={Users}
          title="Assignment"
          figure={fmt(kpis.assignment)}
          aside={`${rows.length} contractor${rows.length === 1 ? '' : 's'}`}
        />
      )}
      {internal}
      <KpiCard icon={Target} title="Contractor PIP" figure={fmt(kpis.contractor_pip)} aside={pipNote(meta, kpis)} />
      <DeliveredKpi kpis={kpis} isRunning={isRunning} />
    </div>
  )
}

function pipNote(meta, kpis) {
  if (kpis.internal_pip && kpis.contractor_pip != null) {
    return `${sharePercent(kpis.contractor_pip, kpis.internal_pip)}% of Internal PIP`
  }
  if (meta.hasAssignment && kpis.contractor_pip != null && kpis.assignment) {
    return `${sharePercent(kpis.contractor_pip, kpis.assignment)}% of assignment`
  }
  return kpis.contractor_pip == null ? 'no plan approved' : 'approved plans in force'
}

/** Delivered against the contractors' PIP: the share on an accent bar, the
 * tick at where an even pace would have it today, and the pace in words --
 * neutral text, not a colour: a KPI card's change is ink. */
function DeliveredKpi({ kpis, isRunning }) {
  const pip = kpis.contractor_pip
  const running = isRunning && kpis.expected_by_today != null
  return (
    <KpiCard
      icon={PackageCheck}
      title="Delivered"
      figure={fmt(kpis.delivered)}
      aside={running ? <PaceWords diff={kpis.pace_diff} /> : pip ? `${oneDecimal(kpis.delivered, pip)} of PIP` : 'no PIP to measure against'}
    >
      {pip ? (
        <div className="kpi-card-meter">
          <Meter
            value={along(kpis.delivered, pip)}
            tick={running ? along(kpis.expected_by_today, pip) : null}
            label={`Delivered ${oneDecimal(kpis.delivered, pip)} of PIP${
              running ? `, ${fmt(kpis.expected_by_today)} expected by today` : ''
            }`}
          />
          <span className="kpi-card-pct tnum">{oneDecimal(kpis.delivered, pip)}</span>
        </div>
      ) : null}
    </KpiCard>
  )
}

function PaceWords({ diff }) {
  if (diff == null) return null
  if (diff === 0) return 'on pace'
  return (
    <>
      <b className="tnum">{diff > 0 ? `+${fmt(diff)}` : `−${fmt(-diff)}`}</b>
      {diff > 0 ? ' ahead of pace' : ' behind pace'}
    </>
  )
}

/** The Internal PIP: "Not set" rather than 0, marked Internal, and for the
 * PM an Edit button that opens the editor for the stream. */
function InternalKpi({ meta, kpis, view, period, canSetTarget, onSaved }) {
  const [open, setOpen] = useState(false)
  const set = kpis.internal_pip != null
  return (
    <KpiCard
      icon={Building2}
      title="Internal PIP"
      className="pv-internal"
      badge={<span className="pill pill-dim">Internal</span>}
      figure={set ? fmt(kpis.internal_pip) : <span className="pv-unset">Not set</span>}
      aside={
        canSetTarget && (
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => setOpen((o) => !o)}
            aria-label={`Set the ${meta.title} Internal PIP`}
          >
            Edit
          </button>
        )
      }
    >
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
    </KpiCard>
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
  const noPlanWords = view === 'month' ? 'Plan not filed' : 'No plan this period'
  return (
    <Card className="card-fill pv-card" icon={Users} title="By contractor" titleAs="h2">
      <div className="table-scroll">
        <table className="table table-compact pv-table" aria-label={`${meta.title} by contractor`}>
          <thead>
            <tr>
              <th>Contractor</th>
              <th className="num">PIP</th>
              <th className="num">Delivered</th>
              <th>Progress against PIP</th>
              {isRunning && <th>Pace today</th>}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.contractor_id} data-contractor={r.contractor_id}>
                <th scope="row">
                  <button type="button" className="pv-name" onClick={() => onOpen(r)}>{r.name}</button>
                  {meta.hasAssignment && <span className="pv-sub tnum">{fmt(r.assignment)} assigned</span>}
                </th>
                <td className="num">{fmt(r.pip)}</td>
                <td className="num">{fmt(r.delivered)}</td>
                <td>
                  {r.pip == null ? (
                    isRunning ? <span className="pv-none">—</span> : <NoPlanPill words={noPlanWords} />
                  ) : (
                    <Progress delivered={r.delivered} pip={r.pip} expected={isRunning ? r.expected_by_today : null} />
                  )}
                </td>
                {isRunning && (
                  <td>{r.pip == null ? <NoPlanPill words={noPlanWords} /> : <PacePill diff={r.pace_diff} />}</td>
                )}
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={isRunning ? 5 : 4} className="pv-none">No contractors in this period.</td>
              </tr>
            )}
          </tbody>
          <tfoot>
            <tr className="pv-total">
              <th scope="row">
                All contractors
                {meta.hasAssignment && <span className="pv-sub tnum">{fmt(all.assignment)} assigned</span>}
              </th>
              <td className="num">{fmt(all.pip)}</td>
              <td className="num">{fmt(all.delivered)}</td>
              <td>
                {all.pip == null ? (
                  <span className="pv-none">—</span>
                ) : (
                  <Progress delivered={all.delivered} pip={all.pip} expected={isRunning ? stream.kpis.expected_by_today : null} />
                )}
              </td>
              {isRunning && <td><PacePill diff={stream.kpis.pace_diff} /></td>}
            </tr>
          </tfoot>
        </table>
      </div>
    </Card>
  )
}

/** Delivered against the row's own PIP: a 110px accent bar with a tick at
 * expected-by-today, and the share. */
function Progress({ delivered, pip, expected }) {
  return (
    <span className="pv-progress">
      <Meter
        className="pv-meter"
        value={along(delivered, pip)}
        tick={expected != null ? along(expected, pip) : null}
        label={`${fmt(delivered)} of ${fmt(pip)}`}
      />
      <span className="pv-pct tnum">{sharePercent(delivered, pip)}%</span>
    </span>
  )
}

/** A status: ink on its soft fill, with the words. */
function PacePill({ diff }) {
  if (diff == null) return <span className="pv-none">—</span>
  if (diff === 0) return <span className="pill pill-dim">On pace</span>
  return diff > 0 ? (
    <span className="pill pill-green tnum">+{fmt(diff)} ahead</span>
  ) : (
    <span className="pill pill-red tnum">−{fmt(-diff)} behind</span>
  )
}

function NoPlanPill({ words }) {
  return <span className="pill pill-amber">{words}</span>
}

// --------------------------------------------------------------------- trend
/** The last seven months for all contractors, one row per month: delivered
 * as a bar, the PIP as a 2px ink tick on the same scale. Met is the accent,
 * below the reference neutral, the running month an accent outline. */
function Trend({ trend }) {
  const max = Math.max(1, ...trend.map((p) => Math.max(p.pip ?? 0, p.delivered)))
  return (
    <Card className="pv-trend-card" icon={CalendarRange} title={`Last ${trend.length} months`} titleAs="h2">
      <ul className="pv-trend" role="img" aria-label="All contractors, delivered against PIP by month">
        {trend.map((p) => {
          const kind = p.in_progress ? 'running' : p.pip == null ? 'noplan' : p.delivered >= p.pip ? 'met' : 'below'
          return (
            <li key={`${p.shamsi_year}-${p.shamsi_month}`} className="pv-trend-row" data-kind={kind}>
              <span className="pv-trend-name">{p.shamsi_month_name}</span>
              <span className="pv-trend-track">
                <i className={`pv-trend-bar pv-trend-${kind}`} style={{ width: `${along(p.delivered, max)}%` }} />
                {p.pip != null && <i className="pv-trend-pip" style={{ left: `${along(p.pip, max)}%` }} />}
              </span>
              <span className="pv-trend-num tnum">{p.pip == null ? 'no plan' : `${fmt(p.delivered)} / ${fmt(p.pip)}`}</span>
            </li>
          )
        })}
      </ul>
      <div className="pv-legend" aria-label="Legend">
        <span><i className="pv-key-met" />Met</span>
        <span><i className="pv-key-below" />Below</span>
        <span><i className="pv-key-running" />Running</span>
        <span><i className="pv-key-pip" />PIP</span>
      </div>
    </Card>
  )
}
