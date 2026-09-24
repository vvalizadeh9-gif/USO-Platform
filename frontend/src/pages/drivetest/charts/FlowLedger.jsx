import { motion, useReducedMotion } from 'framer-motion'
import { ArrowDownRight, ArrowUpRight, Minus } from 'lucide-react'
import { useId } from 'react'
import { STATE_COLOR } from '../constants'
import { count, deltaTone, TONE_COLOR } from '../format'

/**
 * What moved through the month, as a waterfall that closes.
 *
 * A balance and a delta can tell you the backlog fell by 55. They cannot tell
 * you whether that was 250 drive tests completed against 195 new sites
 * arriving, or 60 against 5 — situations that call for opposite decisions and
 * look identical from the delta alone. The snapshot service has been
 * measuring exactly this for every month and storing it in `flow_*` columns
 * that, until recently, nothing displayed.
 *
 * WHY IT IS COLUMNS AGAIN. This was a column waterfall once, and it was
 * turned on its side for two reasons that were both about space: four
 * 66-pixel columns on a 150-unit plot rendered taller than the half-width
 * section it lived in, and the step labels ("Drive tests done", "New on
 * air") had nowhere to go under columns that narrow. Neither constraint
 * exists now. This card no longer shares a row with the flow chart — that
 * moved up under the KPI band — so it has the full width of the page, which
 * is about 170 pixels a column with room under each for its label at full
 * length. The horizontal version was the right answer to a question that is
 * no longer being asked; columns are the form a waterfall is read in, because
 * the height of a bar and the height of the step between two bars are the
 * same measurement, which is the whole claim the chart makes.
 *
 * The arithmetic is unchanged and is the point: each movement starts where
 * the previous one finished, and the closing bar has to land where the last
 * movement left off. `opening + arrivals - completions == closing` holds by
 * construction in `services/snapshots.reconcile`, so a bar that fails to line
 * up is a bug worth seeing rather than something to paper over. The dashed
 * connectors are what make that visible: each one leaves the top of one bar
 * and arrives at the top of the next, so a break in the chain is a break in
 * the ledger.
 *
 * ONE HONESTY NOTE, carried in the footer rather than buried: the four flows
 * are not equally direct. Completions are measured outright. Arrivals are
 * derived from the balances. Problematic flags and resolutions are measured
 * where the platform dates the transition and reconciled where it does not —
 * a CPM import rewrites status in bulk and records nothing about when any
 * individual site changed.
 */

const VIEW_W = 720
const PAD_T = 24
const PLOT_H = 150
const AXIS_Y = PAD_T + PLOT_H
const LABEL_Y = AXIS_Y + 19
const VIEW_H = LABEL_Y + 12

const COL_W = VIEW_W / 4
const BAR_W = 104

export default function FlowLedger({ flows, monthLabel }) {
  const reduced = useReducedMotion()
  const gradientId = useId()
  if (!flows) return null

  const { opening_remaining: opening, closing_remaining: closing } = flows
  const arrived = flows.new_onair
  const completed = flows.dt_completed
  const net = closing - opening
  const afterArrivals = opening + arrived

  // The scale covers the levels the month moved between, not zero.
  //
  // A backlog of a thousand moving by a hundred is the ordinary case here, and
  // on a zero-based axis those movements are a few pixels at the top of two
  // near-identical full-height bars — the one thing the section exists to
  // show, drawn too small to see. Truncating an axis is how charts mislead, so
  // the floor is labelled underneath rather than left to be assumed as zero.
  const levels = [opening, afterArrivals, closing]
  const lo = Math.min(...levels)
  const hi = Math.max(...levels)
  const pad = Math.max((hi - lo) * 0.35, 1)
  const floor = Math.max(0, Math.round(lo - pad))
  const ceiling = Math.round(hi + pad)
  const span = Math.max(ceiling - floor, 1)
  const y = (v) => PAD_T + PLOT_H - ((v - floor) / span) * PLOT_H

  const tone = {
    balance: 'var(--text-dim)',
    up: STATE_COLOR.ongoing,
    down: STATE_COLOR.done,
  }

  /** The four bars, each one spanning the two levels it sits between.
   *
   * A balance bar stands on the floor; a movement bar floats between where
   * the previous step finished and where this one leaves it. That is the
   * only difference between them, and it is what makes the chart a
   * waterfall rather than four columns side by side. */
  const bars = [
    { key: 'opening', label: 'Opened at', kind: 'balance', top: opening, bottom: floor, figure: count(opening) },
    { key: 'arrived', label: 'New on air', kind: 'up', top: afterArrivals, bottom: opening, figure: `+${count(arrived)}` },
    { key: 'completed', label: 'Drive tests done', kind: 'down', top: afterArrivals, bottom: closing, figure: `−${count(completed)}` },
    { key: 'closing', label: 'Closed at', kind: 'balance', top: closing, bottom: floor, figure: count(closing) },
  ]

  const centre = (i) => COL_W * i + COL_W / 2

  return (
    <div className="dt-flow">
      <div className="dt-flow-chart">
      <svg
        className="dt-flow-waterfall"
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        role="img"
        aria-label={
          `${monthLabel}: opened at ${opening} remaining, ${arrived} sites came on air, ` +
          `${completed} drive tests were completed, closed at ${closing} remaining.`
        }
      >
        <defs>
          {/* A subtle vertical gradient in each bar's own colour, rather
              than a flat fill — the same light-from-above the rest of the
              page's charts use. No drop shadow: a gradient on the fill
              itself reads as material, a shadow under it reads as a sticker. */}
          {Object.entries(tone).map(([key, hex]) => (
            <linearGradient key={key} id={`${gradientId}-${key}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={hex} stopOpacity={key === 'balance' ? 0.36 : 0.98} />
              <stop offset="100%" stopColor={hex} stopOpacity={key === 'balance' ? 0.22 : 0.78} />
            </linearGradient>
          ))}
        </defs>
        {/* The floor the two balance bars stand on. Not zero, and said so
            in the footer. */}
        <line x1={0} x2={VIEW_W} y1={AXIS_Y} y2={AXIS_Y} className="dt-gridline" />

        {/* Each connector leaves the top of one bar and arrives at the top
            of the next, so the chain breaking is the ledger breaking. */}
        {[
          { key: 'c1', from: 0, to: 1, level: opening },
          { key: 'c2', from: 1, to: 2, level: afterArrivals },
          { key: 'c3', from: 2, to: 3, level: closing },
        ].map((c) => (
          <line
            key={c.key}
            data-testid="dt-flow-connector"
            x1={centre(c.from) + BAR_W / 2}
            x2={centre(c.to) - BAR_W / 2}
            y1={y(c.level)}
            y2={y(c.level)}
            className="dt-flow-connector"
          />
        ))}

        {bars.map((bar, i) => {
          const top = Math.min(y(bar.top), y(bar.bottom))
          const height = Math.max(Math.abs(y(bar.top) - y(bar.bottom)), 2)
          const balance = bar.kind === 'balance'
          return (
            <g key={bar.key} data-testid="dt-flow-bar" data-step={bar.key}>
              <motion.rect
                x={centre(i) - BAR_W / 2}
                y={top}
                width={BAR_W}
                height={height}
                rx={2}
                fill={`url(#${gradientId}-${bar.kind})`}
                initial={reduced ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                style={{ transformOrigin: `${centre(i)}px ${top + height}px` }}
                transition={{ delay: 0.08 + i * 0.1, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              />
              <text
                x={centre(i)}
                y={top - 7}
                textAnchor="middle"
                className="dt-flow-figure-text"
                style={{ fill: balance ? 'var(--text)' : tone[bar.kind] }}
              >
                {bar.figure}
              </text>
              {/* Under the bar at full length, which is the thing four
                  66-pixel columns could not do. */}
              <text x={centre(i)} y={LABEL_Y} textAnchor="middle" className="dt-flow-step-label">
                {bar.label}
              </text>
            </g>
          )
        })}
      </svg>
      </div>

      <div className="dt-flow-foot">
        <FlowStat
          icon={ArrowUpRight}
          label="Arrived on air"
          value={arrived}
          color={STATE_COLOR.ongoing}
        />
        <FlowStat
          icon={ArrowDownRight}
          label="Drive tests done"
          value={completed}
          color={STATE_COLOR.done}
        />
        <NetChangeStat value={net} />
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

/** The month's net movement, for the card header.
 *
 * Exported because the header belongs to `Section`, which is rendered by the
 * page rather than by this component — and the figure has to be the same
 * arithmetic the bars draw, from the same payload, rather than a second
 * subtraction done somewhere else and liable to drift.
 */
export function flowNet(flows) {
  if (!flows) return null
  return flows.closing_remaining - flows.opening_remaining
}

/** The footer's copy of the net movement the header already states.
 *
 * The header answers "how did the month go" from across the room; this one
 * sits with the three figures that made it up, signed the same way the bars
 * above it are, so a reader working across the footer does not have to look
 * up for the number that closes the other two.
 */
function NetChangeStat({ value }) {
  const tone = deltaTone(value, 'down')
  const color = tone ? TONE_COLOR[tone] : TONE_COLOR.flat
  const Icon = value === 0 ? Minus : value > 0 ? ArrowUpRight : ArrowDownRight
  return (
    <span className="dt-flow-stat">
      <span className="dt-flow-stat-icon" style={{ background: color }}>
        <Icon size={12} strokeWidth={2.4} />
      </span>
      <span className="dt-flow-stat-label">Net change</span>
      <b className="tnum" style={{ color }}>
        {value > 0 ? '+' : ''}
        {count(value)}
      </b>
    </span>
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
