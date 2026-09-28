import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { shamsiMonthName } from '../../../lib/shamsi'
import { count } from '../format'
import { CUMULATIVE, flowView, netChanges } from './flowView'
import { FadeArea } from './primitives'

/**
 * Sites on air against drive tests done -- every month, or one year at a
 * time -- with each month's change in the gap under its column, and its
 * figures in a card that appears on hover.
 *
 * WHAT THIS ANSWERS. The KPI band already says how many sites are on air and
 * how many are done, as of right now. It cannot say whether the gap between
 * them has been closing or widening, or whether this month looks like the
 * last one. This chart is the trailing shape behind those two totals, and
 * the row under it says what each month did to the gap.
 *
 * ONE COLUMN PER MONTH. Every month in view gets a column, with its point at
 * the column's centre and its name under it. The rows under the plot share
 * its left gutter and the same columns, so each month's name and change sit
 * straight under its dots. The plot is drawn in columns, not a fixed canvas:
 * the lines stretch with the card while the labels, dots and figures stay at
 * their true size.
 *
 * THE HOVER CARD. Hovering, focusing or tapping a column marks it and shows
 * its figures -- this month's and the running totals -- in a card pinned to
 * the plot's top-left corner. Both lines only ever rise left to right, so
 * that corner is always empty: the card never covers a line, and it does
 * not follow the pointer or take its events, so moving from one month to the
 * next is never blocked. It is the only place the per-month figures appear.
 *
 * RUNNING TOTALS, CARRIED. The lines are the programme's real running totals,
 * carried from the opening balance on 1 Farvardin 1404 (see `flowView`), so
 * the last point is the KPI cards' figure and the gap is the real backlog. A
 * year view does not reset them to zero on 1 Farvardin.
 *
 * THE OPEN MONTH. A month still in progress gets hollow dots, a dashed last
 * segment and a light column highlight.
 *
 * COBALT COLOURS. DT done is the "done" series, so it takes the accent; On
 * air is the reference series and takes the muted neutral; the gap between
 * them is the accent's soft fill. A month's gap change is green where the
 * backlog shrank and brick where it grew, with its sign kept, so the colour
 * is never the only signal.
 *
 * THE PAGE CHOOSES THE VIEW. Which months are on screen is a prop, because
 * the card header carries both the control that switches it and the info
 * note that describes the view (where its scale starts), and those must
 * agree with what is drawn. The arithmetic is in `flowView.js` for the same
 * reason: the chart and the note read one copy.
 */

/** The two series. DT done is the "done" series (the accent); On-aired is the
 * reference it is read against (the muted neutral). */
const SERIES_COLOR = { onAir: 'var(--dt-muted)', dtDone: 'var(--accent)' }

/** Which way a month moved the backlog. Falling is the good direction. */
const toneOf = (v) => (v < 0 ? 'good' : v > 0 ? 'bad' : 'flat')
const GAP_WORD = { good: 'shrank', bad: 'grew', flat: 'no change' }
/** A figure with its sign, and a real minus sign ("−10"), not a hyphen. */
const withSign = (v) => (v > 0 ? `+${count(v)}` : v < 0 ? `−${count(-v)}` : '0')
const withMinus = (v) => (v < 0 ? `−${count(-v)}` : count(v))

/** The chart's key, on its own row under the card's title row: the two
 * series, the gap between them, the hollow dot that marks a month still in
 * progress, and the two tones of a month's change in the gap. */
export function FlowLegend() {
  return (
    <ul className="dt-flow-legend" aria-label="Chart key">
      <li className="dt-flow-legend-item">
        <i className="dt-flow-legend-line" style={{ background: SERIES_COLOR.onAir }} />
        On air
      </li>
      <li className="dt-flow-legend-item">
        <i className="dt-flow-legend-line" style={{ background: SERIES_COLOR.dtDone }} />
        DT done
      </li>
      <li className="dt-flow-legend-item">
        <i className="dt-flow-legend-swatch" />
        Gap
      </li>
      <li className="dt-flow-legend-item">
        <i className="dt-flow-legend-open" />
        Month in progress
      </li>
      <li className="dt-flow-legend-item">
        <i className="dt-flow-legend-pill" data-tone="good" aria-hidden="true">
          −
        </i>
        Gap shrank
      </li>
      <li className="dt-flow-legend-item">
        <i className="dt-flow-legend-pill" data-tone="bad" aria-hidden="true">
          +
        </i>
        Gap grew
      </li>
    </ul>
  )
}

export default function FlowChart({ data, scope = CUMULATIVE }) {
  const { selected, cumulative, points, months, floor, ceiling, ticks } = flowView(data, scope)
  const shown = cumulative ? 'every month since Farvardin 1404' : String(selected)
  const n = months.length
  // points[0] is the balance the year opened on; points[j + 1] is month j.
  const drawn = points.slice(1)
  const nets = netChanges(points)
  const last = drawn[n - 1]
  const openTail = last.isOpen && n > 1

  // The plot's own units: one per month across, 0-100 down. Stretched to
  // the plot's box, so a point sits at its column's centre at any width.
  const x = (j) => j + 0.5
  const span = Math.max(ceiling - floor, 1)
  const yPct = (v) => 100 - ((v - floor) / span) * 100
  const xPct = (j) => `${(x(j) / n) * 100}%`

  const lineFor = (key, from, to) =>
    drawn
      .slice(from, to)
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${x(from + i)},${yPct(p[key])}`)
      .join(' ')
  const areaPath =
    n < 2
      ? ''
      : `${lineFor('onAir', 0, n)} ${[...drawn]
          .reverse()
          .map((p, i) => `L${x(n - 1 - i)},${yPct(p.dtDone)}`)
          .join(' ')} Z`

  // Month names alternate onto two lines when a column is narrower than
  // 54px (19 months beside the side column at 1440 wide), rather than
  // shrinking or overlapping.
  const plotRef = useRef(null)
  const plotWidth = useWidth(plotRef)
  const stagger = plotWidth > 0 && plotWidth / n < STAGGER_BELOW
  useFitHeight(plotRef)

  // The month under the pointer, the keyboard focus or the last tap.
  const [active, setActive] = useState(null)
  const hovered = active != null && active < n ? active : null

  return (
    <div className="dt-flowcard" style={{ '--dt-flow-cols': n }}>
      <div className="dt-flow-scroll">
        <div
          className="dt-flow-frame"
          // A touch ends with a leave; the tapped month keeps its card until
          // another is tapped or the focus moves on.
          onPointerLeave={(e) => e.pointerType !== 'touch' && setActive(null)}
        >
          <div
            className="dt-flowchart"
            role="img"
            aria-label={
              `On air vs drive tests done, running totals, ${shown}. ` +
              `On air ${last.onAir}, DT done ${last.dtDone}, gap ${last.gap}.` +
              (last.isOpen ? ' The latest month is still in progress.' : '')
            }
          >
            <div className="dt-flow-yaxis" aria-hidden="true">
              {ticks.map((t) => (
                <span key={t} className="dt-flow-ytick tnum" style={{ top: `${yPct(t)}%` }}>
                  {count(t)}
                </span>
              ))}
            </div>
            <div className="dt-flow-plot" ref={plotRef}>
              {ticks.map((t) => (
                <i
                  key={t}
                  className={t === floor ? 'dt-flow-baseline' : 'dt-flow-grid'}
                  style={{ top: `${yPct(t)}%` }}
                />
              ))}
              {last.isOpen && (
                <i
                  className="dt-flow-opencol"
                  style={{ left: `${((n - 1) / n) * 100}%`, width: `${100 / n}%` }}
                />
              )}
              {/* The cumulative view spans years: a dashed line where each new
                  year starts, and its label at the top of the plot beside it. */}
              {cumulative &&
                months.map(
                  (m, j) =>
                    (j === 0 || m.month === 1) && (
                      <Fragment key={`year-${m.year}`}>
                        {j > 0 && (
                          <i className="dt-flow-yearline" style={{ left: `${(j / n) * 100}%` }} />
                        )}
                        <span
                          className="dt-flow-year tnum"
                          data-testid="dt-flow-year"
                          style={{ left: `calc(${(j / n) * 100}% + 6px)` }}
                        >
                          {m.year}
                        </span>
                      </Fragment>
                    ),
                )}
              {hovered != null && (
                <>
                  <i
                    className="dt-flow-hovercol"
                    data-testid="dt-flow-hovercol"
                    style={{ left: `${(hovered / n) * 100}%`, width: `${100 / n}%` }}
                  />
                  <i className="dt-flow-cross" style={{ left: xPct(hovered) }} />
                </>
              )}
              <svg
                className="dt-flowchart-svg"
                viewBox={`0 0 ${n} 100`}
                preserveAspectRatio="none"
                aria-hidden="true"
              >
                {areaPath && <FadeArea d={areaPath} fill="var(--accent-soft)" />}
                {/* Plain paths: the stroke keeps its screen width however the
                    plot is stretched (non-scaling), which a draw-on animation's
                    dash would break into pieces. */}
                {['onAir', 'dtDone'].map((key) => (
                  <g
                    key={key}
                    fill="none"
                    stroke={SERIES_COLOR[key]}
                    strokeWidth={2.5}
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d={lineFor(key, 0, openTail ? n - 1 : n)} vectorEffect="non-scaling-stroke" />
                    {openTail && (
                      <path
                        d={lineFor(key, n - 2, n)}
                        vectorEffect="non-scaling-stroke"
                        strokeDasharray="5 5"
                      />
                    )}
                  </g>
                ))}
              </svg>
              {['onAir', 'dtDone'].map((key) =>
                drawn.map((p, j) => {
                  const open = p.isOpen
                  const cls = [
                    'dt-flow-dot',
                    open && 'dt-flow-dot-open',
                    j === hovered && 'is-active',
                  ].filter(Boolean)
                  return (
                    <i
                      key={`${key}-${j}`}
                      data-testid={open ? 'dt-flow-open-dot' : 'dt-flow-dot'}
                      className={cls.join(' ')}
                      style={{ left: xPct(j), top: `${yPct(p[key])}%`, '--dt-dot': SERIES_COLOR[key] }}
                    />
                  )
                }),
              )}
            </div>
          </div>

          {/* Each month's name, straight under its dots. */}
          <div
            className={stagger ? 'dt-flow-row dt-flow-labels is-staggered' : 'dt-flow-row dt-flow-labels'}
            aria-hidden="true"
          >
            {months.map((m, j) => (
              <span
                key={`${m.year}-${m.month}`}
                data-testid="dt-flow-month"
                className={[
                  'dt-flow-month dt-farsi',
                  m.is_open && 'is-open',
                  j === hovered && 'is-active',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                {shamsiMonthName(m.month)}
              </span>
            ))}
          </div>

          {/* What each month did to the gap, under its name, as a signed pill:
              green where the backlog shrank, brick where it grew. */}
          <div className="dt-flow-row dt-flow-nets">
            {months.map((m, j) => {
              const tone = toneOf(nets[j])
              return (
                <span
                  key={`${m.year}-${m.month}`}
                  data-testid="dt-flow-net"
                  data-tone={tone}
                  className={m.is_open ? 'dt-flow-net is-open tnum' : 'dt-flow-net tnum'}
                >
                  {withSign(nets[j])}
                  <span className="dt-sr-only"> ({GAP_WORD[tone]})</span>
                </span>
              )
            })}
          </div>

          {/* The hover targets: each whole column, plot, name and change
              together. Focusable, so the keyboard gets the same card. */}
          <div className="dt-flow-hits">
            {months.map((m, j) => (
              <button
                key={`${m.year}-${m.month}`}
                type="button"
                className="dt-flow-hit"
                aria-label={`${shamsiMonthName(m.month)} ${m.year}`}
                onPointerEnter={() => setActive(j)}
                onPointerDown={() => setActive(j)}
                onFocus={() => setActive(j)}
                onBlur={() => setActive(null)}
              />
            ))}
          </div>

          <HoverCard
            month={hovered == null ? null : months[hovered]}
            point={hovered == null ? null : drawn[hovered]}
            net={hovered == null ? null : nets[hovered]}
          />
        </div>
      </div>
    </div>
  )
}

/** Month names alternate onto two lines below this column width. */
const STAGGER_BELOW = 54

/** An element's width, kept current as it resizes. Zero until measured (and
 * always in a test DOM, which has no layout). */
function useWidth(ref) {
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el || typeof ResizeObserver === 'undefined') return undefined
    const ro = new ResizeObserver(([entry]) => setWidth(entry.contentRect.width))
    ro.observe(el)
    return () => ro.disconnect()
  }, [ref])
  return width
}

/** The plot's height on a wide page: whatever keeps the whole Overview on
 * one screen, between these two. */
const FIT_MIN = 240
const FIT_MAX = 440
/** Page width (the bench's, like the layout's container queries) from which
 * the plot fits the screen; below it the CSS's fixed 260px applies. */
const FIT_FROM = 980

/** Size the plot so the page does not scroll: draw it at the tallest, see
 * how far the document overruns the window, and take that off, within
 * FIT_MIN..FIT_MAX. Measured once after the first render, again when the web
 * fonts arrive (they change line heights) and on every resize. Written to the
 * element's style, not to React state, so nothing re-renders and a fit can
 * never trigger another one. */
function useFitHeight(ref) {
  useLayoutEffect(() => {
    const plot = ref.current
    if (!plot) return undefined
    let live = true
    const fit = () => {
      if (!live) return
      const bench = plot.closest('.dt-bench') ?? document.documentElement
      if (bench.clientWidth < FIT_FROM) {
        plot.style.height = ''
        return
      }
      plot.style.height = `${FIT_MAX}px`
      const over = document.documentElement.scrollHeight - window.innerHeight
      plot.style.height = `${Math.max(FIT_MIN, Math.min(FIT_MAX, FIT_MAX - over))}px`
    }
    fit()
    document.fonts?.ready?.then(fit)
    window.addEventListener('resize', fit)
    return () => {
      live = false
      window.removeEventListener('resize', fit)
    }
  }, [ref])
}

/** The hovered month's figures, pinned to the plot's top-left corner: this
 * month's own movement, and the running totals at its end. Always in the
 * page, so a screen reader hears the figures when a column takes focus. */
function HoverCard({ month, point, net }) {
  const tone = month && toneOf(net)
  return (
    <div
      className={month ? 'dt-flow-tip is-on' : 'dt-flow-tip'}
      data-testid="dt-flow-tip"
      role="status"
      aria-live="polite"
    >
      {month && (
        <>
          <div className="dt-flow-tip-head">
            <span className="dt-flow-tip-month dt-farsi">{shamsiMonthName(month.month)}</span>
            <span className="dt-flow-tip-year tnum">{month.year}</span>
            {month.is_open && <span className="dt-flow-tip-open">In progress</span>}
          </div>
          <table className="dt-flow-tip-table">
            <thead>
              <tr>
                <td />
                <th scope="col">This month</th>
                <th scope="col">Cumulative</th>
              </tr>
            </thead>
            <tbody>
              <tr data-row="onair">
                <th scope="row">
                  <i className="dt-flow-tip-sw" style={{ background: SERIES_COLOR.onAir }} />
                  On air
                </th>
                <td className="tnum">{count(month.on_aired)}</td>
                <td className="tnum">{count(point.onAir)}</td>
              </tr>
              <tr data-row="done">
                <th scope="row">
                  <i className="dt-flow-tip-sw" style={{ background: SERIES_COLOR.dtDone }} />
                  DT done
                </th>
                <td className="tnum">{count(month.dt_done)}</td>
                <td className="tnum">{count(point.dtDone)}</td>
              </tr>
              <tr data-row="gap">
                <th scope="row">
                  <i className="dt-flow-tip-sw dt-flow-tip-sw-gap" />
                  Gap
                </th>
                <td className="tnum" data-tone={tone}>
                  {withSign(net)}
                  <span className="dt-sr-only"> ({GAP_WORD[tone]})</span>
                </td>
                <td className="tnum">{withMinus(point.gap)}</td>
              </tr>
            </tbody>
          </table>
        </>
      )}
    </div>
  )
}
