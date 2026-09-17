import { motion, useReducedMotion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { TREND_SERIES } from '../constants'
import { count } from '../format'
import { DrawPath, FadeArea } from './primitives'

/**
 * The trailing-month series: where the programme has actually been going.
 *
 * WHY THIS EXISTS. Every other figure on this dashboard is a snapshot with
 * one scalar delta beside it. That can say "1,006 remaining, down 55" and can
 * never say whether the backlog is bending or the last two months were a
 * blip. Four charts were removed from this page for good reasons — two
 * duplicated the tables above them, and one plotted every month of the Shamsi
 * year including the ones that had not happened, so delivery appeared to fall
 * off a cliff at the current month. This is the replacement those reasons
 * imply, not a restoration: it stops at the month we are in.
 *
 * ONE PANEL, ONE SCALE, TWO SERIES. Remaining and completed are comparable
 * magnitudes and belong on one axis. Problematic does not: it is an order of
 * magnitude smaller, and every way of putting it here is a bad one. On the
 * shared scale it is a flat line along the floor. On a second y-axis it makes
 * two unrelated scales look like one, which is how charts end up lying. In
 * its own strip underneath — which is what this chart used to do — it was a
 * second set of gridlines and a second vertical scale that a reader had to
 * learn before they could read the shape they came for.
 *
 * So it is a figure, not a line: the caption under the chart says what it is
 * now and which way it has moved over the window, and the hover readout
 * carries it for every month. Nothing is lost except the drawing of it, and
 * the drawing was the part that cost the most and said the least. A reader
 * comes to this card to see whether the backlog is bending; that question is
 * two lines, and now it looks like two lines.
 *
 * WHAT THE DRAWING ADMITS. The series is assembled from monthly snapshots
 * that are written when someone signs in, not on a schedule, so it has three
 * kinds of imperfection and draws each of them rather than smoothing it away:
 * an uncaptured month breaks the line, a month whose figures had to be taken
 * from the opening reading is marked with a hollow point, and the month still
 * in progress is drawn dashed with an open endpoint.
 */

/* Geometry. The panel used to be 760x300 in a full-width box, which made a
   twelve-point series the tallest thing on the page — for a shape a reader
   takes in at a glance.
 *
 * The width matters as much as the height and is the less obvious half. An
 * SVG viewBox scales its type along with everything else, so a 760-unit box
 * rendered in a half-width card shrinks 11px axis labels to about 6px. The
 * box is now sized to roughly what it is rendered at, which keeps the labels
 * at the size they are set in. The strip keeps its share of the height,
 * because a problematic series squeezed to a few pixels is a flat line
 * whatever its numbers do. */
const VIEW_W = 440
const PAD_L = 36
const PAD_R = 10
const MAIN_TOP = 8
// The height the strip used to take is given back to the panel rather than
// saved: the whole point of dropping the strip is that the shape of the two
// series is what this card is for, and it now gets the room.
const MAIN_H = 112
const AXIS_Y = 138
const VIEW_H = 148

const PLOT_W = VIEW_W - PAD_L - PAD_R

/** A rounded ceiling for an axis, so the top gridline is a readable number. */
function niceMax(value) {
  if (value <= 0) return 10
  const magnitude = 10 ** Math.floor(Math.log10(value))
  const steps = [1, 1.25, 1.5, 2, 2.5, 3, 4, 5, 7.5, 10]
  for (const step of steps) {
    const candidate = step * magnitude
    if (candidate >= value) return candidate
  }
  return 10 * magnitude
}

/** Consecutive runs of captured points, so gaps break the line.
 *
 * A month nobody signed in during was never measured. Joining across it would
 * draw a straight segment through a period nothing is known about, and that
 * segment is indistinguishable from a measured one.
 */
function segments(points, key) {
  const runs = []
  let run = []
  points.forEach((point, index) => {
    if (point.captured && point[key] != null) {
      run.push({ ...point, index })
    } else if (run.length) {
      runs.push(run)
      run = []
    }
  })
  if (run.length) runs.push(run)
  return runs
}

function lineFor(run, x, y) {
  return run.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p.index)},${y(p.value)}`).join(' ')
}

function areaFor(run, x, y, baseline) {
  if (!run.length) return ''
  const top = run.map((p) => `L${x(p.index)},${y(p.value)}`).join(' ')
  return `M${x(run[0].index)},${baseline} ${top} L${x(run[run.length - 1].index)},${baseline} Z`
}

export default function TrendChart({ months, seriesLabel = {} }) {
  const reduced = useReducedMotion()
  const [hover, setHover] = useState(null)

  const model = useMemo(() => {
    const n = Math.max(months.length, 2)
    const x = (i) => PAD_L + (PLOT_W * i) / (n - 1)

    const withValue = (key) =>
      months.map((m) => ({ ...m, value: m.captured ? m[key] : null }))

    const remaining = withValue('remaining')
    const done = withValue('dt_done')
    const problematic = withValue('problematic')

    const mainValues = [...remaining, ...done]
      .map((p) => p.value)
      .filter((v) => v != null)

    const mainMax = niceMax(Math.max(1, ...mainValues))
    const mainY = (v) => MAIN_TOP + MAIN_H - (v / mainMax) * MAIN_H

    // Problematic is not drawn, so it needs no scale -- only its ends, for
    // the caption. First and last *captured* readings: an uncaptured month
    // was never measured, and taking a direction from one would report a
    // change that was never observed.
    const seen = problematic.filter((p) => p.value != null)
    const problematicNow = seen.length ? seen[seen.length - 1] : null
    const problematicThen = seen.length > 1 ? seen[0] : null

    return { x, remaining, done, problematicNow, problematicThen, mainMax, mainY, n }
  }, [months])

  if (!months.length) return null

  // `problematic` stays inside the model: the readout reads each month's
  // figure straight off the month, and the caption needs only the two ends.
  const { x, remaining, done, problematicNow, problematicThen, mainMax, mainY } = model
  const mainBase = MAIN_TOP + MAIN_H
  const ticks = [0, 0.5, 1]

  // Label every month when they fit, otherwise every other one. Twelve labels
  // in Persian across this width overlap; six do not.
  const labelEvery = months.length > 6 ? 2 : 1
  const hovered = hover == null ? null : months[hover]

  // Colours come from TREND_SERIES, which is also what the legend under the
  // chart is built from. They used to be written out again here, and the two
  // copies had drifted: the legend swatch for Remaining was one hue and the
  // line it labelled was another.
  const hue = Object.fromEntries(TREND_SERIES.map((s) => [s.key, s.color]))
  const series = [
    { key: 'remaining', points: remaining, color: hue.remaining, y: mainY, area: true },
    { key: 'dt_done', points: done, color: hue.dt_done, y: mainY, area: false },
  ]
  // Carried in the hover readout but not drawn -- see the note at the top of
  // this file for why it is a figure rather than a third line.
  const readoutSeries = [...series, { key: 'problematic', color: hue.problematic }]

  return (
    <div className="dt-trend">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="dt-trend-svg"
        role="img"
        aria-label={
          `Drive test trend over ${months.length} months. ` +
          // The two drawn series, then the figure in the caption. Built from
          // `series` rather than `readoutSeries` because only a drawn series
          // has points to read a latest value off.
          series
            .map((s) => {
              const last = [...s.points].reverse().find((p) => p.value != null)
              return last ? `${seriesLabel[s.key] || s.key} latest ${last.value}.` : ''
            })
            .join(' ') +
          (problematicNow
            ? ` ${seriesLabel.problematic || 'Problematic'} latest ${problematicNow.value}, not plotted.`
            : '')
        }
      >
        <defs>
          <linearGradient id="dt-fill-remaining" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--dt-ongoing)" stopOpacity="0.14" />
            <stop offset="100%" stopColor="var(--dt-ongoing)" stopOpacity="0.02" />
          </linearGradient>
        </defs>

        {/* Main panel gridlines and scale */}
        {ticks.map((t) => {
          const value = mainMax * (1 - t)
          const y = MAIN_TOP + MAIN_H * t
          return (
            <g key={`main-${t}`}>
              <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={y} y2={y} className="dt-gridline" />
              <text x={PAD_L - 8} y={y + 4} className="dt-axis-label" textAnchor="end">
                {count(Math.round(value))}
              </text>
            </g>
          )
        })}

        {/* Series */}
        {series.map((s, si) => {
          const runs = segments(s.points, 'value')
          const baseline = mainBase
          const fill = 'url(#dt-fill-remaining)'
          return (
            <g key={s.key}>
              {s.area &&
                runs.map((run, i) => (
                  <FadeArea
                    key={`a-${i}`}
                    d={areaFor(run, x, s.y, baseline)}
                    fill={fill}
                    delay={si * 0.12}
                  />
                ))}
              {runs.map((run, i) => {
                // The final segment ends on the month in progress, whose
                // figures are the last reading rather than a closing one.
                // Drawn dashed so it does not read as settled.
                const openTail = run[run.length - 1]?.is_open && run.length > 1
                const solid = openTail ? run.slice(0, -1) : run
                return (
                  <g key={`l-${i}`}>
                    {solid.length > 1 && (
                      <DrawPath d={lineFor(solid, x, s.y)} stroke={s.color} delay={si * 0.12} />
                    )}
                    {openTail && (
                      <DrawPath
                        d={lineFor(run.slice(-2), x, s.y)}
                        stroke={s.color}
                        dashed
                        delay={si * 0.12}
                      />
                    )}
                  </g>
                )
              })}
              {s.points.map((p, i) =>
                p.value == null ? null : (
                  <motion.circle
                    key={`d-${i}`}
                    cx={x(i)}
                    cy={s.y(p.value)}
                    r={p.is_open || p.estimated ? 3.5 : 2.5}
                    fill={p.is_open || p.estimated ? 'var(--surface-1)' : s.color}
                    stroke={s.color}
                    strokeWidth={p.is_open || p.estimated ? 2 : 0}
                    initial={reduced ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.5 + si * 0.1 + i * 0.02, duration: 0.3 }}
                  />
                ),
              )}
            </g>
          )
        })}

        {/* Month labels */}
        {months.map((m, i) =>
          i % labelEvery === 0 || i === months.length - 1 ? (
            <text
              key={`x-${i}`}
              x={x(i)}
              y={AXIS_Y}
              className={`dt-axis-label dt-farsi${m.is_open ? ' dt-axis-current' : ''}`}
              textAnchor="middle"
            >
              {m.label}
            </text>
          ) : null,
        )}

        {/* Hover rule */}
        {hovered && (
          <line
            x1={x(hover)}
            x2={x(hover)}
            y1={MAIN_TOP}
            y2={mainBase}
            className="dt-hover-rule"
          />
        )}

        {/* One hit area per month. A transparent rect rather than pointer
            events on the marks themselves, so the whole column responds and
            a reader does not have to find a 2px dot. */}
        {months.map((m, i) => (
          <rect
            key={`h-${i}`}
            x={x(i) - PLOT_W / (model.n - 1) / 2}
            y={MAIN_TOP}
            width={PLOT_W / (model.n - 1)}
            height={mainBase - MAIN_TOP}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      <ProblematicCaption
        now={problematicNow}
        then={problematicThen}
        label={seriesLabel.problematic || 'Problematic'}
        months={months.length}
      />

      {hovered && (
        <div className="dt-trend-readout" role="status">
          <span className="dt-farsi dt-readout-month">
            {hovered.label} {hovered.shamsi_year}
          </span>
          {hovered.captured ? (
            <>
              {readoutSeries.map((s) => (
                <span key={s.key} className="dt-readout-item">
                  <i style={{ background: s.color }} />
                  {seriesLabel[s.key] || s.key}
                  <b className="tnum">{count(hovered[s.key])}</b>
                </span>
              ))}
              {hovered.estimated && <em>opening reading — this month has no closing balance</em>}
              {hovered.is_open && <em>still in progress</em>}
            </>
          ) : (
            <em>not captured — nobody signed in during this month</em>
          )}
        </div>
      )}
    </div>
  )
}

/** Problematic as a figure: where it is now, and which way it has moved.
 *
 * The third series used to be a strip under the chart with its own vertical
 * scale. What a reader took from that strip was, in practice, exactly two
 * things -- the current level and the direction -- and both of them fit in a
 * sentence that costs no gridlines, no second axis and no explaining.
 *
 * The direction is measured between the first and last *captured* months in
 * the window. An uncaptured month was never measured, so a change read across
 * one would be a movement nobody observed. With only one reading there is a
 * level and no direction, and it says the level.
 */
function ProblematicCaption({ now, then, label, months }) {
  if (!now) return null

  const change = then ? now.value - then.value : null
  const direction = change == null || change === 0 ? null : change > 0 ? 'up' : 'down'

  return (
    <p className="dt-trend-caption">
      <i style={{ background: 'var(--dt-problem)' }} aria-hidden="true" />
      {label}
      <b className="tnum">{count(now.value)}</b>
      {direction ? (
        <span className={`dt-trend-move dt-trend-${direction}`}>
          {direction === 'up' ? '\u2191' : '\u2193'}
          <span className="tnum">{count(Math.abs(change))}</span> over these {months} months
        </span>
      ) : (
        <span className="dt-trend-move">
          {change === 0 ? `unchanged over these ${months} months` : 'one reading only'}
        </span>
      )}
      {/* Not drawn above, and said so rather than left to be noticed: a
          reader who sees it in the legend and cannot find the line spends
          longer looking for it than this sentence takes to read. */}
      <span className="dt-trend-caption-note">
        not plotted — hover a month for its figure
      </span>
    </p>
  )
}
