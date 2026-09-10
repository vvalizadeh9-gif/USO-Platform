import { motion } from 'framer-motion'
import { ChevronRight, Download, History } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading, fadeUp, stagger } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import Revisions from './Revisions'

/**
 * Commitment against delivery, month by month.
 *
 * The screen above this one asks a contractor for a number. This says whether
 * the numbers they have been giving are worth anything, which is a different
 * question and the one asked at renewal.
 *
 * Three figures per month and one ratio between each pair:
 *
 *   PIP ──coverage──▶ Available ──execution──▶ Delivered
 *
 * Achievement, delivered over PIP, is the headline. On its own it blames the
 * wrong party: a contractor who committed to twelve, was handed four, and did
 * all four reads as a 33% failure. Coverage says whether the work was handed
 * over at all, and execution says what happened to the work that was — so a
 * bad month can be attributed rather than only noticed.
 *
 * ``available`` is a balance, not a flow: a site open for three months is in
 * all three months' figure. That is the point of it and also why the column
 * is never totalled — the server says which columns may be, and this component
 * asks rather than assuming.
 */
export default function Scorecard({ canSeeAllContractors }) {
  const toast = useToast()
  const [data, setData] = useState(null)
  const [failed, setFailed] = useState(false)
  const [range, setRange] = useState({ months: 12 })
  const [openMonth, setOpenMonth] = useState(null)
  const [revisions, setRevisions] = useState(null)

  const load = useCallback(() => {
    setFailed(false)
    api
      .get('/pip/scorecard', { params: range })
      .then((r) => setData(r.data))
      .catch(() => {
        setFailed(true)
        setData(null)
      })
  }, [range])

  useEffect(load, [load])
  // A different window is a different set of months; a row opened in the old
  // one points at a month that is not on screen any more.
  useEffect(() => setOpenMonth(null), [range])

  if (failed) {
    return (
      <div className="card">
        <div className="empty">Could not load the scorecard.</div>
      </div>
    )
  }
  if (!data) return <Loading label="Loading the scorecard" />
  // Optional-chained rather than trusting the shape: this section sits above
  // the form somebody came here to fill in, and a payload that arrives without
  // months must cost them the scorecard, not the page.
  if (!data.months?.length) {
    return <EmptyState title="Nothing to show yet" hint="No months in this range." />
  }

  const months = data.months
  const totals = totalsOf(months, data.summable)

  async function download() {
    try {
      const r = await api.get('/pip/scorecard.xlsx', {
        params: range,
        responseType: 'blob',
      })
      const url = URL.createObjectURL(r.data)
      const link = document.createElement('a')
      link.href = url
      link.download = filenameFrom(r.headers['content-disposition']) || 'pip-scorecard.xlsx'
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Could not build the file', 'Please try again.')
    }
  }

  return (
    <motion.div variants={stagger} initial="hidden" animate="show">
      <motion.div variants={fadeUp} className="row wrap" style={{ gap: 10, marginBottom: 16 }}>
        <RangePicker range={range} onChange={setRange} months={months} />
        <div className="spacer" />
        <button className="btn btn-sm" onClick={download}>
          <Download size={14} /> Export to Excel
        </button>
      </motion.div>

      <motion.div variants={fadeUp}>
        <Funnel current={months[months.length - 1]} />
      </motion.div>

      <motion.div variants={fadeUp} className="card mt-16">
        <div style={{ padding: '18px 20px 4px' }}>
          <h3 style={{ fontSize: 15 }}>Commitment against delivery</h3>
          <div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>
            Each month: what was available to work on, what was delivered, and the
            approved plan as the target.
          </div>
        </div>
        <DeliveryChart months={months} />
      </motion.div>

      <motion.div variants={fadeUp} className="card mt-16">
        <div style={{ padding: '18px 20px 14px' }}>
          <h3 style={{ fontSize: 15 }}>Month by month</h3>
          <div className="dim" style={{ fontSize: 12.5, marginTop: 3 }}>
            {canSeeAllContractors
              ? 'Open a month to see every subcontractor in it.'
              : 'Your own figures. No other company appears here.'}
          </div>
        </div>
        <MonthGrid
          months={months}
          totals={totals}
          balances={data.balances}
          expandable={canSeeAllContractors}
          openMonth={openMonth}
          onOpen={setOpenMonth}
          onRevisions={setRevisions}
          isContractor={data.is_contractor}
        />
      </motion.div>

      {revisions && (
        <Revisions
          period={revisions}
          isContractor={data.is_contractor}
          onClose={() => setRevisions(null)}
        />
      )}
    </motion.div>
  )
}

/** Totals for the flow columns only.
 *
 *  Which those are is the server's answer, not a list repeated here: adding a
 *  balance down the page counts a site once for every month it stayed open,
 *  and the one place that rule is written down should be the one place it can
 *  be got wrong.
 */
function totalsOf(months, summable) {
  const out = {}
  for (const field of summable) {
    out[field] = months.reduce((sum, m) => sum + (m[field] || 0), 0)
  }
  out.achievement_percent = percent(out.delivered, out.pip)
  return out
}

function percent(part, whole) {
  if (!whole) return null
  return Math.round((part / whole) * 1000) / 10
}

// The platform's three achievement bands, unchanged from plan-and-delivery.
function bandColor(value) {
  if (value == null) return 'var(--text-dim)'
  if (value >= 100) return 'var(--green)'
  if (value >= 80) return 'var(--amber)'
  return 'var(--red)'
}

function filenameFrom(disposition) {
  const match = /filename="([^"]+)"/.exec(disposition || '')
  return match ? match[1] : null
}

/** Rolling window, or a whole Shamsi year.
 *
 *  Rolling is the default because year-to-date in فروردین is one month long,
 *  and one month is not a record of anything.
 */
function RangePicker({ range, onChange, months }) {
  const thisYear = months[months.length - 1]?.shamsi_year
  const options = [
    { label: 'Last 12 months', value: { months: 12 } },
    { label: String(thisYear), value: { year: thisYear } },
    { label: String(thisYear - 1), value: { year: thisYear - 1 } },
  ]
  const active = (option) =>
    JSON.stringify(option.value) === JSON.stringify(range)

  return (
    <div className="row wrap" style={{ gap: 6 }}>
      {options.map((option) => (
        <button
          key={option.label}
          className={`btn btn-sm ${active(option) ? '' : 'btn-ghost'}`}
          aria-pressed={active(option)}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
      <span className="dim" style={{ fontSize: 12.5, marginInlineStart: 4 }}>
        {months[0].shamsi_month_name} {months[0].shamsi_year} —{' '}
        {months[months.length - 1].shamsi_month_name}{' '}
        {months[months.length - 1].shamsi_year}
      </span>
    </div>
  )
}

/** PIP → Available → Delivered, with the two rates that separate the causes.
 *
 *  The window's figures, not the month's — except for the sentence underneath,
 *  which says which of the two the current month is, because that is the one
 *  somebody is about to act on.
 */
function Funnel({ current }) {
  const coverage = percent(current.available, current.pip)
  const execution = percent(current.delivered, current.available)
  const achievement = percent(current.delivered, current.pip)

  return (
    <div className="card card-pad">
      <div className="row wrap" style={{ gap: 10, marginBottom: 14 }}>
        <h3 style={{ fontSize: 15 }}>Where the shortfall is</h3>
        <span className="dim" style={{ fontSize: 12.5 }}>
          {current.shamsi_month_name} {current.shamsi_year}
        </span>
      </div>

      <div className="row wrap" style={{ gap: 0, alignItems: 'stretch' }}>
        <FunnelStep label="PIP committed" value={current.pip} />
        <FunnelRate label="Coverage" value={coverage} tone={coverage >= 95 ? 'var(--green)' : 'var(--amber)'} />
        <FunnelStep label="Available to work" value={current.available} />
        <FunnelRate label="Execution" value={execution} tone={bandColor(execution)} />
        <FunnelStep label="Delivered" value={current.delivered} />
      </div>

      <p className="muted" style={{ fontSize: 12.5, marginTop: 12, lineHeight: 1.6 }}>
        {explain(current, achievement, coverage, execution)}
      </p>
    </div>
  )
}

/** One sentence saying what this month's numbers mean, in the reader's terms.
 *
 *  Written out rather than left to be inferred, because the inference people
 *  actually make from a low achievement is "the contractor failed", and that
 *  is only one of the two things it can mean.
 */
function explain(month, achievement, coverage, execution) {
  if (month.pip === 0) {
    return 'No approved plan this month, so there is no achievement to measure — not an achievement of zero.'
  }
  if (coverage != null && coverage < 90) {
    return `Only ${month.available} of the ${month.pip} committed were available to work on, so an achievement of ${fmt(achievement)} is partly an assignment gap rather than a delivery one. Against the work actually handed over, execution was ${fmt(execution)}.`
  }
  if (execution != null && execution < 80) {
    return `There was enough work in hand (${month.available} against a plan of ${month.pip}), and ${month.delivered} of it was delivered. The shortfall is in execution, not in what was assigned.`
  }
  return `${month.delivered} delivered against a plan of ${month.pip}, from ${month.available} available to work on.`
}

function fmt(value) {
  return value == null ? '—' : `${value}%`
}

function FunnelStep({ label, value }) {
  return (
    <div
      style={{
        flex: '1 1 140px',
        background: 'var(--surface-2)',
        border: '1px solid var(--border-soft)',
        borderRadius: 'var(--radius-sm)',
        padding: '13px 16px',
      }}
    >
      <div className="dim" style={{ fontSize: 11.5, fontWeight: 500 }}>{label}</div>
      <div className="tnum" style={{ fontFamily: 'var(--font-display)', fontSize: 24, fontWeight: 600, marginTop: 4 }}>
        {value}
      </div>
    </div>
  )
}

function FunnelRate({ label, value, tone }) {
  return (
    <div
      className="row"
      style={{ flex: '0 0 auto', flexDirection: 'column', justifyContent: 'center', gap: 1, padding: '0 14px' }}
    >
      <b style={{ fontFamily: 'var(--font-display)', fontSize: 15, color: value == null ? 'var(--text-dim)' : tone }}>
        {fmt(value)}
      </b>
      <small style={{ fontSize: 10.5, letterSpacing: '0.05em', textTransform: 'uppercase', color: 'var(--text-dim)', fontWeight: 600 }}>
        {label}
      </small>
    </div>
  )
}

/** Available as the range, delivered as the bar inside it, PIP as the target.
 *
 *  Drawn rather than handed to the chart library the rest of this page uses:
 *  three marks per month on one scale is a bullet chart, and recharts would
 *  need a second y-axis or a stack to express it, either of which says
 *  something about the data that is not true.
 *
 *  Only the last month is labelled. A number on every mark is unreadable at
 *  twelve months, and the axis and the table below carry the rest.
 */
function DeliveryChart({ months }) {
  const width = 900
  const height = 250
  const padLeft = 38
  const padBottom = 44
  const padTop = 16
  const plotHeight = height - padBottom - padTop
  const plotWidth = width - padLeft - 14

  const max = Math.max(
    1,
    ...months.map((m) => Math.max(m.pip, m.available, m.delivered)),
  )
  const top = Math.ceil(max / 10) * 10 || 10
  const step = plotWidth / months.length
  const rangeWidth = Math.min(30, step * 0.62)
  const barWidth = rangeWidth * 0.5
  const y = (value) => padTop + plotHeight - (value / top) * plotHeight

  return (
    <div style={{ padding: '10px 20px 20px' }}>
      <div className="row wrap" style={{ gap: 16, fontSize: 12, color: 'var(--text-muted)', marginBottom: 8 }}>
        <LegendItem swatch="var(--violet-dim)" border="var(--violet)" label="Available" />
        <LegendItem swatch="var(--signal)" label="Delivered" />
        <span className="row" style={{ gap: 6 }}>
          <span style={{ width: 13, height: 2, background: 'var(--text)' }} />
          PIP target
        </span>
      </div>

      <svg
        viewBox={`0 0 ${width} ${height}`}
        width="100%"
        height={height}
        role="img"
        aria-label="Available, delivered and the approved plan for each month in the range"
      >
        {[0, top / 2, top].map((tick) => (
          <g key={tick}>
            <line x1={padLeft} y1={y(tick)} x2={width - 14} y2={y(tick)} stroke="var(--border)" />
            <text x={padLeft - 9} y={y(tick) + 4} textAnchor="end" fontSize="11.5" fill="var(--text-dim)">
              {tick}
            </text>
          </g>
        ))}

        {months.map((m, i) => {
          const centre = padLeft + step * i + step / 2
          const left = centre - rangeWidth / 2
          const label = `${m.shamsi_month_name} ${m.shamsi_year}`
          const last = i === months.length - 1
          return (
            <g key={label}>
              <title>
                {`${label} — plan ${m.pip}, available ${m.available}, delivered ${m.delivered}`}
              </title>
              <rect
                x={left}
                y={y(m.available)}
                width={rangeWidth}
                height={plotHeight - (y(m.available) - padTop)}
                rx="4"
                fill="var(--violet-dim)"
              />
              <rect
                data-testid="delivered-bar"
                x={centre - barWidth / 2}
                y={y(m.delivered)}
                width={barWidth}
                height={plotHeight - (y(m.delivered) - padTop)}
                rx="4"
                fill="var(--signal)"
              />
              {m.pip > 0 && (
                <line
                  data-testid="pip-target"
                  x1={left - 3}
                  y1={y(m.pip)}
                  x2={left + rangeWidth + 3}
                  y2={y(m.pip)}
                  stroke="var(--text)"
                  strokeWidth="2"
                  strokeLinecap="round"
                />
              )}
              {last && (
                <text x={centre} y={y(m.delivered) - 9} textAnchor="middle" fontSize="12" fontWeight="600" fill="var(--signal-strong)">
                  {m.delivered}
                </text>
              )}
              <text
                x={centre}
                y={height - padBottom + 17}
                textAnchor="end"
                fontSize="11.5"
                fill="var(--text-muted)"
                fontFamily="var(--font-farsi)"
                transform={`rotate(-34 ${centre} ${height - padBottom + 17})`}
              >
                {label}
              </text>
            </g>
          )
        })}
        <line x1={padLeft} y1={padTop + plotHeight} x2={width - 14} y2={padTop + plotHeight} stroke="var(--border)" />
      </svg>
    </div>
  )
}

function LegendItem({ swatch, border, label }) {
  return (
    <span className="row" style={{ gap: 6 }}>
      <span
        style={{
          width: 11,
          height: 11,
          borderRadius: 3,
          background: swatch,
          border: border ? `1px solid ${border}` : undefined,
        }}
      />
      {label}
    </span>
  )
}

function MonthGrid({
  months, totals, balances, expandable, openMonth, onOpen, onRevisions, isContractor,
}) {
  const key = (m) => `${m.shamsi_year}-${m.shamsi_month}`

  return (
    <>
      <div className="table-wrap" style={{ border: 'none', borderRadius: 0, boxShadow: 'none', overflowX: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Month</th>
              <th style={{ textAlign: 'right' }}>PIP</th>
              <th style={{ textAlign: 'right' }}>Available</th>
              <th style={{ textAlign: 'right' }}>Delivered</th>
              <th style={{ textAlign: 'right', minWidth: 150 }}>Achievement</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {months.map((m) => {
              const open = openMonth === key(m)
              return (
                <MonthRows
                  key={key(m)}
                  month={m}
                  open={open}
                  expandable={expandable}
                  onToggle={() => onOpen(open ? null : key(m))}
                  onRevisions={onRevisions}
                  isContractor={isContractor}
                />
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ background: 'var(--surface-2)', borderTop: '1px solid var(--border)' }}>
              <td style={{ padding: '13px 16px', fontWeight: 600 }}>
                Total — {months.length} month{months.length === 1 ? '' : 's'}
              </td>
              <td className="tnum" style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 600 }}>
                {totals.pip}
              </td>
              {/* A balance, so there is nothing to add up. Spelled with a dash
                  and explained below rather than left blank, because a blank
                  cell in a totals row reads as a number somebody forgot. */}
              <td className="tnum dim" style={{ padding: '13px 16px', textAlign: 'right' }} title="A balance, not a flow — see the note below">
                —
              </td>
              <td className="tnum" style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 600 }}>
                {totals.delivered}
              </td>
              <td style={{ padding: '13px 16px', textAlign: 'right', fontWeight: 600, color: bandColor(totals.achievement_percent) }}>
                {fmt(totals.achievement_percent)}
              </td>
              <td />
            </tr>
          </tfoot>
        </table>
      </div>

      <div className="dim" style={{ fontSize: 11.5, padding: '12px 20px 18px', lineHeight: 1.6 }}>
        {balances.includes('available') && (
          <>
            <b>Available</b> is what the subcontractor could work on that month: what they
            were already carrying, plus what they were newly given. A site open for three
            months is counted in all three, so the column is not totalled — the Excel export
            carries the full ledger if you need to reconcile it.
          </>
        )}
      </div>
    </>
  )
}

function MonthRows({ month, open, expandable, onToggle, onRevisions, isContractor }) {
  const label = `${month.shamsi_month_name} ${month.shamsi_year}`

  return (
    <>
      <tr>
        <td className="text-data">
          {expandable ? (
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              style={{ padding: 0, gap: 7, fontFamily: 'var(--font-farsi)', fontSize: 14.5, fontWeight: 500 }}
              aria-expanded={open}
              onClick={onToggle}
            >
              <ChevronRight
                size={14}
                style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform 0.16s' }}
              />
              {label}
            </button>
          ) : (
            label
          )}
        </td>
        <td className="tnum" style={{ textAlign: 'right' }}>{month.pip || '—'}</td>
        <td className="tnum" style={{ textAlign: 'right' }}>
          <AvailableCell month={month} />
        </td>
        <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{month.delivered}</td>
        <td><AchievementCell value={month.achievement_percent} /></td>
        <td style={{ textAlign: 'right' }}>
          {isContractor && (
            <button
              className="btn btn-ghost btn-sm"
              title="Revision history for this month"
              onClick={() => onRevisions({ year: month.shamsi_year, month: month.shamsi_month })}
            >
              <History size={13} />
            </button>
          )}
        </td>
      </tr>

      {open && (
        <tr>
          <td colSpan={6} style={{ background: 'var(--surface-2)', padding: '12px 20px 16px' }}>
            <ContractorRows rows={month.rows} onRevisions={onRevisions} month={month} />
          </td>
        </tr>
      )}
    </>
  )
}

/** The number, and underneath it what it is made of.
 *
 *  Carried-in and newly-assigned as a two-tone bar rather than two more
 *  columns: the split matters (a month that is all backlog is a different
 *  month from one that is all new work) but not enough to widen a table that
 *  has to hold twelve rows on a laptop.
 */
function AvailableCell({ month }) {
  const total = month.available
  if (!total) return <span className="dim">0</span>
  const carried = (month.carried_in / total) * 100

  return (
    <span
      title={`${month.carried_in} carried in + ${month.newly_assigned} newly assigned`}
      style={{ display: 'inline-flex', flexDirection: 'column', alignItems: 'flex-end', gap: 3 }}
    >
      <span>{total}</span>
      <span style={{ display: 'flex', width: 54, height: 4, borderRadius: 2, overflow: 'hidden', background: 'var(--surface-3)' }}>
        <span style={{ width: `${carried}%`, background: 'var(--violet)' }} />
        <span style={{ width: `${100 - carried}%`, background: 'var(--violet-dim)' }} />
      </span>
    </span>
  )
}

function AchievementCell({ value }) {
  if (value == null) {
    return <div style={{ textAlign: 'right' }} className="dim">no plan</div>
  }
  //: The track runs past 100 so the target marker sits inside it rather than
  //: on the end cap — the same reason the plan-and-delivery rows do it.
  const scaleMax = 130
  return (
    <div className="row" style={{ justifyContent: 'flex-end', gap: 8 }}>
      <span className="tnum" style={{ fontWeight: 600, color: bandColor(value), minWidth: 40, textAlign: 'right' }}>
        {value}%
      </span>
      <div style={{ position: 'relative', width: 64, height: 7, background: 'var(--surface-3)', borderRadius: 4 }}>
        <div
          data-testid="achievement-bar"
          style={{
            width: `${Math.min(100, (value / scaleMax) * 100)}%`,
            height: '100%',
            background: bandColor(value),
            borderRadius: 4,
          }}
        />
        <div
          style={{
            position: 'absolute',
            top: -2,
            left: `${(100 / scaleMax) * 100}%`,
            width: 1.5,
            height: 11,
            background: 'var(--text-dim)',
          }}
          title="100% of plan"
        />
      </div>
    </div>
  )
}

function ContractorRows({ rows, onRevisions, month }) {
  if (!rows || rows.length === 0) {
    return <div className="empty">No subcontractors in this month.</div>
  }
  return (
    <div className="table-wrap" style={{ overflowX: 'auto' }}>
      <table>
        <thead>
          <tr>
            <th>Subcontractor</th>
            <th style={{ textAlign: 'right' }}>PIP</th>
            <th style={{ textAlign: 'right' }}>Carried in</th>
            <th style={{ textAlign: 'right' }}>New</th>
            <th style={{ textAlign: 'right' }}>Available</th>
            <th style={{ textAlign: 'right' }}>Delivered</th>
            <th style={{ textAlign: 'right', minWidth: 150 }}>Achievement</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.contractor_id}>
              <td className="text-data">{row.name}</td>
              <td className="tnum" style={{ textAlign: 'right' }}>{row.pip ?? '—'}</td>
              <td className="tnum dim" style={{ textAlign: 'right' }}>{row.carried_in}</td>
              <td className="tnum dim" style={{ textAlign: 'right' }}>{row.newly_assigned}</td>
              <td className="tnum" style={{ textAlign: 'right' }}>{row.available}</td>
              <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>{row.delivered}</td>
              <td><AchievementCell value={row.achievement_percent} /></td>
              <td style={{ textAlign: 'right' }}>
                <button
                  className="btn btn-ghost btn-sm"
                  title={`Revision history for ${row.name}`}
                  onClick={() =>
                    onRevisions({
                      year: month.shamsi_year,
                      month: month.shamsi_month,
                      contractorId: row.contractor_id,
                      name: row.name,
                    })
                  }
                >
                  <History size={13} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
