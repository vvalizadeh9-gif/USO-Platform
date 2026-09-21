import { motion, useReducedMotion } from 'framer-motion'
import { useId, useMemo, useState } from 'react'
import { shamsiMonthName } from '../../../lib/shamsi'
import { STATE_COLOR } from '../constants'
import { count, share } from '../format'
import { DeltaChip } from '../KpiBand'
import { DrawPath, FadeArea } from './primitives'

/**
 * Sites on air against drive tests done, read two ways.
 *
 * WHAT THIS ANSWERS. The KPI band already says how many sites are on air and
 * how many are done, as of right now. It cannot say whether the gap between
 * them has been closing or widening, or whether this month looks like the
 * last one. This chart is the trailing shape behind those two totals: every
 * month since the obligation was tracked, on-aired and drive-tested, running.
 *
 * TWO READINGS OF THE SAME LEDGER. Cumulative is the honest one — it starts
 * from the opening balance the programme actually carried into Farvardin
 * 1404 and never resets, so the totals on it are the real totals. Current
 * year restarts at zero on purpose: a reader asking "how is this year going"
 * is asking a bounded question, and answering it against a total that
 * includes years of prior work would hide a bad quarter inside a good
 * decade. Neither is more correct than the other; they answer different
 * questions, which is why both stay one click apart rather than one
 * replacing the other.
 *
 * NO GRIDLINES, NO AXIS, NO HATCH. The figures a reader would check a
 * y-axis against -- On-aired, DT done, Gap, Coverage -- are already named in
 * the text row above the chart, in numerals rather than a ruler a reader has
 * to interpolate against. What is left to draw is the shape: two lines and
 * the gap between them, which a soft gradient reads as a shadow the second
 * line casts rather than a ribbon that has to be decoded against a legend.
 */

const VIEW_W = 740
const VIEW_H = 300

const PAD_L = 16
const MAIN_TOP = 16
const MAIN_H = 228
const MAIN_W = 700
const PLOT_RIGHT = PAD_L + MAIN_W
const MAIN_AXIS_Y = MAIN_TOP + MAIN_H + 20

/** A rounded ceiling for an axis, so the plot has a readable amount of
 * headroom above its highest point. */
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

/** A round floor visibly below the minimum, for an axis that does not open
 * at zero. Picks the largest "nice" number that still sits under 85% of the
 * minimum, so the reader always has a labelled step between the floor and
 * the lowest point actually drawn. */
function niceFloorBelow(value) {
  if (value <= 0) return 0
  const target = value * 0.85
  const magnitude = 10 ** Math.floor(Math.log10(Math.max(target, 1)))
  for (const step of [10, 5, 2.5, 2, 1]) {
    const candidate = step * magnitude
    if (candidate <= target) return candidate
  }
  return magnitude / 10
}

/** Running totals from the opening balance, one point per month plus the
 * start, Farvardin 1404 to now. */
export function cumulativePoints(data) {
  let onAir = data.opening.on_air
  let dtDone = data.opening.dt_done
  const points = [{ year: null, month: null, onAir, dtDone, gap: onAir - dtDone, isOpen: false }]
  for (const m of data.months) {
    onAir += m.on_aired
    dtDone += m.dt_done
    points.push({ year: m.year, month: m.month, onAir, dtDone, gap: onAir - dtDone, isOpen: m.is_open })
  }
  return points
}

/** Running totals restarting at zero for one Shamsi year. */
export function yearPoints(data, year) {
  const months = data.months.filter((m) => m.year === year)
  let onAir = 0
  let dtDone = 0
  const points = [{ year, month: null, onAir, dtDone, gap: 0, isOpen: false }]
  for (const m of months) {
    onAir += m.on_aired
    dtDone += m.dt_done
    points.push({ year: m.year, month: m.month, onAir, dtDone, gap: onAir - dtDone, isOpen: m.is_open })
  }
  return points
}

/** Whether the payload has anything at all to draw. An opening balance of
 * zero and every month empty is a brand-new deployment, not a chart. */
export function flowHasActivity(data) {
  if (!data || !data.opening || !Array.isArray(data.months)) return false
  return (
    data.opening.on_air > 0 ||
    data.opening.dt_done > 0 ||
    data.months.some((m) => m.on_aired > 0 || m.dt_done > 0)
  )
}

export default function FlowChart({ data }) {
  const reduced = useReducedMotion()
  const base = useId()
  const [tab, setTab] = useState('cumulative')

  const years = useMemo(() => {
    const set = new Set(data.months.map((m) => m.year))
    return Array.from(set).sort((a, b) => a - b)
  }, [data])

  const [year, setYear] = useState(() => years[years.length - 1])
  const selectedYear = years.includes(year) ? year : years[years.length - 1]

  const isCumulative = tab === 'cumulative'
  const points = isCumulative ? cumulativePoints(data) : yearPoints(data, selectedYear)
  const months = isCumulative ? data.months : data.months.filter((m) => m.year === selectedYear)

  const [active, setActive] = useState(null)

  const n = points.length
  const x = (i) => PAD_L + (MAIN_W * i) / Math.max(n - 1, 1)

  const values = points.flatMap((p) => [p.onAir, p.dtDone])
  const ceiling = niceMax(Math.max(1, ...values))
  const floor = isCumulative ? niceFloorBelow(Math.min(points[0].onAir, points[0].dtDone)) : 0
  const span = Math.max(ceiling - floor, 1)
  const y = (v) => MAIN_TOP + MAIN_H - ((v - floor) / span) * MAIN_H

  const last = points[n - 1]
  const prev = n > 1 ? points[n - 2] : null
  const gapDelta = prev ? last.gap - prev.gap : null

  const openTail = last.isOpen && n > 1

  const solidLineFor = (key) => (openTail ? points.slice(0, -1) : points)
    .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(i)},${y(p[key])}`)
    .join(' ')
  const dashedLineFor = (key) =>
    `M${x(n - 2)},${y(points[n - 2][key])} L${x(n - 1)},${y(points[n - 1][key])}`

  // A plain computation, not a useMemo: `x`/`y` are cheap closures rebuilt
  // every render anyway, so memoising against them would never skip work.
  const areaPath =
    n < 2
      ? ''
      : `M${x(0)},${y(points[0].onAir)} ${points.map((p, i) => `L${x(i)},${y(p.onAir)}`).join(' ')} ${[...points]
          .reverse()
          .map((p, i) => `L${x(n - 1 - i)},${y(p.dtDone)}`)
          .join(' ')} Z`

  const labelEvery = isCumulative ? 3 : months.length > 8 ? 2 : 1

  const handleKey = (e) => {
    if (!months.length) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setActive((i) => (i == null ? months.length - 1 : Math.max(0, i - 1)))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setActive((i) => (i == null ? 0 : Math.min(months.length - 1, i + 1)))
    }
  }

  const activeMonth = active == null ? null : months[active]
  const activePoint = active == null ? null : points[active + 1]

  const notPlaced = data.not_placed?.on_air ?? 0

  return (
    <div className="dt-flowcard">
      <div className="dt-flow-controls">
        <div className="dt-tabs" role="tablist" aria-label="How to read the flow">
          {[
            { key: 'cumulative', label: 'Cumulative' },
            { key: 'year', label: 'Current year' },
          ].map((t) => (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={tab === t.key}
              className={`dt-tab${tab === t.key ? ' dt-tab-active' : ''}`}
              onClick={() => {
                setTab(t.key)
                setActive(null)
              }}
            >
              {t.label}
            </button>
          ))}
        </div>
        {tab === 'year' && (
          <select
            className="dt-flow-yearselect"
            aria-label="Year"
            value={selectedYear}
            onChange={(e) => {
              setYear(Number(e.target.value))
              setActive(null)
            }}
          >
            {years.map((yr) => (
              <option key={yr} value={yr}>
                {yr}
              </option>
            ))}
          </select>
        )}
      </div>

      <ul className="dt-flowtiles">
        <li className="dt-flowtile dt-flowtile-ongoing">
          <span className="dt-flowtile-label">On-aired</span>
          <span className="dt-flowtile-figure tnum">{count(last.onAir)}</span>
        </li>
        <li className="dt-flowtile dt-flowtile-done">
          <span className="dt-flowtile-label">DT done</span>
          <span className="dt-flowtile-figure tnum">{count(last.dtDone)}</span>
        </li>
        <li className="dt-flowtile dt-flowtile-problem">
          <span className="dt-flowtile-label">Gap</span>
          <span className="dt-flowtile-figure tnum">{count(last.gap)}</span>
          <DeltaChip delta={gapDelta} direction="down" />
        </li>
        <li className="dt-flowtile">
          <span className="dt-flowtile-label">Coverage</span>
          <span className="dt-flowtile-figure tnum">{share(last.dtDone, last.onAir)}</span>
        </li>
      </ul>

      <ul className="dt-flow-legend">
        <li className="dt-flow-legend-item">
          <i className="dt-flow-legend-dot" style={{ background: STATE_COLOR.ongoing }} />
          On-aired
        </li>
        <li className="dt-flow-legend-item">
          <i className="dt-flow-legend-dot" style={{ background: STATE_COLOR.done }} />
          DT done
        </li>
        <li className="dt-flow-legend-item dt-flow-legend-item-muted">
          <i className="dt-flow-legend-swatch" />
          Gap between them
        </li>
      </ul>

      <div
        className="dt-flowchart"
        tabIndex={0}
        role="img"
        onKeyDown={handleKey}
        aria-label={
          `On-aired vs drive tests done, ${isCumulative ? 'cumulative' : `year ${selectedYear}`}. ` +
          `On-aired ${last.onAir}, DT done ${last.dtDone}, gap ${last.gap}.` +
          (last.isOpen ? ' The latest month is still in progress.' : '')
        }
      >
        <svg viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} className="dt-flowchart-svg">
          <defs>
            {/* A soft shadow rather than a textured ribbon: the two lines and
                the space between them are the whole chart now, so the gap
                can read as a shadow one line casts on the other instead of a
                ribbon that needs decoding against a legend. */}
            <linearGradient id={`${base}-gap-gradient`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="var(--dt-problem)" stopOpacity="0.12" />
              <stop offset="100%" stopColor="var(--dt-problem)" stopOpacity="0.03" />
            </linearGradient>
          </defs>

          {/* One hairline baseline, at the foot of the plot -- not a ruler,
              just where the months sit. */}
          <line x1={PAD_L} x2={PLOT_RIGHT} y1={MAIN_TOP + MAIN_H} y2={MAIN_TOP + MAIN_H} className="dt-gridline" />

          {/* The gap between the lines, as a soft fill rather than a ribbon
              that needs its own legend entry. */}
          {areaPath && <FadeArea d={areaPath} fill={`url(#${base}-gap-gradient)`} />}

          {/* Year boundaries, cumulative only. */}
          {isCumulative &&
            data.months.map((m, j) =>
              m.month === 1 && j > 0 ? (
                <g key={`yr-${m.year}`}>
                  <line
                    x1={x(j + 1)}
                    x2={x(j + 1)}
                    y1={MAIN_TOP}
                    y2={MAIN_TOP + MAIN_H}
                    className="dt-flowchart-yearline"
                  />
                </g>
              ) : null,
            )}

          {/* Series lines */}
          {[
            { key: 'onAir', color: STATE_COLOR.ongoing },
            { key: 'dtDone', color: STATE_COLOR.done },
          ].map((s) => (
            <g key={s.key}>
              <DrawPath d={solidLineFor(s.key)} stroke={s.color} strokeWidth={2} />
              {openTail && <DrawPath d={dashedLineFor(s.key)} stroke={s.color} strokeWidth={2} dashed />}
              {points.map((p, i) => {
                const isLastOpen = openTail && i === n - 1
                return (
                  <motion.circle
                    key={`d-${s.key}-${i}`}
                    data-testid={isLastOpen ? 'dt-flow-open-dot' : undefined}
                    cx={x(i)}
                    cy={y(p[s.key])}
                    r={isLastOpen ? 4 : 3}
                    fill={isLastOpen ? 'var(--surface-1)' : s.color}
                    stroke={s.color}
                    strokeWidth={isLastOpen ? 2 : 0}
                    initial={reduced ? false : { scale: 0, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    transition={{ delay: 0.5 + i * 0.02, duration: 0.3 }}
                  />
                )
              })}
            </g>
          ))}

          {/* Month labels */}
          {months.map((m, j) =>
            j % labelEvery === 0 || j === months.length - 1 ? (
              <g key={`x-${j}`}>
                <text
                  x={x(j + 1)}
                  y={MAIN_AXIS_Y}
                  className={`dt-axis-label dt-farsi${m.is_open ? ' dt-axis-current' : ''}`}
                  textAnchor="middle"
                >
                  {shamsiMonthName(m.month)}
                </text>
                {isCumulative && m.month === 1 && (
                  <text x={x(j + 1)} y={MAIN_AXIS_Y + 13} className="dt-axis-label" textAnchor="middle">
                    {m.year}
                  </text>
                )}
              </g>
            ) : null,
          )}

          {/* Hit areas and hover/focus crosshair, spanning the plot. */}
          {active != null && (
            <line
              x1={x(active + 1)}
              x2={x(active + 1)}
              y1={MAIN_TOP}
              y2={MAIN_TOP + MAIN_H}
              className="dt-hover-rule"
            />
          )}
          {months.map((m, j) => (
            <rect
              key={`h-${j}`}
              x={x(j + 1) - MAIN_W / Math.max(n - 1, 1) / 2}
              y={MAIN_TOP}
              width={MAIN_W / Math.max(n - 1, 1)}
              height={MAIN_H}
              fill="transparent"
              onMouseEnter={() => setActive(j)}
              onMouseLeave={() => setActive(null)}
            />
          ))}
        </svg>
      </div>

      {activeMonth && activePoint && (
        <div className="dt-trend-readout" role="status">
          <span className="dt-farsi dt-readout-month">
            {shamsiMonthName(activeMonth.month)} {activeMonth.year}
          </span>
          <span className="dt-readout-item">
            <i style={{ background: STATE_COLOR.ongoing }} />
            On-aired this month
            <b className="tnum">{count(activeMonth.on_aired)}</b>
          </span>
          <span className="dt-readout-item">
            <i style={{ background: STATE_COLOR.done }} />
            DT done this month
            <b className="tnum">{count(activeMonth.dt_done)}</b>
          </span>
          <span className="dt-readout-item">
            <i style={{ background: 'var(--dt-problem)' }} />
            Gap this month
            <b className="tnum">{count(activeMonth.on_aired - activeMonth.dt_done)}</b>
          </span>
          <span className="dt-readout-item">
            Running: {count(activePoint.onAir)} on-aired, {count(activePoint.dtDone)} done, gap{' '}
            <b className="tnum">{count(activePoint.gap)}</b>
          </span>
          {activeMonth.is_open && <em>still in progress</em>}
        </div>
      )}

      <p className="dt-note">
        {isCumulative
          ? 'The running total starts from the opening balance on 1 Farvardin 1404.'
          : `This counts only ${selectedYear}, so its gap differs from the cumulative one.`}
        {isCumulative && floor > 0 && ` Chart scale starts at ${count(floor)}, not zero.`}
      </p>
      {notPlaced > 0 && (
        <p className="dt-note">
          {count(notPlaced)} {notPlaced === 1 ? 'site has' : 'sites have'} no on-air date and are not
          counted.
        </p>
      )}
    </div>
  )
}
