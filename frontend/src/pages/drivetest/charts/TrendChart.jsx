import { motion, useReducedMotion } from 'framer-motion'
import { useMemo, useState } from 'react'
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
 * TWO PANELS, ONE AXIS. Remaining and completed are comparable magnitudes and
 * share the upper panel. Problematic is an order of magnitude smaller and on
 * that scale would be a flat line along the floor, so it gets its own strip
 * with its own vertical scale, under the same months. The alternative — a
 * second y-axis on the same panel — makes two unrelated scales look like one
 * and is how charts end up lying.
 *
 * WHAT THE DRAWING ADMITS. The series is assembled from monthly snapshots
 * that are written when someone signs in, not on a schedule, so it has three
 * kinds of imperfection and draws each of them rather than smoothing it away:
 * an uncaptured month breaks the line, a month whose figures had to be taken
 * from the opening reading is marked with a hollow point, and the month still
 * in progress is drawn dashed with an open endpoint.
 */

const VIEW_W = 760
const PAD_L = 46
const PAD_R = 14
const MAIN_TOP = 14
const MAIN_H = 168
const STRIP_TOP = 214
const STRIP_H = 46
const AXIS_Y = 286
const VIEW_H = 300

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
    const stripValues = problematic.map((p) => p.value).filter((v) => v != null)

    const mainMax = niceMax(Math.max(1, ...mainValues))
    const stripMax = niceMax(Math.max(1, ...stripValues))

    const mainY = (v) => MAIN_TOP + MAIN_H - (v / mainMax) * MAIN_H
    const stripY = (v) => STRIP_TOP + STRIP_H - (v / stripMax) * STRIP_H

    return { x, remaining, done, problematic, mainMax, stripMax, mainY, stripY, n }
  }, [months])

  if (!months.length) return null

  const { x, remaining, done, problematic, mainMax, stripMax, mainY, stripY } = model
  const mainBase = MAIN_TOP + MAIN_H
  const stripBase = STRIP_TOP + STRIP_H
  const ticks = [0, 0.5, 1]

  // Label every month when they fit, otherwise every other one. Twelve labels
  // in Persian across this width overlap; six do not.
  const labelEvery = months.length > 8 ? 2 : 1
  const hovered = hover == null ? null : months[hover]

  const series = [
    { key: 'remaining', points: remaining, color: 'var(--amber)', y: mainY, area: true },
    { key: 'dt_done', points: done, color: 'var(--green)', y: mainY, area: false },
    { key: 'problematic', points: problematic, color: 'var(--red)', y: stripY, area: true },
  ]

  return (
    <div className="dt-trend">
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="dt-trend-svg"
        role="img"
        aria-label={
          `Drive test trend over ${months.length} months. ` +
          series
            .map((s) => {
              const last = [...s.points].reverse().find((p) => p.value != null)
              return last ? `${seriesLabel[s.key] || s.key} latest ${last.value}.` : ''
            })
            .join(' ')
        }
      >
        <defs>
          <linearGradient id="dt-fill-remaining" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.28" />
            <stop offset="100%" stopColor="var(--amber)" stopOpacity="0.02" />
          </linearGradient>
          <linearGradient id="dt-fill-problematic" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--red)" stopOpacity="0.3" />
            <stop offset="100%" stopColor="var(--red)" stopOpacity="0.03" />
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

        {/* Problematic strip: its own scale, labelled so nobody reads it
            against the panel above. */}
        <line x1={PAD_L} x2={VIEW_W - PAD_R} y1={stripBase} y2={stripBase} className="dt-gridline" />
        <text x={PAD_L - 8} y={STRIP_TOP + 10} className="dt-axis-label" textAnchor="end">
          {count(stripMax)}
        </text>
        <text x={PAD_L - 8} y={stripBase + 4} className="dt-axis-label" textAnchor="end">
          0
        </text>

        {/* Series */}
        {series.map((s, si) => {
          const runs = segments(s.points, 'value')
          const baseline = s.key === 'problematic' ? stripBase : mainBase
          const fill = s.key === 'remaining'
            ? 'url(#dt-fill-remaining)'
            : 'url(#dt-fill-problematic)'
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
            y2={stripBase}
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
            height={stripBase - MAIN_TOP}
            fill="transparent"
            onMouseEnter={() => setHover(i)}
            onMouseLeave={() => setHover(null)}
          />
        ))}
      </svg>

      {hovered && (
        <div className="dt-trend-readout" role="status">
          <span className="dt-farsi dt-readout-month">
            {hovered.label} {hovered.shamsi_year}
          </span>
          {hovered.captured ? (
            <>
              {series.map((s) => (
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
