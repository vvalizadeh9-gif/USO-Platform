import { useReducedMotion } from 'framer-motion'
import { bandColor } from '../drivetest/format'
import { axisScale, sharePercent } from './figures'

/**
 * Six months of Delivered against PIP, with Assignment behind them.
 *
 * Hand-written SVG, and deliberately: the whole chart is three rectangles and
 * a line per month, and a charting library would be a dependency, a bundle and
 * a theme to fight for marks this file draws in forty lines. It is also the
 * only way the three figures keep the colours they have everywhere else on the
 * platform — the band is a surface, the bar is the signal teal, the target is
 * ink.
 *
 * `bandColor` comes from the Drive Test dashboard's format module rather than
 * being written again here. The thresholds it encodes — at target, near it,
 * short of it — are a judgement about a contractor's month, and a second copy
 * of that judgement is a second copy free to drift from the first.
 *
 * Three marks, one meaning each:
 *
 *   - the faint band is Assignment, the sites held that month. It is behind
 *     the others because it is the room the month had, not an achievement.
 *   - the solid bar is Delivered.
 *   - the rule across it is PIP, the target. A bar that passes it has passed
 *     it visibly, which a percentage in a table never manages.
 *
 * A month with no approved PIP gets no rule and no percentage: there is
 * nothing it delivered a share of. The running month is drawn faded, because
 * its figures are not final.
 */

// The drawing area, in user units. Fixed, and scaled by the viewBox: the
// chart is laid out once here in numbers that are easy to reason about and
// then fits whatever width it is given.
const LEFT = 46
const RIGHT = 668
const TOP = 16
const BASE = 184

export default function SixMonthChart({ months = [] }) {
  const reduced = useReducedMotion()
  if (!months.length) return null

  const { max, step } = axisScale(
    Math.max(...months.flatMap((m) => [m.assignment || 0, m.pip || 0, m.delivered || 0])),
  )
  const y = (value) => BASE - (Math.min(value, max) / max) * (BASE - TOP)

  // Slots are divided by however many months came back, not by six: a
  // programme three months old draws three wide bars rather than six with a
  // gap where its own history has not happened yet.
  const slot = (RIGHT - LEFT) / months.length
  const bandWidth = Math.min(76, slot * 0.6)
  const barWidth = bandWidth * 0.46

  const summary = months
    .map((m) => {
      const pct = sharePercent(m.delivered, m.pip)
      const against = pct == null ? 'no approved PIP' : `${pct}% of ${m.pip}`
      return `${m.label}: ${m.delivered} delivered, ${against}${m.in_progress ? ', still running' : ''}`
    })
    .join('. ')

  return (
    <svg
      className="pip-chart"
      viewBox={`0 0 ${RIGHT + 12} 232`}
      role="img"
      aria-label={`Drive tests delivered against the approved PIP, by month. ${summary}.`}
    >
      {[0, 1, 2, 3, 4].map((i) => (
        <g key={i}>
          <line className="pip-grid" x1={LEFT} y1={y(step * i)} x2={RIGHT} y2={y(step * i)} />
          <text className="pip-axis" x={LEFT - 10} y={y(step * i) + 4} textAnchor="end">
            {step * i}
          </text>
        </g>
      ))}

      {months.map((m, i) => {
        const centre = LEFT + slot * (i + 0.5)
        const pct = sharePercent(m.delivered, m.pip)
        const fade = m.in_progress ? 0.62 : 1
        return (
          <g key={`${m.shamsi_year}-${m.shamsi_month}`}>
            {m.assignment > 0 && (
              <rect
                className="pip-band"
                x={centre - bandWidth / 2}
                y={y(m.assignment)}
                width={bandWidth}
                height={BASE - y(m.assignment)}
                rx="4"
              />
            )}
            {m.delivered > 0 && (
              <rect
                className="pip-bar"
                x={centre - barWidth / 2}
                y={y(m.delivered)}
                width={barWidth}
                height={BASE - y(m.delivered)}
                rx="4"
                opacity={fade}
                style={
                  reduced
                    ? undefined
                    : { transformBox: 'fill-box', transformOrigin: 'bottom', animation: 'pipGrow .6s cubic-bezier(.16,1,.3,1) both' }
                }
              />
            )}
            {/* The target, drawn across the band's full width so it reads as a
                line the bar is measured against rather than as a cap on it. */}
            {m.pip != null && m.pip > 0 && (
              <line
                className="pip-target"
                x1={centre - bandWidth / 2 - 2}
                y1={y(m.pip)}
                x2={centre + bandWidth / 2 + 2}
                y2={y(m.pip)}
              />
            )}
            <text className="pip-mlab dt-farsi" x={centre} y={203} textAnchor="middle">
              {m.shamsi_month_name}
            </text>
            <text
              className="pip-plab"
              x={centre}
              y={221}
              textAnchor="middle"
              fill={m.in_progress ? 'var(--signal-strong)' : bandColor(pct)}
            >
              {pct == null ? '—' : `${pct}%${m.in_progress ? ' so far' : ''}`}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

/** The key to the three marks. Separate so it can sit above the chart. */
export function ChartLegend() {
  return (
    <div className="pip-legend">
      <span><i className="pip-key pip-key-band" />Assignment — sites held</span>
      <span><i className="pip-key pip-key-target" />PIP — the target</span>
      <span><i className="pip-key pip-key-bar" />Delivered — drive tests done</span>
    </div>
  )
}
