// A sparkline: one series as a thin line over a soft area, in plain SVG.
// `null` is a day with no figure and is drawn as a gap -- never as a zero,
// which would invent a drop that did not happen. The picture is described in
// words (role="img" + aria-label), so it is never the only way to read it.

const WIDTH = 140
const HEIGHT = 32
// Room above and below the line, so a 2px stroke at the extremes is not cut.
const PAD = 3

/** The runs of consecutive known points, as [[index, value], ...] lists. */
export function segments(values) {
  const runs = []
  let run = []
  values.forEach((v, i) => {
    if (v === null || v === undefined || Number.isNaN(v)) {
      if (run.length) runs.push(run)
      run = []
    } else {
      run.push([i, v])
    }
  })
  if (run.length) runs.push(run)
  return runs
}

/** "Overdue over the last 14 days, falling from 9 to 5". */
export function describeSeries(label, values) {
  const known = values.filter((v) => v !== null && v !== undefined)
  const span = `${label} over the last ${values.length} days`
  if (known.length === 0) return `${span}: no data yet`
  const first = known[0]
  const last = known[known.length - 1]
  if (known.length === 1) return `${span}: ${last}, no earlier data`
  if (first === last) return `${span}, steady at ${last}`
  return `${span}, ${last > first ? 'rising' : 'falling'} from ${first} to ${last}`
}

export default function Sparkline({ values = [], label, tone = 'brand', className }) {
  const known = values.filter((v) => v !== null && v !== undefined)
  const min = known.length ? Math.min(...known) : 0
  const max = known.length ? Math.max(...known) : 0
  const step = values.length > 1 ? WIDTH / (values.length - 1) : 0
  const x = (i) => i * step
  // A flat series sits in the middle rather than on the floor.
  const y = (v) => (max === min ? HEIGHT / 2 : PAD + (1 - (v - min) / (max - min)) * (HEIGHT - 2 * PAD))

  const runs = segments(values)
  const line = (run) => {
    // A lone known day still shows as a short tick.
    if (run.length === 1) {
      const [i, v] = run[0]
      const half = Math.max(1.5, step / 4)
      return `M${Math.max(0, x(i) - half)} ${y(v)}H${Math.min(WIDTH, x(i) + half)}`
    }
    return run.map(([i, v], n) => `${n ? 'L' : 'M'}${x(i)} ${y(v)}`).join('')
  }
  const area = (run) =>
    run.length < 2 ? null : `${line(run)}L${x(run[run.length - 1][0])} ${HEIGHT}L${x(run[0][0])} ${HEIGHT}Z`

  return (
    <svg
      className={`sparkline ${tone === 'white' ? 'sparkline--white' : ''} ${className || ''}`.trim()}
      viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
      preserveAspectRatio="none"
      role="img"
      aria-label={describeSeries(label, values)}
      focusable="false"
    >
      {runs.map((run) => {
        const d = area(run)
        return d ? <path key={`a${run[0][0]}`} className="sparkline-area" d={d} /> : null
      })}
      {runs.map((run) => (
        <path key={`l${run[0][0]}`} className="sparkline-line" d={line(run)} />
      ))}
    </svg>
  )
}
