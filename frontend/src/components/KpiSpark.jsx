import { describeSeries, isFlat, segments } from './Sparkline'

const W = 140
const H = 28
const PAD = 2

/**
 * The KPI-tile sparkline shared by Home's strip and the Drive Test band: a
 * line drawn left to right with its area fading in after it (styles in
 * kpi-strip.css). Gaps stay gaps.
 *
 * `baseline="zero"` (Home) keeps zero on the floor, which suits small daily
 * counts; `baseline="fit"` fits the range to the data, which suits running
 * totals in the thousands that would otherwise draw flat. `label` overrides
 * the generated description when the unit is not days.
 */
export default function KpiSpark({ values, title, label, baseline = 'zero', testId }) {
  const known = values.filter((v) => v !== null && v !== undefined)
  const fit = baseline === 'fit'
  const min = fit ? Math.min(...known) : Math.min(0, ...known)
  const max = fit ? Math.max(...known) : Math.max(1, ...known)
  const span = max - min || 1
  const step = values.length > 1 ? W / (values.length - 1) : 0
  const flat = isFlat(values)
  const y = (v) => (flat ? H / 2 : PAD + (1 - (v - min) / span) * (H - 2 * PAD))
  const runs = segments(values).filter((r) => r.length > 1)
  const line = (run) => run.map(([i, v], n) => `${n ? 'L' : 'M'}${i * step} ${y(v)}`).join('')
  return (
    <svg
      className="hk-spark"
      viewBox={`0 0 ${W} ${H}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={label ?? describeSeries(title, values)}
      data-testid={testId}
    >
      {!flat && runs.map((run) => (
        <path
          key={`a${run[0][0]}`}
          className="hk-area"
          d={`${line(run)}L${run[run.length - 1][0] * step} ${H}L${run[0][0] * step} ${H}Z`}
        />
      ))}
      {runs.map((run) => (
        <path key={`l${run[0][0]}`} className="hk-line" d={line(run)} pathLength="1" />
      ))}
    </svg>
  )
}
