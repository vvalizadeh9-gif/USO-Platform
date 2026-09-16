import { motion, useReducedMotion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight } from 'lucide-react'
import { STATE_COLOR } from '../constants'
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
 * WHY IT TURNED ON ITS SIDE. This was a column waterfall: four 66-unit bars
 * on a 150-unit plot, a side panel beside it, and the whole thing rendering
 * taller than the section it belonged to for four numbers. Horizontal rows
 * cost one line each. It also fixes a real legibility problem rather than
 * just a size one — the column labels ("Drive tests done", "New on-air") were
 * set under 66-pixel columns and had nowhere to go, where a row carries its
 * label on the same line at full length.
 *
 * The arithmetic is unchanged and is the point: each movement starts where
 * the previous one finished, and the closing bar has to land where the last
 * movement left off. `opening + arrivals - completions == closing` holds by
 * construction in `services/snapshots.reconcile`, so a row that fails to line
 * up is a bug worth seeing rather than something to paper over.
 *
 * ONE HONESTY NOTE, carried in the footer rather than buried: the four flows
 * are not equally direct. Completions are measured outright. Arrivals are
 * derived from the balances. Problematic flags and resolutions are measured
 * where the platform dates the transition and reconciled where it does not —
 * a CPM import rewrites status in bulk and records nothing about when any
 * individual site changed.
 */
export default function FlowLedger({ flows, monthLabel }) {
  const reduced = useReducedMotion()
  if (!flows) return null

  const { opening_remaining: opening, closing_remaining: closing } = flows
  const arrived = flows.new_onair
  const completed = flows.dt_completed
  const afterArrivals = opening + arrived

  const rows = [
    { key: 'opening', label: 'Opened at', from: null, to: opening, value: opening, kind: 'balance' },
    {
      key: 'arrived',
      label: 'New on air',
      from: opening,
      to: afterArrivals,
      value: arrived,
      kind: 'up',
    },
    {
      key: 'completed',
      label: 'Drive tests done',
      from: afterArrivals,
      to: closing,
      value: -completed,
      kind: 'down',
    },
    { key: 'closing', label: 'Closed at', from: null, to: closing, value: closing, kind: 'balance' },
  ]

  // The scale covers the levels the month moved between, not zero.
  //
  // A backlog of a thousand moving by a hundred is the ordinary case here, and
  // on a zero-based axis those movements are a few pixels at the end of two
  // near-identical full-width bars — the one thing the section exists to
  // show, drawn too small to see. Truncating an axis is how charts mislead, so
  // the floor is labelled underneath rather than left to be assumed as zero.
  const levels = [opening, afterArrivals, closing]
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const pad = Math.max((hi - lo) * 0.35, 1)
  const floor = Math.max(0, Math.round(lo - pad))
  const ceiling = Math.round(hi + pad)
  const span = Math.max(ceiling - floor, 1)
  const at = (v) => ((v - floor) / span) * 100

  const tone = {
    balance: 'var(--text-dim)',
    up: STATE_COLOR.ongoing,
    down: STATE_COLOR.done,
  }

  return (
    <div className="dt-flow">
      <ol
        className="dt-flow-rows"
        aria-label={
          `${monthLabel}: opened at ${opening} remaining, ${arrived} sites came on air, ` +
          `${completed} drive tests were completed, closed at ${closing} remaining.`
        }
      >
        {rows.map((row, i) => {
          const base = row.from == null ? floor : row.from
          const left = at(Math.min(base, row.to))
          const right = at(Math.max(base, row.to))
          const width = Math.max(right - left, 0.6)
          const balance = row.kind === 'balance'
          return (
            <li key={row.key} className={`dt-flow-row dt-flow-${row.kind}`}>
              <span className="dt-flow-name">{row.label}</span>
              <span className="dt-flow-track">
                <motion.span
                  data-testid="dt-flow-bar"
                  className="dt-flow-fill"
                  style={{
                    left: `${left}%`,
                    width: `${width}%`,
                    background: tone[row.kind],
                    opacity: balance ? 0.3 : 0.92,
                    transformOrigin: row.value < 0 ? 'right center' : 'left center',
                  }}
                  initial={reduced ? false : { scaleX: 0 }}
                  animate={{ scaleX: 1 }}
                  transition={{
                    delay: 0.08 + i * 0.1,
                    duration: 0.45,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                />
              </span>
              <b className="dt-flow-figure tnum" style={{ color: balance ? undefined : tone[row.kind] }}>
                {balance
                  ? count(row.value)
                  : `${row.value > 0 ? '+' : '−'}${count(Math.abs(row.value))}`}
              </b>
            </li>
          )
        })}
      </ol>

      <div className="dt-flow-foot">
        <FlowStat
          icon={ArrowUpRight}
          label="Newly problematic"
          value={flows.newly_problematic}
          color={STATE_COLOR.problematic}
        />
        <FlowStat
          icon={ArrowDownRight}
          label="Problems resolved"
          value={flows.problematic_resolved}
          color={STATE_COLOR.done}
        />
        <span className="dt-flow-floor">scale starts at {count(floor)}, not zero</span>
      </div>

      <p className="dt-flow-note">
        Completions are counted directly. Arrivals are derived from the balances. Problem
        flags and resolutions are counted where the platform dates the change and
        reconciled against the balances where it does not.
      </p>
    </div>
  )
}

function FlowStat({ icon: Icon, label, value, color }) {
  return (
    <span className="dt-flow-stat">
      <span className="dt-flow-stat-icon" style={{ background: color }}>
        <Icon size={12} strokeWidth={2.4} />
      </span>
      <span className="dt-flow-stat-label">{label}</span>
      <b className="tnum">{count(value)}</b>
    </span>
  )
}
