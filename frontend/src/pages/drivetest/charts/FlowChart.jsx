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
 * WHY A HATCH, NOT A COLOUR ALONE. The gap between the lines is the thing a
 * reader is actually here to see the shape of, and shading it in a flat
 * problem-red would make the chart's most important feature legible only to
 * someone who can see that hue as distinct from the two lines either side of
 * it. Diagonal hatching survives that: a colour-blind reader still sees the
 * area is textured differently from the plot around it.
 */

const VIEW_W = 740
const VIEW_H = 392

const PAD_L = 46
const MAIN_TOP = 16
const MAIN_H = 228
const MAIN_W = 518
const PLOT_RIGHT = PAD_L + MAIN_W
const MAIN_AXIS_Y = MAIN_TOP + MAIN_H + 20

const STRIP_TOP = 312
const STRIP_H = 62

const BRACKET_X = PLOT_RIGHT + 8
const BRACKET_W = 5
const BADGE_X = BRACKET_X + BRACKET_W + 6
const BADGE_MIN_W = 50
const LABEL_MIN_GAP = 22

/** Badge width from its own text, so "Gap -2,982" never clips against a box
 * sized for "Gap 42". A rough monospace-ish estimate is plenty here -- the
 * badge only ever holds tabular digits and a fixed "Gap " prefix. */
function badgeWidthFor(text) {
  return Math.max(BADGE_MIN_W, text.length * 6.4 + 16)
}

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

  const gapValues = months.map((m) => m.on_aired - m.dt_done)
  const gapMax = niceMax(Math.max(1, ...gapValues.map((v) => Math.abs(v))))
  const zeroY = STRIP_TOP + STRIP_H / 2
  const stripY = (v) => zeroY - (v / gapMax) * (STRIP_H / 2)

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

  // Bracket, badge and end labels at the right edge -- separate x-lanes so
  // the badge and the two series labels can never collide however close the
  // two lines have drawn together.
  const yOnAir = y(last.onAir)
  const yDtDone = y(last.dtDone)
  const yTop = Math.min(yOnAir, yDtDone)
  const yBottom = Math.max(yOnAir, yDtDone)
  const badgeY = (yTop + yBottom) / 2

  let onAirLabelY = yOnAir
  let dtDoneLabelY = yDtDone
  if (Math.abs(yOnAir - yDtDone) < LABEL_MIN_GAP) {
    const mid = (yOnAir + yDtDone) / 2
    if (yOnAir <= yDtDone) {
      onAirLabelY = mid - LABEL_MIN_GAP / 2
      dtDoneLabelY = mid + LABEL_MIN_GAP / 2
    } else {
      dtDoneLabelY = mid - LABEL_MIN_GAP / 2
      onAirLabelY = mid + LABEL_MIN_GAP / 2
    }
  }

  const badgeText = `Gap ${count(last.gap)}`
  const badgeW = badgeWidthFor(badgeText)
  const labelX = BADGE_X + badgeW + 10

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
            <pattern id={`${base}-hatch`} width="6" height="6" patternTransform="rotate(45)" patternUnits="userSpaceOnUse">
              <rect width="6" height="6" fill="var(--dt-problem)" opacity="0.055" />
              <line x1="0" y1="0" x2="0" y2="6" stroke="var(--dt-problem)" strokeWidth="1.4" opacity="0.28" />
            </pattern>
          </defs>

          {/* Main plot gridlines and scale -- four bands, not two, so a
              reader can place a point without eyeballing a quarter-way
              interpolation between the only two labelled values. */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const value = floor + span * (1 - t)
            const gy = MAIN_TOP + MAIN_H * t
            return (
              <g key={`g-${t}`}>
                <line x1={PAD_L} x2={PLOT_RIGHT} y1={gy} y2={gy} className="dt-gridline" />
                <text x={PAD_L - 8} y={gy + 4} className="dt-axis-label" textAnchor="end">
                  {count(Math.round(value))}
                </text>
              </g>
            )
          })}

          {/* The gap, as a textured ribbon between the two lines. */}
          {areaPath && <FadeArea d={areaPath} fill={`url(#${base}-hatch)`} />}

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
              <DrawPath d={solidLineFor(s.key)} stroke={s.color} strokeWidth={3} />
              {openTail && <DrawPath d={dashedLineFor(s.key)} stroke={s.color} strokeWidth={3} dashed />}
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

          {/* Bracket, gap badge and end labels -- fixed lanes, so they never
              collide however close the two lines end up. */}
          <path
            d={`M${BRACKET_X},${yTop} H${BRACKET_X + BRACKET_W} V${yBottom} H${BRACKET_X}`}
            className="dt-flowchart-bracket"
          />
          <g transform={`translate(${BADGE_X}, ${badgeY})`}>
            <rect x={0} y={-10} width={badgeW} height={20} rx={10} className="dt-flowchart-badge" />
            <text x={badgeW / 2} y={4} textAnchor="middle" className="dt-flowchart-badge-text">
              {badgeText}
            </text>
          </g>
          <text x={labelX} y={onAirLabelY - 4} className="dt-flowchart-endlabel">
            On-aired
          </text>
          <text x={labelX} y={onAirLabelY + 10} className="dt-flowchart-endvalue tnum" style={{ fill: STATE_COLOR.ongoing }}>
            {count(last.onAir)}
          </text>
          <text x={labelX} y={dtDoneLabelY - 4} className="dt-flowchart-endlabel">
            DT done
          </text>
          <text x={labelX} y={dtDoneLabelY + 10} className="dt-flowchart-endvalue tnum" style={{ fill: STATE_COLOR.done }}>
            {count(last.dtDone)}
          </text>

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

          {/* Gap strip: one bar per month for that month's on-aired minus
              DT done, not the running total above. Named on its own line --
              without a caption the "+150 / 0 / -150" axis reads as a second,
              unexplained chart bolted under the first. */}
          <text x={PAD_L} y={STRIP_TOP - 16} className="dt-flowchart-caption">
            Monthly gap — on-aired minus DT done
          </text>
          <line x1={PAD_L} x2={PLOT_RIGHT} y1={zeroY} y2={zeroY} className="dt-gridline" />
          {[gapMax, 0, -gapMax].map((v) => (
            <text key={`s-${v}`} x={PAD_L - 8} y={stripY(v) + 4} className="dt-axis-label" textAnchor="end">
              {v > 0 ? '+' : ''}
              {count(Math.round(v))}
            </text>
          ))}
          {months.map((m, j) => {
            const v = m.on_aired - m.dt_done
            const cx = x(j + 1)
            const colWidth = MAIN_W / Math.max(n - 1, 1)
            const barW = Math.max(colWidth * 0.55, 3)
            const barY = Math.min(zeroY, stripY(v))
            const barH = Math.max(Math.abs(zeroY - stripY(v)), 1)
            return (
              <motion.rect
                key={`b-${j}`}
                x={cx - barW / 2}
                y={barY}
                width={barW}
                height={barH}
                fill={v >= 0 ? 'var(--dt-problem)' : 'var(--dt-done)'}
                initial={reduced ? false : { scaleY: 0 }}
                animate={{ scaleY: 1 }}
                style={{ transformOrigin: `${cx}px ${zeroY}px` }}
                transition={{ delay: 0.1 + j * 0.02, duration: 0.35 }}
              />
            )
          })}

          {/* Hit areas and hover/focus crosshair, spanning both plots. */}
          {active != null && (
            <line
              x1={x(active + 1)}
              x2={x(active + 1)}
              y1={MAIN_TOP}
              y2={STRIP_TOP + STRIP_H}
              className="dt-hover-rule"
            />
          )}
          {months.map((m, j) => (
            <rect
              key={`h-${j}`}
              x={x(j + 1) - MAIN_W / Math.max(n - 1, 1) / 2}
              y={MAIN_TOP}
              width={MAIN_W / Math.max(n - 1, 1)}
              height={STRIP_TOP + STRIP_H - MAIN_TOP}
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
