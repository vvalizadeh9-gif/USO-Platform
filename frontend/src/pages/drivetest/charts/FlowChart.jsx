import { shamsiMonthName } from '../../../lib/shamsi'
import { count } from '../format'
import { flowView, netChanges } from './flowView'
import { FadeArea } from './primitives'

/**
 * Sites on air against drive tests done, one year at a time, with each
 * month's own movement in a table underneath.
 *
 * WHAT THIS ANSWERS. The KPI band already says how many sites are on air and
 * how many are done, as of right now. It cannot say whether the gap between
 * them has been closing or widening, or whether this month looks like the
 * last one. This chart is the trailing shape behind those two totals for the
 * selected year, and the table under it says what each month did.
 *
 * ONE COLUMN PER MONTH. Every month of the selected year gets a column -- 12
 * for a finished year, Farvardin to now for the current one -- with its point
 * at the column's centre and its name under it. The table below shares the
 * plot's 104px left gutter and the same columns, so each month's figures sit
 * straight under its dots. The plot is drawn in columns, not a fixed canvas:
 * the lines stretch with the card while the labels, dots and figures stay at
 * their true size.
 *
 * RUNNING TOTALS, CARRIED. The lines are the programme's real running totals,
 * carried from the opening balance on 1 Farvardin 1404 (see `flowView`), so
 * the current year ends on the KPI cards' figures and the gap is the real
 * backlog. They do not reset to zero on 1 Farvardin.
 *
 * THE OPEN MONTH. A month still in progress gets hollow dots, a dashed last
 * segment and a light column highlight, here and in the table.
 *
 * COBALT COLOURS. DT done is the "done" series, so it takes the accent; On-
 * aired is the reference series and takes the muted neutral; the gap between
 * them is the accent's soft fill. The table's Gap change is green where the
 * backlog shrank and brick where it grew, with its sign kept, so the colour is
 * never the only signal.
 *
 * THE PAGE CHOOSES THE YEAR. Which year is on screen is a prop, because the
 * card header carries both the control that switches it and the info note
 * that describes the view (where its scale starts), and those must agree
 * with what is drawn. The arithmetic is in `flowView.js` for the same reason:
 * the chart and the note read one copy.
 */

/** The two series. DT done is the "done" series (the accent); On-aired is the
 * reference it is read against (the muted neutral). */
const SERIES_COLOR = { onAir: 'var(--dt-muted)', dtDone: 'var(--accent)' }

/** Which way a month moved the backlog. Falling is the good direction. */
const toneOf = (v) => (v < 0 ? 'good' : v > 0 ? 'bad' : 'flat')
const GAP_WORD = { good: 'shrank', bad: 'grew', flat: 'no change' }
const signed = (v) => `${v > 0 ? '+' : ''}${count(v)}`

/** The chart's key, for the card's title row: the two series, the gap
 * between them, and the hollow dot that marks a month still in progress.
 * Exported because the title row belongs to `Section`, rendered by the page. */
export function FlowLegend() {
  return (
    <ul className="dt-flow-legend" aria-label="Chart key">
      <li className="dt-flow-legend-item">
        <i className="dt-flow-legend-line" style={{ background: SERIES_COLOR.onAir }} />
        On-aired
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
    </ul>
  )
}

export default function FlowChart({ data, scope = null }) {
  const { selected, points, months, floor, ceiling, ticks } = flowView(data, scope)
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

  return (
    <div className="dt-flowcard" style={{ '--dt-flow-cols': n }}>
      <div className="dt-flow-scroll">
        <div
          className="dt-flowchart"
          role="img"
          aria-label={
            `On-aired vs drive tests done, running totals, ${selected}. ` +
            `On-aired ${last.onAir}, DT done ${last.dtDone}, gap ${last.gap}.` +
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
          <div className="dt-flow-plot">
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
                return (
                  <i
                    key={`${key}-${j}`}
                    data-testid={open ? 'dt-flow-open-dot' : 'dt-flow-dot'}
                    className={open ? 'dt-flow-dot dt-flow-dot-open' : 'dt-flow-dot'}
                    style={{ left: xPct(j), top: `${yPct(p[key])}%`, '--dt-dot': SERIES_COLOR[key] }}
                  />
                )
              }),
            )}
          </div>
        </div>

        {/* Each month's own movement, one column per month, straight under
            its dots: the same 104px gutter and the same column widths. */}
        <table className="dt-flow-table" data-testid="dt-flow-table">
          <caption className="dt-sr-only">Each month of {selected}: new on air, DT done and the change in the gap</caption>
          <colgroup>
            <col className="dt-flow-gutter" />
            {months.map((m) => (
              <col key={`${m.year}-${m.month}`} />
            ))}
          </colgroup>
          <thead>
            <tr>
              <td />
              {months.map((m, j) => (
                <th
                  key={`${m.year}-${m.month}`}
                  scope="col"
                  className={m.is_open ? 'dt-flow-col-open' : undefined}
                >
                  <span className="dt-flow-month dt-farsi">{shamsiMonthName(m.month)}</span>
                  {j === 0 && <span className="dt-flow-sub tnum">{m.year}</span>}
                  {m.is_open && <span className="dt-flow-sub">in progress</span>}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <tr data-row="onair">
              <th scope="row">New on air</th>
              {months.map((m) => (
                <td key={`${m.year}-${m.month}`} className={m.is_open ? 'dt-flow-col-open tnum' : 'tnum'}>
                  {count(m.on_aired)}
                </td>
              ))}
            </tr>
            <tr data-row="done">
              <th scope="row">DT done</th>
              {months.map((m) => (
                <td key={`${m.year}-${m.month}`} className={m.is_open ? 'dt-flow-col-open tnum' : 'tnum'}>
                  {count(m.dt_done)}
                </td>
              ))}
            </tr>
            <tr data-row="gap">
              <th scope="row">Gap change</th>
              {months.map((m, j) => {
                const tone = toneOf(nets[j])
                return (
                  <td
                    key={`${m.year}-${m.month}`}
                    data-testid="dt-flow-net"
                    data-tone={tone}
                    className={m.is_open ? 'dt-flow-col-open tnum' : 'tnum'}
                  >
                    {signed(nets[j])}
                    <span className="dt-sr-only"> ({GAP_WORD[tone]})</span>
                  </td>
                )
              })}
            </tr>
          </tbody>
        </table>
      </div>
    </div>
  )
}
