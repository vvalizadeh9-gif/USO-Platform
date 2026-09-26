import { useState } from 'react'
import { SetTargetForm } from './AcceptanceTargetCard'
import { MISS } from './streams'

const fmt = (v) => (v == null ? '—' : Number(v).toLocaleString('en-US'))
const signed = (v) => (v == null ? '' : v > 0 ? `+${fmt(v)}` : v < 0 ? `−${fmt(Math.abs(v))}` : '±0')
const pct = (num, den) => (den ? Math.round((100 * num) / den) : null)

/**
 * One stream's half of the Monthly Plan page: KPI cards, the "This month"
 * list (All contractors first, then one row per contractor), and the last
 * 12 months for all contractors. The same component draws DT Delivery and
 * Acceptance; Acceptance has no Assignment, so it has one card fewer and no
 * Assignment band on its bars.
 */
export default function StreamPanel({ meta, data, view, period, canSetTarget, onTargetSaved, onOpen }) {
  const { kpis, all_contractors: all, rows, trend } = data
  const accent = meta.accent

  // One scale for every contractor row, so their bars compare; the All
  // contractors row is on a scale of its own.
  const rowMax = Math.max(1, ...rows.map((r) => Math.max(r.assignment ?? 0, r.pip ?? 0, r.delivered)))
  const allMax = Math.max(1, all.assignment ?? 0, all.pip ?? 0, all.delivered)

  return (
    <section className="card mp-half" style={{ borderTop: `4px solid ${accent}` }} aria-label={meta.title}>
      <div className="mp-half-head">
        <h2 style={{ color: accent }}>{meta.title}</h2>
        <span className="dim">{meta.unit}</span>
      </div>

      <div className={`mp-kpis ${meta.hasAssignment ? 'mp-kpis-4' : 'mp-kpis-3'}`}>
        {meta.hasAssignment && (
          <Kpi label="Assignment" value={fmt(kpis.assignment)}
            sub={kpis.contractor_pip != null && kpis.assignment ? `PIP is ${pct(kpis.contractor_pip, kpis.assignment)}% of it` : 'Sites held'} />
        )}
        <InternalKpi meta={meta} kpis={kpis} period={period} view={view} canSetTarget={canSetTarget} onSaved={onTargetSaved} />
        <Kpi
          label="Contractor PIP"
          value={fmt(kpis.contractor_pip)}
          sub={kpis.gap_vs_internal != null ? `${signed(kpis.gap_vs_internal)} vs internal` : 'Approved plans in force'}
          warn={kpis.gap_vs_internal != null && kpis.gap_vs_internal < 0}
        />
        <Kpi
          label="Delivered"
          value={fmt(kpis.delivered)}
          sub={
            view === 'month' && kpis.expected_by_today != null
              ? `By today ${fmt(kpis.expected_by_today)} (${signed(kpis.pace_diff)})`
              : kpis.achievement_percent != null
                ? `${kpis.achievement_percent}% of PIP`
                : 'No PIP to measure against'
          }
          warn={view === 'month' && kpis.pace_diff != null && kpis.pace_diff < 0}
        />
      </div>

      <div className="mp-list-head">
        <span className="mp-sec">{view === 'month' ? 'This month' : 'This period'}</span>
        <span className="mp-legend">
          {meta.hasAssignment && <span><i className="mp-key-band" />Assignment</span>}
          <span><i style={{ background: accent }} />Delivered</span>
          <span><i className="mp-key-tick" />PIP</span>
        </span>
      </div>

      <div className="mp-list" role="list">
        <div className="mp-row mp-row-all" role="listitem">
          <span className="mp-name">All contractors</span>
          <Bar row={all} max={allMax} accent={accent} hasAssignment={meta.hasAssignment} />
          <Figures delivered={all.delivered} pip={all.pip} diff={all.diff} />
          <span className="mp-status dim">{all.plans_approved} of {all.plans_total} plans approved</span>
          <Hit hit={all.hit_last_6} />
        </div>
        {rows.map((r) => (
          <button key={r.contractor_id} type="button" className="mp-row" role="listitem" onClick={() => onOpen(r)} data-contractor={r.contractor_id}>
            <span className="mp-name" title={r.name}>{r.name}</span>
            <Bar row={r} max={rowMax} accent={accent} hasAssignment={meta.hasAssignment} over={r.pip_above_assignment} />
            <Figures delivered={r.delivered} pip={r.pip} diff={r.diff} />
            <span className="mp-status"><PlanPill row={r} /></span>
            <Hit hit={r.hit_last_6} />
          </button>
        ))}
      </div>

      <div className="mp-list-head" style={{ marginTop: 10 }}>
        <span className="mp-sec">All contractors · last {trend.length} months</span>
        <span className="mp-legend">
          <span><i style={{ background: accent }} />Hit</span>
          <span><i style={{ background: MISS }} />Missed</span>
          <span><i className="mp-key-tick" />PIP</span>
        </span>
      </div>
      <TrendChart trend={trend} accent={accent} />
    </section>
  )
}

function Kpi({ label, value, sub, warn, children }) {
  return (
    <div className="mp-kpi">
      <div className="mp-kpi-label">{label}</div>
      <div className="mp-kpi-value tnum">{value}</div>
      <div className="mp-kpi-sub" style={warn ? { color: 'var(--amber)', fontWeight: 600 } : undefined}>{sub}</div>
      {children}
    </div>
  )
}

/** MTN's internal target for this stream. "Not set" rather than 0, and for
 * the PM a Set link that opens the existing target editor for the stream. */
function InternalKpi({ meta, kpis, period, view, canSetTarget, onSaved }) {
  const [open, setOpen] = useState(false)
  const set = kpis.internal_pip != null
  return (
    <div className="mp-kpi" style={{ position: 'relative' }}>
      <div className="mp-kpi-label">MTN internal PIP</div>
      <div className="mp-kpi-value tnum">{set ? fmt(kpis.internal_pip) : <span className="dim" style={{ fontSize: 15 }}>Not set</span>}</div>
      <div className="mp-kpi-sub">
        Target to management
        {canSetTarget && (
          <>
            {' · '}
            <button type="button" className="mp-link" onClick={() => setOpen((o) => !o)} aria-label={`Set the ${meta.title} internal target`}>
              Set
            </button>
          </>
        )}
      </div>
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
    </div>
  )
}

/** Plain HTML/CSS bar: the Assignment band behind, Delivered in the accent,
 * and a black tick at PIP (orange when PIP is above Assignment). */
function Bar({ row, max, accent, hasAssignment, over }) {
  const at = (v) => `${Math.min(100, (100 * (v ?? 0)) / max)}%`
  return (
    <span className="mp-bar" aria-hidden="true">
      {hasAssignment && row.assignment != null && <i className="mp-bar-band" style={{ width: at(row.assignment) }} />}
      <i className="mp-bar-fill" style={{ width: at(row.delivered), background: accent }} />
      {row.pip != null && <i className={`mp-bar-tick ${over ? 'mp-bar-tick-over' : ''}`} style={{ left: at(row.pip) }} />}
    </span>
  )
}

function Figures({ delivered, pip, diff }) {
  return (
    <span className="mp-figs tnum">
      <b>{fmt(delivered)}</b> / {fmt(pip)}{' '}
      {diff != null && <span className={diff < 0 ? 'mp-neg' : 'mp-pos'}>{signed(diff)}</span>}
    </span>
  )
}

function Hit({ hit }) {
  return <span className="mp-hit tnum" title="Closed months where Delivered reached PIP">Hit {hit.hit}/{hit.of}</span>
}

/** The row's plan state as a pill. PIP > assignment outranks Approved. */
function PlanPill({ row }) {
  if (row.status === 'not_submitted') return <span className="pill mp-pill-solid">Not submitted</span>
  if (row.pip_above_assignment && row.status === 'approved') {
    return <span className="pill mp-pill-solid">PIP &gt; assignment</span>
  }
  switch (row.status) {
    case 'approved':
      return <span className="pill pill-green">Approved{row.in_force_version > 1 ? ` · v${row.in_force_version}` : ''}</span>
    case 'awaiting_approval':
      return <span className="pill mp-pill-blue">Awaiting approval</span>
    case 'returned':
      return <span className="pill pill-amber">Returned</span>
    case 'revision_requested':
      return <span className="pill pill-violet">Revision {row.revision_from}→{row.revision_to}</span>
    default:
      return <span className="pill pill-dim">{row.status}</span>
  }
}

/** Twelve columns: delivered/pip above, the Delivered bar (accent when hit,
 * MISS when missed, lighter for the running month), a black PIP tick, and
 * the Persian month name under it. */
function TrendChart({ trend, accent }) {
  const max = Math.max(1, ...trend.map((p) => Math.max(p.pip ?? 0, p.delivered)))
  return (
    <div className="mp-trend" role="img" aria-label="All contractors, delivered against PIP by month">
      {trend.map((p) => {
        const color = p.in_progress ? accent : p.pip == null ? 'var(--dt-notstarted)' : p.hit ? accent : MISS
        return (
          <div key={`${p.shamsi_year}-${p.shamsi_month}`} className="mp-col" data-hit={p.hit} data-running={p.in_progress}>
            <span className="mp-col-num tnum">{fmt(p.delivered)}/{fmt(p.pip)}</span>
            <span className="mp-col-plot">
              <i className="mp-col-bar" style={{ height: `${(100 * p.delivered) / max}%`, background: color, opacity: p.in_progress ? 0.45 : 1 }} />
              {p.pip != null && <i className="mp-col-tick" style={{ bottom: `${(100 * p.pip) / max}%` }} />}
            </span>
            <span className={`mp-col-name ${p.in_progress ? 'mp-col-now' : ''}`}>{p.shamsi_month_name}</span>
          </div>
        )
      })}
    </div>
  )
}
