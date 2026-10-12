import { Fragment, useEffect, useLayoutEffect, useRef, useState } from 'react'
import { toPersianDigits } from '../../../lib/persianDigits'
import { shamsiMonthName } from '../../../lib/shamsi'
import { count } from '../format'
import { flowView } from './flowView'
import { FadeArea } from './primitives'

/**
 * Sites on air against drive tests done, every month since the opening
 * balance, with a readout beside the key that reads one month's figures.
 *
 * WHAT THIS ANSWERS. The KPI band already says how many sites are on air and
 * how many are done, as of right now. It cannot say whether the gap between
 * them has been closing or widening, or whether this month looks like the
 * last one. This chart is the whole shape behind those two totals.
 *
 * ALWAYS CUMULATIVE (UEP-04a). There is no view to choose: the chart draws
 * every month the trend endpoint returns, with each new year marked, so the
 * whole programme is on one screen.
 *
 * ONE COLUMN PER MONTH. Every month gets a column, with its point at the
 * column's centre and its name under it. The name row shares the plot's left
 * gutter and the same columns. Names are thinned, counting back from the
 * current month, so none overlap; the current month is always named.
 *
 * THE READOUT, NOT A TOOLTIP. A month's figures are shown in a readout at the
 * right end of the key row, never over the plot, so nothing covers the lines
 * it describes. It reads the latest month by default and follows hover and
 * keyboard focus; the vertical rule and the two dots mark the month on the
 * chart. Its values are the same points the chart and the table draw.
 *
 * RUNNING TOTALS, CARRIED. The lines are the programme's real running totals,
 * carried from the opening balance on 1 Farvardin 1404 (see `flowView`), so
 * the last point is the KPI cards' figure and the gap is the real backlog.
 *
 * THE OPEN MONTH. A month still in progress gets hollow dots, a dashed last
 * segment and a light column highlight.
 *
 * COBALT COLOURS. DT done is the "done" series, so it takes the accent; On
 * air is the reference series and takes the muted neutral; the gap between
 * them is the accent's soft fill. A gap that grew is the one figure in danger
 * ink, with its sign and a word, so colour is never the only signal.
 */

/** The two series. DT done is the "done" series (the accent); On-aired is the
 * reference it is read against (the muted neutral). */
const SERIES_COLOR = { onAir: 'var(--uep-text-2)', dtDone: 'var(--uep-accent)' }
/** On air is the thinner reference line; DT done the heavier data line. */
const SERIES_WIDTH = { onAir: 2, dtDone: 2.5 }

/** Which way a month moved the backlog. Falling is the good direction. */
const toneOf = (v) => (v < 0 ? 'good' : v > 0 ? 'bad' : 'flat')
const GAP_WORD = { good: 'shrank', bad: 'grew', flat: 'no change' }
/** A figure with its sign, and a real minus sign ("−10"), not a hyphen. */
const withSign = (v) => (v > 0 ? `+${count(v)}` : v < 0 ? `−${count(-v)}` : '0')
const withMinus = (v) => (v < 0 ? `−${count(-v)}` : count(v))

/** The chart's key: the two series and the gap between them. */
function FlowLegend() {
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
    </ul>
  )
}

/** The key row under the card header: the key on the left, the readout on
 * the right (UEP-04a). `index` is the month the readout reads; it defaults to
 * the latest. The page draws it on its own above the table view. */
export function FlowKey({ view, index }) {
  const j = index ?? view.months.length - 1
  return (
    <div className="dt-flow-keyrow">
      <FlowLegend />
      <Readout month={view.months[j]} point={view.points[j + 1]} change={view.changes[j]} />
    </div>
  )
}

/** One month's figures: its running totals and what it changed. A polite
 * live region, so a screen reader hears the month the arrow keys move to. */
function Readout({ month, point, change }) {
  const gapTone = toneOf(change.gap)
  return (
    <div className="dt-flow-readout" data-testid="dt-flow-readout" role="status" aria-live="polite">
      <span className="dt-flow-readout-month">
        <span className="dt-farsi" data-testid="dt-flow-readout-month">
          {shamsiMonthName(month.month)} {toPersianDigits(String(month.year))}
        </span>
        {month.is_open && <span className="dt-flow-readout-open"> · so far</span>}
      </span>
      <ReadoutFigure
        row="onair"
        label="On air"
        dot={SERIES_COLOR.onAir}
        value={point.onAir}
        change={change.onAir}
      />
      <ReadoutFigure
        row="done"
        label="DT done"
        dot={SERIES_COLOR.dtDone}
        value={point.dtDone}
        change={change.dtDone}
      />
      <ReadoutFigure row="gap" label="Gap" value={point.gap} change={change.gap} tone={gapTone}>
        <span className="dt-sr-only"> ({GAP_WORD[gapTone]})</span>
      </ReadoutFigure>
    </div>
  )
}

/** A dot, a running total and the month's change. The dot is the series
 * colour, or the gap's swatch when no colour is given. */
function ReadoutFigure({ row, label, dot, value, change, tone, children }) {
  return (
    <span className="dt-flow-readout-fig" data-row={row}>
      <i
        className={dot ? 'dt-flow-readout-dot' : 'dt-flow-readout-dot is-gap'}
        style={dot ? { background: dot } : undefined}
        aria-hidden="true"
      />
      <span className="dt-sr-only">{label} </span>
      <b className="tnum" data-testid="dt-flow-readout-value">
        {withMinus(value)}
      </b>
      <span
        className="dt-flow-readout-change tnum"
        data-tone={tone}
        data-testid="dt-flow-readout-change"
      >
        {withSign(change)}
        {children}
      </span>
    </span>
  )
}

export default function FlowChart({ data }) {
  const view = flowView(data)
  const { points, months, floor, ceiling, ticks } = view
  const n = months.length
  // points[0] is the opening balance; points[j + 1] is month j.
  const drawn = points.slice(1)
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

  // Every `labelEvery`th month is named, counting back from the current one,
  // so the current month is always named and no two names overlap.
  const plotRef = useRef(null)
  const plotWidth = useWidth(plotRef)
  const labelEvery = plotWidth > 0 ? Math.max(1, Math.ceil(LABEL_MIN / (plotWidth / n))) : 1
  useFitHeight(plotRef)

  // The month under the pointer, the keyboard focus or the last tap. With
  // nothing active the readout reads the latest month, unmarked.
  const [active, setActive] = useState(null)
  const hovered = active != null && active < n ? active : null

  // One tab stop for the whole plot: arrows move a month, Home and End jump
  // to the ends, and focusing it starts on the latest month.
  const onKeyDown = (e) => {
    const from = hovered ?? n - 1
    const to = {
      ArrowLeft: Math.max(0, from - 1),
      ArrowRight: Math.min(n - 1, from + 1),
      Home: 0,
      End: n - 1,
    }[e.key]
    if (to == null) return
    e.preventDefault()
    setActive(to)
  }

  return (
    <>
      <FlowKey view={view} index={hovered} />
      <div className="dt-flowcard" style={{ '--dt-flow-cols': n }}>
        <div className="dt-flow-scroll">
          <div
            className="dt-flow-frame"
            tabIndex={0}
            role="group"
            aria-label="On air vs DT done chart. Use the left and right arrow keys to read each month."
            onKeyDown={onKeyDown}
            onFocus={(e) => e.target === e.currentTarget && setActive(n - 1)}
            onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setActive(null)}
            // A touch ends with a leave; the tapped month stays in the readout
            // until another is tapped or the focus moves on.
            onPointerLeave={(e) => e.pointerType !== 'touch' && setActive(null)}
          >
            <div
              className="dt-flowchart"
              role="img"
              aria-label={
                'On air vs drive tests done, running totals, every month since Farvardin 1404. ' +
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
                {/* The chart spans years: a dashed line where each new year
                    starts, and its label at the top of the plot beside it. */}
                {months.map(
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
                  {areaPath && <FadeArea d={areaPath} fill="var(--uep-accent-tint)" />}
                  {/* Plain paths: the stroke keeps its screen width however the
                      plot is stretched (non-scaling), which a draw-on animation's
                      dash would break into pieces. */}
                  {['onAir', 'dtDone'].map((key) => (
                    <g
                      key={key}
                      fill="none"
                      stroke={SERIES_COLOR[key]}
                      strokeWidth={SERIES_WIDTH[key]}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                    >
                      <path
                        d={lineFor(key, 0, openTail ? n - 1 : n)}
                        vectorEffect="non-scaling-stroke"
                      />
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
                        style={{
                          left: xPct(j),
                          top: `${yPct(p[key])}%`,
                          '--dt-dot': SERIES_COLOR[key],
                        }}
                      />
                    )
                  }),
                )}
              </div>
            </div>

            {/* Each month's name, straight under its dots. A thinned-out name
                keeps its column but is not drawn. */}
            <div className="dt-flow-row dt-flow-labels" aria-hidden="true">
              {months.map((m, j) => (
                <span
                  key={`${m.year}-${m.month}`}
                  data-testid="dt-flow-month"
                  className={[
                    'dt-flow-month dt-farsi',
                    m.is_open && 'is-open',
                    j === n - 1 && 'is-current',
                    j === hovered && 'is-active',
                    (n - 1 - j) % labelEvery !== 0 && 'is-skipped',
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  {shamsiMonthName(m.month)}
                </span>
              ))}
            </div>

            {/* The pointer targets: each whole column, plot and name together.
                Out of the tab order -- the keyboard reads the months with the
                arrow keys on the plot's one tab stop. */}
            <div className="dt-flow-hits">
              {months.map((m, j) => (
                <button
                  key={`${m.year}-${m.month}`}
                  type="button"
                  className="dt-flow-hit"
                  tabIndex={-1}
                  aria-label={`${shamsiMonthName(m.month)} ${m.year}`}
                  onPointerEnter={() => setActive(j)}
                  onPointerDown={() => setActive(j)}
                  onFocus={() => setActive(j)}
                  onBlur={() => setActive(null)}
                />
              ))}
            </div>
          </div>
        </div>
      </div>
    </>
  )
}

/** The narrowest column a month's name is drawn in; below it, every second
 * (third, ...) month is named instead, counting back from the current one. */
const LABEL_MIN = 52

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
const FIT_MIN = 180
const FIT_MAX = 440
/** Page width (the bench's, like the layout's container queries) from which
 * the plot fits the screen; below it the CSS's fixed 260px applies. */
const FIT_FROM = 980

/** How far the page's content overruns the space it has. On a fill page
 * (PageFrame) that is the body's content against the body's own height --
 * the document itself never scrolls; anywhere else, the document against
 * the window. */
function overrun(plot) {
  const body = plot.closest('.page-body')
  if (body) return body.scrollHeight - body.clientHeight
  return document.documentElement.scrollHeight - window.innerHeight
}

/** Size the plot so the page does not scroll: draw it at the tallest, see
 * how far the page overruns its space, and take that off, within
 * FIT_MIN..FIT_MAX. Measured after the first render, again when the web
 * fonts arrive (they change line heights), on every window resize, and
 * whenever the rest of the view changes size as its data arrives. Written to the
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
      const over = overrun(plot)
      plot.style.height = `${Math.max(FIT_MIN, Math.min(FIT_MAX, FIT_MAX - over))}px`
    }
    fit()
    document.fonts?.ready?.then(fit)
    window.addEventListener('resize', fit)
    // The rest of the view loads on its own requests: the KPI band replacing
    // its skeleton, or the side cards arriving, changes how much room there is
    // after the first fit. Re-fit whenever the view's size changes, on the
    // next frame. A fit is idempotent -- the same layout gives the same
    // height -- so the view settles instead of oscillating.
    let frame = 0
    const view = plot.closest('.dt-view')
    const observer =
      view && typeof ResizeObserver !== 'undefined'
        ? new ResizeObserver(() => {
            cancelAnimationFrame(frame)
            frame = requestAnimationFrame(fit)
          })
        : null
    observer?.observe(view)
    return () => {
      live = false
      window.removeEventListener('resize', fit)
      cancelAnimationFrame(frame)
      observer?.disconnect()
    }
  }, [ref])
}
