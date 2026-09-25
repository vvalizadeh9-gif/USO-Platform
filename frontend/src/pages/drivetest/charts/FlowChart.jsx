import { motion, useReducedMotion } from 'framer-motion'
import { useId, useState } from 'react'
import { shamsiMonthName } from '../../../lib/shamsi'
import { STATE_COLOR } from '../constants'
import { count, share } from '../format'
import { DeltaChip } from '../KpiBand'
import { flowView, labelledMonths, netChanges } from './flowView'
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
 * ONE LEDGER, ZOOMED BY YEAR. It opens on every year together -- the whole
 * trajectory since the opening balance carried into Farvardin 1404, which is
 * the question the card's title asks -- and a year can be picked on its own.
 * A single year is a window onto the same running totals, not a count
 * restarted at zero, so every figure on it is still a real total: the gap is
 * the real backlog at each month's end. What changes is the room: a year's
 * months get the whole width, so every month (or every other) is named and
 * each month's pill has space, and the scale fits that year's range. The
 * year's own activity -- how much it put on air and drive-tested -- is added
 * to the stat line.
 *
 * NO GRIDLINES, NO AXIS, NO HATCH. The figures a reader would check a
 * y-axis against -- On-aired, DT done, Gap, Coverage -- are already named in
 * the stat line above the chart, in numerals rather than a ruler a reader has
 * to interpolate against. What is left to draw is the shape: two lines and
 * the gap between them, which a soft gradient reads as a shadow the second
 * line casts rather than a ribbon that has to be decoded against a legend.
 *
 * THE PAGE CHOOSES THE YEARS. Which years are on screen is a prop, because
 * the card header carries both the control that switches them and the info
 * note that describes the view (where its scale starts), and those must
 * agree with what is drawn. The arithmetic is in
 * `flowView.js` for the same reason: the chart and the note read one copy.
 *
 * THE READOUT IS NEVER BLANK. It opens on the latest month and returns there
 * when the pointer leaves, so the running totals and "this month" are on
 * screen without anyone having to find them by hovering.
 */

const VIEW_W = 740
const VIEW_H = 318

const PAD_L = 16
const MAIN_TOP = 16
const MAIN_H = 228
const MAIN_W = 700
const PLOT_RIGHT = PAD_L + MAIN_W
const MAIN_AXIS_Y = MAIN_TOP + MAIN_H + 20

/** The net-change strip, under the month labels and the year captions. */
const STRIP_TOP = MAIN_AXIS_Y + 26
const STRIP_H = 20

export default function FlowChart({ data, scope = 'all' }) {
  const reduced = useReducedMotion()
  const base = useId()
  const { selected, isAll, points, months, ceiling, floor, yearActivity } = flowView(data, scope)

  // The month the crosshair and readout show. `null` is "the latest", which
  // is where the chart opens and where it returns when the pointer leaves.
  const [hover, setHover] = useState(null)
  const latest = months.length - 1
  const active = hover != null && hover <= latest ? hover : latest

  const n = points.length
  const x = (i) => PAD_L + (MAIN_W * i) / Math.max(n - 1, 1)
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

  const labelEvery = isAll ? 3 : months.length > 8 ? 2 : 1
  const labelled = labelledMonths(months, labelEvery, isAll)

  const handleKey = (e) => {
    if (!months.length) return
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      setHover(Math.max(0, active - 1))
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      setHover(Math.min(latest, active + 1))
    }
  }

  const activeMonth = months[active]
  const activePoint = points[active + 1]

  // One per month drawn, in the same order as `months`: points[0] is the
  // opening balance, so the step into month j is netChanges()[j].
  const nets = netChanges(points)
  const slotW = MAIN_W / Math.max(n - 1, 1)
  const pillW = Math.min(slotW - 4, 42)

  return (
    <div className="dt-flowcard">
      {/* The stat line: the four figures a reader would otherwise check an
          axis against, in one row rather than a row of tiles. */}
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
        </li>
        {gapDelta != null && (
          <li className="dt-flowtile">
            {/* "Previous month", not "last month": in a past year's view the
                last step is that year's Esfand against its Bahman. */}
            <span className="dt-flowtile-label">vs previous month</span>
            <DeltaChip delta={gapDelta} direction="down" small />
          </li>
        )}
        <li className="dt-flowtile">
          <span className="dt-flowtile-label">Coverage</span>
          <span className="dt-flowtile-figure tnum">{share(last.dtDone, last.onAir)}</span>
        </li>
        {yearActivity && (
          <li className="dt-flowtile dt-flowtile-year" data-testid="dt-flow-year-activity">
            <span className="dt-flowtile-label">In {selected}</span>
            <span className="dt-flowtile-note tnum">
              +{count(yearActivity.onAired)} on air · +{count(yearActivity.dtDone)} done
            </span>
          </li>
        )}
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
        <li className="dt-flow-legend-item dt-flow-legend-item-muted">
          <i className="dt-flow-legend-pill" />
          Change in pending, per month — green shrank, red grew
        </li>
      </ul>

      <div
        className="dt-flowchart"
        tabIndex={0}
        role="img"
        onKeyDown={handleKey}
        onMouseLeave={() => setHover(null)}
        aria-label={
          `On-aired vs drive tests done, running totals, ${isAll ? 'every year' : selected}. ` +
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

          {areaPath && <FadeArea d={areaPath} fill={`url(#${base}-gap-gradient)`} />}

          {/* Year boundaries, cumulative only. */}
          {isAll &&
            data.months.map((m, j) =>
              m.month === 1 && j > 0 ? (
                <line
                  key={`yr-${m.year}`}
                  x1={x(j + 1)}
                  x2={x(j + 1)}
                  y1={MAIN_TOP}
                  y2={MAIN_TOP + MAIN_H}
                  className="dt-flowchart-yearline"
                />
              ) : null,
            )}

          {/* The crosshair, always on a month: the latest one until a reader
              points somewhere else. */}
          {months.length > 0 && (
            <line
              data-testid="dt-flow-crosshair"
              x1={x(active + 1)}
              x2={x(active + 1)}
              y1={MAIN_TOP}
              y2={MAIN_TOP + MAIN_H}
              className="dt-hover-rule"
            />
          )}

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

          {/* Month names: every third step in the cumulative view, the year
              on a second line under each Farvardin -- see labelledMonths for
              how the latest month is fitted in without a collision. */}
          {months.map((m, j) =>
            labelled.has(j) ? (
              <g key={`x-${j}`} data-testid="dt-flow-month-label">
                <text
                  x={x(j + 1)}
                  y={MAIN_AXIS_Y}
                  className={`dt-axis-label dt-farsi${m.is_open ? ' dt-axis-current' : ''}`}
                  textAnchor="middle"
                >
                  {shamsiMonthName(m.month)}
                </text>
                {isAll && m.month === 1 && (
                  <text x={x(j + 1)} y={MAIN_AXIS_Y + 14} className="dt-axis-label" textAnchor="middle">
                    {m.year}
                  </text>
                )}
              </g>
            ) : null,
          )}

          {/* Hit areas, one per month, spanning the plot and the pills. */}
          {months.map((m, j) => (
            <rect
              key={`h-${j}`}
              x={x(j + 1) - slotW / 2}
              y={MAIN_TOP}
              width={slotW}
              height={STRIP_TOP + STRIP_H - MAIN_TOP}
              fill="transparent"
              onMouseEnter={() => setHover(j)}
            />
          ))}

          {/* What each month did to the backlog, one pill per month under the
              axis. The lines above answer "where are we"; this says outright,
              once per month, whether that month helped or hurt. The pill of
              the month the readout is on is outlined, so the two read as one. */}
          {months.map((m, j) => {
            const net = nets[j]
            const tone = net === 0 ? 'flat' : net < 0 ? 'good' : 'bad'
            return (
              <g
                key={`net-${j}`}
                data-testid="dt-flow-net"
                data-tone={tone}
                data-active={j === active || undefined}
                pointerEvents="none"
              >
                <rect
                  x={x(j + 1) - pillW / 2}
                  y={STRIP_TOP}
                  width={pillW}
                  height={STRIP_H}
                  rx={STRIP_H / 2}
                  className={`dt-flow-net-pill dt-flow-net-${tone}`}
                />
                <text
                  x={x(j + 1)}
                  y={STRIP_TOP + STRIP_H / 2}
                  className={`dt-flow-net-text dt-flow-net-text-${tone}`}
                  textAnchor="middle"
                  dominantBaseline="central"
                >
                  {net > 0 ? '+' : ''}
                  {count(net)}
                </text>
              </g>
            )
          })}
        </svg>
      </div>

      {activeMonth && activePoint && (
        <div className="dt-trend-readout" role="status" data-testid="dt-flow-readout">
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
    </div>
  )
}
