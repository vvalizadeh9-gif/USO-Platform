import { TrendingUp } from 'lucide-react'
import { useId } from 'react'
import { SegmentedControl } from '../../../components/ui'
import CardFailed from './CardFailed'
import { axisTicks, chartSeries, chartSummary, faDigits, fmt, streamOf } from './model'
import { MODES, areaPath, lastOf, linePath, monotonePath, nudge, runs } from './chartGeometry'
import useElementSize from './useElementSize'

const PAD_LEFT = 38
const PAD_TOP = 22
const PAD_BOTTOM = 6
const END_LABEL_WIDTH = 56
const LABEL_ROW = { monthly: 48, cumulative: 40 }
/** Below this column width a Farsi month name can touch its neighbour; the
 * cumulative view (which has no pills under the names) then staggers them. */
const CROWDED = 50

/**
 * Approvals against plan, month by month, for the tab's stream.
 *
 * Monthly is target-vs-actual bars: the Internal PIP a pale bar behind, what
 * was approved a solid bar in front, the Contractor PIP an ink tick across
 * it, the running month striped. Cumulative is the running totals: approved
 * to date as a monotone area, the two plans as dashed and dotted lines, an
 * end label per series and one callout at the last closed month.
 *
 * Every month is a button (behind the drawing) that selects it for the panel
 * beside; the drawing itself is one `role="img"` with a summary in words.
 * Drawn in the card's own pixels (useElementSize), so it fills the card.
 */
export default function ProgressChart({ state, stream, mode, onMode, selected, onSelect, isContractor }) {
  const meta = streamOf(stream)
  return (
    <section className="ui-card accd-chart-card" aria-label={meta.title}>
      <header className="ui-card-head accd-chart-head">
        <span className="ui-card-chip" aria-hidden="true">
          <TrendingUp size={20} strokeWidth={1.9} />
        </span>
        <div className="ui-card-titles">
          <h2 className="ui-card-title">{meta.title}</h2>
          <div className="ui-card-desc">Last 12 months. Click a month to see it on the right.</div>
        </div>
        <div className="ui-card-actions">
          <SegmentedControl options={MODES} value={mode} onChange={onMode} label="Chart view" />
        </div>
      </header>
      {state.error ? (
        <CardFailed what="the chart" error={state.error} onRetry={state.retry} />
      ) : !state.data ? (
        <div className="accd-chart-body accd-skeleton" aria-busy="true" data-testid="chart-skeleton" />
      ) : (
        <Chart
          progress={state.data}
          stream={stream}
          mode={mode}
          selected={selected}
          onSelect={onSelect}
          isContractor={isContractor}
        />
      )}
    </section>
  )
}

function Chart({ progress, stream, mode, selected, onSelect, isContractor }) {
  const series = chartSeries(progress, stream, mode, { isContractor })
  return (
    <>
      <Legend items={series.legend} mode={mode} />
      {series.caption && <p className="accd-caption">{series.caption}</p>}
      <Plot series={series} stream={stream} mode={mode} selected={selected} onSelect={onSelect} />
    </>
  )
}

function Legend({ items, mode }) {
  return (
    <ul className="accd-legend" aria-label="Legend">
      {items.map((item) => (
        <li key={item.key} data-legend={item.key}>
          <i className={`accd-key accd-key-${item.key} accd-key-${mode}`} aria-hidden="true" />
          {item.label}
        </li>
      ))}
    </ul>
  )
}

function Plot({ series, stream, mode, selected, onSelect }) {
  const [ref, size] = useElementSize()
  const cumulative = mode === 'cumulative'
  const labelRow = LABEL_ROW[mode]
  const padRight = cumulative ? END_LABEL_WIDTH : 0
  const n = series.points.length
  const plotW = Math.max(40, size.width - PAD_LEFT - padRight)
  const plotH = Math.max(40, size.height - labelRow - PAD_TOP - PAD_BOTTOM)
  const ticks = axisTicks(series.max)
  const top = ticks[ticks.length - 1]
  const cw = plotW / Math.max(n, 1)
  const stagger = cumulative && cw < CROWDED
  const geo = {
    cw,
    plotW,
    plotH,
    base: PAD_TOP + plotH,
    x: (i) => PAD_LEFT + cw * (i + 0.5),
    y: (v) => PAD_TOP + plotH - (plotH * v) / top,
    right: PAD_LEFT + plotW,
  }

  return (
    <div className="accd-plot" ref={ref} data-mode={mode}>
      {/* The months, as buttons behind the drawing. */}
      {series.points.map((p, i) => (
        <button
          key={p.key}
          type="button"
          className="accd-col"
          style={{ left: PAD_LEFT + i * cw, width: cw }}
          aria-label={`Show ${p.label} ${faDigits(p.year)}`}
          aria-pressed={p.key === selected}
          onClick={() => onSelect(p.key)}
        />
      ))}
      <svg
        className="accd-svg"
        width={size.width}
        height={size.height - labelRow}
        role="img"
        aria-label={chartSummary(series, stream, mode)}
      >
        <Grid ticks={ticks} geo={geo} />
        {cumulative ? <Cumulative series={series} geo={geo} /> : <Monthly series={series} geo={geo} />}
      </svg>
      {cumulative && series.callout && <Callout callout={series.callout} point={series.points[series.callout.index]} geo={geo} />}
      <ol className="accd-months" style={{ height: labelRow }} aria-hidden="true">
        {series.points.map((p, i) => (
          <li
            key={p.key}
            className={stagger && i % 2 ? 'is-low' : undefined}
            style={{ left: PAD_LEFT + i * cw, width: cw }}
            data-month={p.key}
          >
            <span className="accd-month-name" dir="auto">{p.label}</span>
            {p.attainment && (
              <span className={`accd-pill accd-pill-${p.attainment.tone} accd-attain tnum`}>{p.attainment.text}</span>
            )}
          </li>
        ))}
      </ol>
    </div>
  )
}

function Grid({ ticks, geo }) {
  return (
    <g className="accd-grid">
      {ticks.map((t) => (
        <g key={t}>
          <line x1={PAD_LEFT} x2={geo.right} y1={geo.y(t)} y2={geo.y(t)} />
          <text x={PAD_LEFT - 8} y={geo.y(t) + 4} textAnchor="end" className="accd-axis tnum">
            {shortCount(t)}
          </text>
        </g>
      ))}
      <line x1={PAD_LEFT} x2={geo.right} y1={geo.base} y2={geo.base} className="accd-baseline" />
    </g>
  )
}

/** 2500 -> 2.5k: axis labels only, where the gridline carries the scale. */
function shortCount(v) {
  return v >= 1000 ? `${Number((v / 1000).toFixed(1))}k` : String(v)
}

// ------------------------------------------------------------------ monthly
function Monthly({ series, geo }) {
  const stripes = useId().replace(/:/g, '')
  const bw = Math.min(geo.cw * 0.56, 44)
  return (
    <g>
      <defs>
        <pattern id={stripes} patternUnits="userSpaceOnUse" width="8" height="8" patternTransform="rotate(45)">
          <rect width="8" height="8" className="accd-stripe-base" />
          <rect width="4" height="8" className="accd-stripe-line" />
        </pattern>
      </defs>
      {series.points.map((p, i) => {
        const x = geo.x(i) - bw / 2
        const yv = geo.y(p.value)
        const h = geo.base - yv
        const inside = !p.isCurrent && h >= 20
        return (
          <g key={p.key} data-bar={p.key}>
            {p.internal != null && (
              <rect
                x={x}
                y={geo.y(p.internal)}
                width={bw}
                height={geo.base - geo.y(p.internal)}
                rx={Math.min(6, (geo.base - geo.y(p.internal)) / 2)}
                className="accd-target-bar"
                data-testid="target-bar"
              />
            )}
            {h > 0 && (
              <rect
                x={x}
                y={yv}
                width={bw}
                height={h}
                rx={Math.min(6, h / 2)}
                className="accd-actual-bar"
                fill={p.isCurrent ? `url(#${stripes})` : undefined}
                data-current={p.isCurrent || undefined}
              />
            )}
            {p.value > 0 && (
              <text
                x={geo.x(i)}
                y={inside ? geo.base - 6 : yv - 6}
                textAnchor="middle"
                className={`accd-bar-value tnum${inside ? ' is-inside' : ''}`}
              >
                {fmt(p.value)}
              </text>
            )}
            {p.contractor != null && (
              <line
                x1={x - 5}
                x2={x + bw + 5}
                y1={geo.y(p.contractor)}
                y2={geo.y(p.contractor)}
                className="accd-pip-tick"
                data-testid="pip-tick"
              />
            )}
          </g>
        )
      })}
    </g>
  )
}

// --------------------------------------------------------------- cumulative
function Cumulative({ series, geo }) {
  const gradient = useId().replace(/:/g, '')
  const pts = (field) =>
    series.points.map((p, i) => (p[field] == null ? null : { x: geo.x(i), y: geo.y(p[field]), v: p[field] }))
  const approved = pts('value')
  const internal = pts('internal')
  const contractor = pts('contractor')
  const current = series.points.findIndex((p) => p.isCurrent)

  return (
    <g>
      <defs>
        <linearGradient id={gradient} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" className="accd-area-top" />
          <stop offset="100%" className="accd-area-bottom" />
        </linearGradient>
      </defs>
      {runs(approved).map((run, k) => (
        <path key={`a${k}`} d={areaPath(run, geo.base)} fill={`url(#${gradient})`} className="accd-area" />
      ))}
      {runs(internal).map((run, k) => (
        <path key={`i${k}`} d={linePath(run)} className="accd-line-internal" data-testid="line-internal" />
      ))}
      {runs(contractor).map((run, k) => (
        <path key={`c${k}`} d={linePath(run)} className="accd-line-contractor" data-testid="line-contractor" />
      ))}
      {runs(approved).map((run, k) => (
        <path key={`l${k}`} d={monotonePath(run)} className="accd-line-approved" data-testid="line-approved" />
      ))}
      {current >= 0 && approved[current] && (
        <circle cx={approved[current].x} cy={approved[current].y} r="4.5" className="accd-current-point" />
      )}
      <EndLabels
        geo={geo}
        items={[
          { key: 'approved', point: lastOf(approved) },
          { key: 'internal', point: lastOf(internal) },
          { key: 'contractor', point: lastOf(contractor) },
        ].filter((item) => item.point)}
      />
    </g>
  )
}

/** The value at the right edge of each series, nudged at least 15px apart. */
function EndLabels({ items, geo }) {
  const placed = nudge(items.map((item) => ({ ...item, y: item.point.y })), PAD_TOP + 4, geo.base)
  return placed.map((item) => (
    <text
      key={item.key}
      x={geo.right + 8}
      y={item.y + 4}
      className={`accd-end-label accd-end-${item.key} tnum`}
      data-testid={`end-${item.key}`}
    >
      {fmt(item.point.v)}
    </text>
  ))
}

/** The gap to the Internal PIP at the last closed month: a bracket between
 * the two lines and a white pill beside it. */
function Callout({ callout, point, geo }) {
  const x = geo.x(callout.index)
  const y1 = geo.y(point.value)
  const y2 = geo.y(point.internal)
  const bx = x - 8
  return (
    <>
      <svg className="accd-callout-bracket" width="100%" height="100%" aria-hidden="true">
        <path d={`M${bx + 4},${y1} H${bx} V${y2} H${bx + 4}`} />
      </svg>
      <span className="accd-callout tnum" style={{ left: bx - 6, top: (y1 + y2) / 2 }} data-testid="callout">
        {callout.text}
      </span>
    </>
  )
}
