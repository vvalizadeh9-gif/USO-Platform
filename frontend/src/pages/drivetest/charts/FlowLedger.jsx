import { motion, useReducedMotion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { count } from '../format'

/**
 * What moved through the month, as a waterfall that closes.
 *
 * A balance and a delta can tell you the backlog fell by 55. They cannot tell
 * you whether that was 250 drive tests completed against 195 new sites
 * arriving, or 60 against 5 — situations that call for opposite decisions and
 * look identical from the delta alone. The snapshot service has been
 * measuring exactly this for every month and storing it in `flow_*` columns
 * that, until now, nothing displayed.
 *
 * The bars are a real waterfall: opening balance, each movement drawn from
 * where the previous one left off, and a closing balance the running total
 * lands on. `opening + arrivals - completions == closing` holds by
 * construction in `services/snapshots.reconcile`, so if a column here fails to
 * land on the closing figure that is a bug worth seeing, not something to
 * paper over with an independently-computed final bar.
 *
 * ONE HONESTY NOTE, carried in the footer rather than buried: the four flows
 * are not equally direct. Completions are measured outright. Arrivals are
 * derived from the balances. Problematic flags and resolutions are measured
 * where the platform dates the transition and reconciled where it does not —
 * a CPM import rewrites status in bulk and records nothing about when any
 * individual site changed.
 */

const BAR_W = 66
const GAP = 26
const PLOT_H = 150
const PAD_T = 26
const PAD_L = 8

export default function FlowLedger({ flows, monthLabel }) {
  const reduced = useReducedMotion()
  if (!flows) return null

  const { opening_remaining: opening, closing_remaining: closing } = flows
  const arrived = flows.new_onair
  const completed = flows.dt_completed

  // Columns in ledger order. `from`/`to` are running-total positions, so each
  // movement bar starts where the previous one finished.
  const afterArrivals = opening + arrived
  const columns = [
    { key: 'opening', label: 'Opened at', from: null, to: opening, value: opening, kind: 'balance' },
    { key: 'arrived', label: 'New on-air', from: opening, to: afterArrivals, value: arrived, kind: 'up' },
    { key: 'completed', label: 'Drive tests done', from: afterArrivals, to: closing, value: -completed, kind: 'down' },
    { key: 'closing', label: 'Closed at', from: null, to: closing, value: closing, kind: 'balance' },
  ]

  // The vertical scale covers the levels the month moved between, not zero.
  //
  // A backlog of a thousand moving by a hundred is the ordinary case here, and
  // on a zero-based axis those movements are a few pixels at the top of two
  // near-identical full-height columns — the one thing the section exists to
  // show, drawn too small to see. Truncating an axis is how charts mislead, so
  // the floor is labelled and called out underneath rather than left for
  // someone to assume is zero.
  const levels = [opening, afterArrivals, closing]
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const pad = Math.max((hi - lo) * 0.35, 1)
  const floor = Math.max(0, Math.round(lo - pad))
  const ceiling = Math.round(hi + pad)
  const span = Math.max(ceiling - floor, 1)

  const y = (v) => PAD_T + PLOT_H - ((v - floor) / span) * PLOT_H
  const width = columns.length * BAR_W + (columns.length - 1) * GAP + PAD_L * 2
  const height = PAD_T + PLOT_H + 46

  const tone = {
    balance: 'var(--text-muted)',
    up: 'var(--amber)',
    down: 'var(--green)',
  }

  return (
    <div className="dt-flow">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="dt-flow-svg"
        role="img"
        aria-label={
          `${monthLabel}: opened at ${opening} remaining, ${arrived} sites came on air, ` +
          `${completed} drive tests were completed, closed at ${closing} remaining.`
        }
      >
        <line
          x1={PAD_L}
          x2={width - PAD_L}
          y1={PAD_T + PLOT_H}
          y2={PAD_T + PLOT_H}
          className="dt-gridline"
        />
        <text x={PAD_L} y={PAD_T + PLOT_H + 34} className="dt-flow-floor">
          scale starts at {count(floor)}, not zero
        </text>
        {columns.map((col, i) => {
          const cx = PAD_L + i * (BAR_W + GAP)
          const base = col.from == null ? floor : col.from
          const top = y(Math.max(base, col.to))
          const bottom = y(Math.min(base, col.to))
          const barHeight = Math.max(2, bottom - top)
          const color = tone[col.kind]
          return (
            <g key={col.key}>
              {/* Connector from the previous column's landing height, so the
                  eye follows the running total across the gap. */}
              {i > 0 && columns[i - 1].kind !== 'balance' && col.kind !== 'balance' && (
                <line
                  x1={cx - GAP}
                  x2={cx}
                  y1={y(col.from)}
                  y2={y(col.from)}
                  className="dt-flow-connector"
                />
              )}
              {i === 1 && (
                <line
                  x1={cx - GAP}
                  x2={cx}
                  y1={y(col.from)}
                  y2={y(col.from)}
                  className="dt-flow-connector"
                />
              )}
              {i === columns.length - 1 && (
                <line
                  x1={cx - GAP}
                  x2={cx}
                  y1={y(columns[i - 1].to)}
                  y2={y(columns[i - 1].to)}
                  className="dt-flow-connector"
                />
              )}
              <motion.rect
                data-testid="dt-flow-bar"
                x={cx}
                y={top}
                width={BAR_W}
                height={barHeight}
                rx={4}
                fill={color}
                fillOpacity={col.kind === 'balance' ? 0.22 : 0.85}
                stroke={color}
                strokeWidth={col.kind === 'balance' ? 1.5 : 0}
                style={{ transformOrigin: `${cx + BAR_W / 2}px ${bottom}px` }}
                initial={reduced ? false : { scaleY: 0, opacity: 0 }}
                animate={{ scaleY: 1, opacity: 1 }}
                transition={{ delay: 0.1 + i * 0.12, duration: 0.5, ease: [0.16, 1, 0.3, 1] }}
              />
              <text x={cx + BAR_W / 2} y={top - 8} className="dt-flow-value" textAnchor="middle">
                {col.kind === 'balance'
                  ? count(col.value)
                  : `${col.value > 0 ? '+' : '−'}${count(Math.abs(col.value))}`}
              </text>
              <text
                x={cx + BAR_W / 2}
                y={PAD_T + PLOT_H + 20}
                className="dt-flow-label"
                textAnchor="middle"
              >
                {col.label}
              </text>
            </g>
          )
        })}
      </svg>

      <div className="dt-flow-side">
        <FlowStat
          icon={ArrowUpRight}
          label="Newly problematic"
          value={flows.newly_problematic}
          tone="bad"
        />
        <FlowStat
          icon={ArrowDownRight}
          label="Problems resolved"
          value={flows.problematic_resolved}
          tone="good"
        />
        <p className="dt-flow-note">
          Completions are counted directly. Arrivals are derived from the
          balances. Problem flags and resolutions are counted where the
          platform dates the change and reconciled against the balances where
          it does not.
        </p>
      </div>
    </div>
  )
}

function FlowStat({ icon: Icon, label, value, tone }) {
  return (
    <div className="dt-flow-stat">
      <span className={`dt-flow-stat-icon dt-tone-${tone}`}>
        <Icon size={14} strokeWidth={2.2} />
      </span>
      <span className="dt-flow-stat-label">{label}</span>
      <b className="tnum">{count(value)}</b>
    </div>
  )
}
