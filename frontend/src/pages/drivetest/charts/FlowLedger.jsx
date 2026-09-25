import { motion, useReducedMotion } from 'framer-motion'
import { STATE_COLOR } from '../constants'
import { count } from '../format'
import { flowScale } from './flowScale'

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
 * COMPACT, AND HTML RATHER THAN SVG. This card now sits in the column beside
 * the trend chart, about a third of the page wide. The waterfall used to be an
 * SVG drawn on a 720-unit canvas, which at that width would have scaled its
 * 12px labels down to about 6px. Drawn as boxes positioned in percent, the
 * bars scale with the column while every figure and label stays at its true
 * size at any width.
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
 * The two notes that used to sit under the chart -- which flows are measured
 * and which derived, and that the scale does not start at zero -- are the
 * page's to show, behind the card's info icon. `flowScale` (its own module)
 * is shared so that note states the same floor the bars are drawn from.
 */

export default function FlowLedger({ flows, monthLabel }) {
  const reduced = useReducedMotion()
  if (!flows) return null

  const { opening_remaining: opening, closing_remaining: closing } = flows
  const arrived = flows.new_onair
  const completed = flows.dt_completed
  const { floor, span, afterArrivals } = flowScale(flows)
  const at = (v) => ((v - floor) / span) * 100

  /** The four bars, each one spanning the two levels it sits between.
   *
   * A balance bar stands on the floor; a movement bar floats between where
   * the previous step finished and where this one leaves it. That is the
   * only difference between them, and it is what makes the chart a
   * waterfall rather than four columns side by side. Balances are the
   * neutral: they are where the backlog stood, not something happening to
   * it. The two movements take the hue of what moved it — indigo for sites
   * arriving, green for drive tests finished. */
  const bars = [
    { key: 'opening', label: 'Opened at', kind: 'balance', top: opening, bottom: floor, figure: count(opening) },
    { key: 'arrived', label: 'New on air', kind: 'up', top: afterArrivals, bottom: opening, figure: `+${count(arrived)}` },
    { key: 'completed', label: 'Drive tests done', kind: 'down', top: afterArrivals, bottom: closing, figure: `−${count(completed)}` },
    { key: 'closing', label: 'Closed at', kind: 'balance', top: closing, bottom: floor, figure: count(closing) },
  ]
  const figureColor = {
    balance: 'var(--text)',
    up: STATE_COLOR.ongoing,
    down: STATE_COLOR.done,
  }
  // The level each connector runs at: from the top of the bar before it.
  const linkLevel = [null, opening, afterArrivals, closing]

  return (
    <div
      className="dt-wf"
      role="img"
      aria-label={
        `${monthLabel}: opened at ${opening} remaining, ${arrived} sites came on air, ` +
        `${completed} drive tests were completed, closed at ${closing} remaining.`
      }
    >
      {bars.map((bar, i) => {
        const lo = Math.min(bar.top, bar.bottom)
        const hi = Math.max(bar.top, bar.bottom)
        return (
          <div
            key={bar.key}
            className={`dt-wf-col dt-wf-${bar.kind}`}
            data-testid="dt-flow-bar"
            data-step={bar.key}
          >
            <div className="dt-wf-plot">
              {linkLevel[i] != null && (
                <i
                  data-testid="dt-flow-connector"
                  className="dt-wf-link"
                  style={{ bottom: `${at(linkLevel[i])}%` }}
                  aria-hidden="true"
                />
              )}
              <motion.span
                className="dt-wf-bar"
                style={{
                  bottom: `${at(lo)}%`,
                  height: `${at(hi) - at(lo)}%`,
                  transformOrigin: 'bottom',
                }}
                initial={reduced ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                transition={{ delay: 0.08 + i * 0.1, duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
              />
              <span
                className="dt-flow-figure-text tnum"
                style={{ bottom: `calc(${at(hi)}% + 3px)`, color: figureColor[bar.kind] }}
              >
                {bar.figure}
              </span>
            </div>
            <span className="dt-flow-step-label">{bar.label}</span>
          </div>
        )
      })}
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
