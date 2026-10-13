import { useId, useState } from 'react'
import Section from '../../../components/Section'
import { axisTicks, chartSeries, chartSummary, faDigits, fmt, readout, streamOf, yearTrack } from './model'
import useElementSize from './useElementSize'

const PAD_LEFT = 36
const PAD_TOP = 18
const LABEL_ROW = 38

/**
 * One Shamsi year of one stream's approvals against plan, Farvardin to
 * Esfand -- always twelve columns.
 *
 * A closed month is its Internal PIP as a pale bar behind a narrower accent
 * approved bar, the Contractor PIP a 2px ink tick across it. The running
 * month's bar is striped, with a dashed Today line at the day's place in the
 * column. A month that has not started draws its plans only, dashed, and
 * cannot be opened. A month with no plan and no approval is an empty column:
 * approvals before Mehr 1405 are undated, by design.
 *
 * Under each month: "{p}%" of the reference plan (danger under 100), "so
 * far" for the running month, "plan" for one to come. No pills.
 *
 * The readout at the right of the key row reads the selected month, and
 * follows hover and the arrow keys (the Drive test chart's model: one tab
 * stop, ←/→/Home/End move it, Enter opens the month in the PIP card). "Table"
 * swaps the plot for the same figures in rows.
 */
export default function ProgressChart({ state, stream, year, years, onYear, selected, onSelect, isContractor }) {
  const meta = streamOf(stream)
  const [asTable, setAsTable] = useState(false)
  return (
    <Section
      title={meta.title}
      tile="chart--column"
      inline
      state={state}
      onRetry={state.retry}
      skeletonRows={6}
      className="acc-chart-section"
      controls={<YearSelect year={year} years={years} onYear={onYear} />}
    >
      {(progress) => (
        <YearChart
          progress={progress}
          stream={stream}
          year={year}
          selected={selected}
          onSelect={onSelect}
          isContractor={isContractor}
          asTable={asTable}
          onTable={setAsTable}
        />
      )}
    </Section>
  )
}

/** The year, in Persian digits: every year with data or a plan, newest
 * first, and always the current one. */
function YearSelect({ year, years, onYear }) {
  if (year == null) return null
  const options = years?.length ? years : [year]
  return (
    <select className="acc-year" aria-label="Year" value={year} onChange={(e) => onYear(Number(e.target.value))}>
      {(options.includes(year) ? options : [year, ...options]).map((y) => (
        <option key={y} value={y}>
          {faDigits(y)}
        </option>
      ))}
    </select>
  )
}

function YearChart({ progress, stream, year, selected, onSelect, isContractor, asTable, onTable }) {
  const series = chartSeries(progress, stream, { isContractor })
  const track = yearTrack(progress, stream)
  const selectedIndex = series.points.findIndex((p) => p.key === selected)
  const [active, setActive] = useState(null)
  const shown = active ?? (selectedIndex >= 0 ? selectedIndex : series.points.length - 1)

  return (
    <>
      {track && <YearTrack track={track} label={series.refLabel} />}
      <div className="dt-flow-keyrow acc-keyrow">
        <ul className="dt-flow-legend acc-legend" aria-label="Chart key">
          {series.legend.map((item) => (
            <li key={item.key} className="dt-flow-legend-item" data-legend={item.key}>
              <i className={`acc-key acc-key-${item.key}`} aria-hidden="true" />
              {item.label}
            </li>
          ))}
        </ul>
        <span className="acc-keyrow-end">
          <Readout view={readout(series, shown)} />
          <button
            type="button"
            className="btn btn-ghost acc-table-toggle"
            aria-pressed={asTable}
            onClick={() => onTable(!asTable)}
          >
            {asTable ? 'Chart' : 'Table'}
          </button>
        </span>
      </div>
      {series.caption && <p className="acc-caption">{series.caption}</p>}
      {asTable ? (
        <YearTable series={series} />
      ) : (
        <Plot
          series={series}
          stream={stream}
          year={year ?? progress.today?.shamsi_year}
          selectedIndex={selectedIndex}
          active={active}
          setActive={setActive}
          onSelect={onSelect}
        />
      )}
    </>
  )
}

/** The year's approvals over its whole plan, with what was due by today. */
function YearTrack({ track, label }) {
  return (
    <div className="acc-yeartrack" data-testid="year-track">
      <span className="acc-yeartrack-label">Year plan</span>
      <span
        className="acc-yeartrack-bar"
        role="img"
        aria-label={`${fmt(track.approved)} approved of a year plan of ${fmt(track.plan)} (${label})${
          track.due ? `, ${fmt(track.due.value)} due by today` : ''
        }`}
      >
        <i className="acc-yeartrack-fill" style={{ width: `${track.fill}%` }} />
        {track.due && (
          <span className="acc-yeartrack-due" style={{ left: `${track.due.at}%` }} aria-hidden="true">
            <span className="acc-yeartrack-due-label tnum">Due by today {fmt(track.due.value)}</span>
          </span>
        )}
      </span>
      <span className="acc-yeartrack-figures tnum">
        <b>{fmt(track.approved)}</b> of {fmt(track.plan)}
        {track.pct && (
          <>
            {' · '}
            <span className={track.pct.tone ? `acc-tone-${track.pct.tone}` : undefined}>{track.pct.text}</span>
          </>
        )}
      </span>
    </div>
  )
}

const DOT = { approved: 'acc-key-approved', internal: 'acc-key-internal', contractor: 'acc-key-contractor' }

/** One month's figures, beside the key. A polite live region, so a screen
 * reader hears the month the arrow keys move to. */
function Readout({ view }) {
  if (!view) return null
  return (
    <div className="dt-flow-readout acc-readout" data-testid="acc-readout" role="status" aria-live="polite">
      <span className="dt-flow-readout-month">
        <span className="dt-farsi" data-testid="acc-readout-month">
          {view.name}
        </span>
        {view.note && <span> · {view.note}</span>}
      </span>
      {view.figures.map((f) => (
        <span key={f.key} className="dt-flow-readout-fig" data-row={f.key}>
          <i className={`acc-key ${DOT[f.key]}`} aria-hidden="true" />
          <span className="acc-readout-label">{f.label}</span>
          <b className="tnum" data-testid="acc-readout-value">
            {fmt(f.value)}
          </b>
        </span>
      ))}
      {view.pct && (
        <span className={`tnum${view.pct.tone ? ` acc-tone-${view.pct.tone}` : ''}`} data-testid="acc-readout-pct">
          {view.pct.text}
        </span>
      )}
    </div>
  )
}

function Plot({ series, stream, year, selectedIndex, active, setActive, onSelect }) {
  const [ref, size] = useElementSize({ width: 720, height: 260 })
  const stripes = useId().replace(/:/g, '')
  const n = series.points.length
  const plotW = Math.max(40, size.width - PAD_LEFT)
  const plotH = Math.max(40, size.height - LABEL_ROW - PAD_TOP)
  const ticks = axisTicks(series.max)
  const top = ticks[ticks.length - 1]
  const cw = plotW / Math.max(n, 1)
  const base = PAD_TOP + plotH
  const y = (v) => base - (plotH * v) / top
  const colX = (i) => PAD_LEFT + cw * i
  const planW = Math.min(cw * 0.64, 46)
  const barW = planW * 0.58

  const from = active ?? (selectedIndex >= 0 ? selectedIndex : n - 1)
  const onKeyDown = (e) => {
    const to = { ArrowLeft: Math.max(0, from - 1), ArrowRight: Math.min(n - 1, from + 1), Home: 0, End: n - 1 }[e.key]
    if (to != null) {
      e.preventDefault()
      setActive(to)
    } else if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      const p = series.points[from]
      if (p && !p.isFuture) onSelect(p.key)
    }
  }

  return (
    <div
      className="acc-plot"
      ref={ref}
      tabIndex={0}
      role="group"
      aria-label="Months of the year. Use the left and right arrow keys to read each month, Enter to open it."
      onKeyDown={onKeyDown}
      onBlur={(e) => !e.currentTarget.contains(e.relatedTarget) && setActive(null)}
      onPointerLeave={(e) => e.pointerType !== 'touch' && setActive(null)}
    >
      <svg
        className="acc-svg"
        width={size.width}
        height={size.height - LABEL_ROW}
        role="img"
        aria-label={chartSummary(series, stream, faDigits(year))}
      >
        <defs>
          <pattern id={stripes} patternUnits="userSpaceOnUse" width="6" height="6" patternTransform="rotate(45)">
            <rect width="6" height="6" className="acc-stripe-base" />
            <rect width="3" height="6" className="acc-stripe-line" />
          </pattern>
        </defs>
        {selectedIndex >= 0 && (
          <rect x={colX(selectedIndex)} y={0} width={cw} height={base} className="acc-col-band" data-testid="selected-band" />
        )}
        <g className="acc-grid">
          {ticks.map((t) => (
            <g key={t}>
              <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={y(t)} y2={y(t)} />
              <text x={PAD_LEFT - 8} y={y(t) + 4} textAnchor="end" className="acc-axis tnum">
                {shortCount(t)}
              </text>
            </g>
          ))}
          <line x1={PAD_LEFT} x2={PAD_LEFT + plotW} y1={base} y2={base} className="acc-baseline" />
        </g>
        {series.points.map((p, i) => {
          const cx = colX(i) + cw / 2
          const px = cx - planW / 2
          const bx = cx - barW / 2
          const h = p.approved ? base - y(p.approved) : 0
          const inside = !p.isCurrent && h >= 20
          return (
            <g key={p.key} data-bar={p.key} data-future={p.isFuture || undefined}>
              {p.internal != null && p.internal > 0 && (
                <rect
                  x={px}
                  y={y(p.internal)}
                  width={planW}
                  height={base - y(p.internal)}
                  rx={3}
                  className={p.isFuture ? 'acc-plan-bar is-future' : 'acc-plan-bar'}
                  data-testid="target-bar"
                />
              )}
              {h > 0 && (
                <rect
                  x={bx}
                  y={y(p.approved)}
                  width={barW}
                  height={h}
                  rx={2}
                  className="acc-approved-bar"
                  fill={p.isCurrent ? `url(#${stripes})` : undefined}
                  data-current={p.isCurrent || undefined}
                />
              )}
              {p.approved > 0 && (
                <text
                  x={cx}
                  y={inside ? y(p.approved) + 14 : y(p.approved) - 5}
                  textAnchor="middle"
                  className={`acc-bar-value tnum${inside ? ' is-inside' : ''}`}
                >
                  {fmt(p.approved)}
                </text>
              )}
              {p.contractor != null && (
                <line
                  x1={px - 4}
                  x2={px + planW + 4}
                  y1={y(p.contractor)}
                  y2={y(p.contractor)}
                  className={p.isFuture ? 'acc-pip-tick is-future' : 'acc-pip-tick'}
                  data-testid="pip-tick"
                />
              )}
              {p.isCurrent && series.today && (
                <line
                  x1={colX(i) + cw * series.today.at}
                  x2={colX(i) + cw * series.today.at}
                  y1={PAD_TOP - 6}
                  y2={base}
                  className="acc-today"
                  data-testid="today-line"
                />
              )}
            </g>
          )
        })}
      </svg>
      <ol className="acc-months" style={{ height: LABEL_ROW }}>
        {series.points.map((p, i) => (
          <li key={p.key} style={{ left: colX(i), width: cw }} data-month={p.key}>
            <button
              type="button"
              tabIndex={-1}
              className={`acc-month${i === selectedIndex ? ' is-selected' : ''}${i === from ? ' is-active' : ''}`}
              aria-label={`Show ${p.name}`}
              aria-pressed={i === selectedIndex}
              disabled={p.isFuture}
              onPointerEnter={() => setActive(i)}
              onClick={() => !p.isFuture && onSelect(p.key)}
            >
              <span className="acc-month-name dt-farsi">{p.label}</span>
              <span className={`acc-month-under tnum${p.under?.tone ? ` acc-tone-${p.under.tone}` : ''}`}>
                {p.under?.text ?? ' '}
              </span>
            </button>
          </li>
        ))}
      </ol>
      {/* The columns above the names: hover reads a month, a click opens it. */}
      {series.points.map((p, i) => (
        <span
          key={p.key}
          className={`acc-col${p.isFuture ? ' is-future' : ''}`}
          style={{ left: colX(i), width: cw, height: base }}
          aria-hidden="true"
          onPointerEnter={() => setActive(i)}
          onClick={() => !p.isFuture && onSelect(p.key)}
        />
      ))}
    </div>
  )
}

/** The same figures as the plot, in rows. */
function YearTable({ series }) {
  const hasInternal = series.points.some((p) => p.internal != null)
  const hasContractor = series.points.some((p) => p.contractor != null)
  return (
    <div className="dt-flow-table-wrap acc-table-wrap">
      <table className="dt-flow-table" data-testid="acc-table">
        <thead>
          <tr>
            <th scope="col">Month</th>
            <th scope="col">Approved</th>
            {hasInternal && <th scope="col">Internal PIP</th>}
            {hasContractor && <th scope="col">{series.planLabel}</th>}
            <th scope="col">% of {series.refLabel}</th>
          </tr>
        </thead>
        <tbody>
          {series.points.map((p) => (
            <tr key={p.key} data-month={p.key}>
              <th scope="row" className="dt-farsi">
                {p.label}
              </th>
              <td>{p.isFuture ? 'Upcoming' : fmt(p.approved)}</td>
              {hasInternal && <td>{fmt(p.internal)}</td>}
              {hasContractor && <td>{fmt(p.contractor)}</td>}
              <td className={p.under?.tone ? `acc-tone-${p.under.tone}` : undefined}>
                {p.pct != null ? `${p.pct}%` : p.isCurrent ? 'so far' : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

/** 2500 -> 2.5k: axis labels only, where the gridline carries the scale. */
function shortCount(v) {
  return v >= 1000 ? `${Number((v / 1000).toFixed(1))}k` : String(v)
}
