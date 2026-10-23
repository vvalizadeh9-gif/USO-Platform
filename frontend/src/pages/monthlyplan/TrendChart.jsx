import { useEffect, useRef, useState } from 'react'
import { shamsiMonthName } from '../../lib/shamsi'
import { PAD, niceMax } from './chartLayout'

const DEFAULT_SIZE = { w: 720, h: 190 }

/** The element's size, kept current; a fixed size where nothing is laid out (tests). */
function useSize(ref) {
  const [size, setSize] = useState(DEFAULT_SIZE)
  useEffect(() => {
    const node = ref.current
    if (!node || typeof ResizeObserver === 'undefined') return undefined
    const observer = new ResizeObserver(([entry]) => {
      const { width, height } = entry.contentRect
      if (width > 0 && height > 0) setSize({ w: Math.round(width), h: Math.round(height) })
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [ref])
  return size
}

/**
 * One contractor's year for one stream: PIP (grey line) against actual
 * (cobalt line) over the twelve Shamsi months.
 *
 * Completed months are points on the actual line; the running month is a
 * capsule as tall as its PIP, filled to what is delivered so far; months after
 * the planned one are shaded ("not yet", not "empty"). The PIP line carries on
 * to next month's planned figure. Value labels sit above the dot when actual
 * meets the PIP and below it when under, so they never cross the PIP line.
 *
 * `rows` is contractorYear(...).rows. The Table tab is the accessible
 * equivalent of this picture.
 */
export default function TrendChart({ rows, label }) {
  const box = useRef(null)
  const { w, h } = useSize(box)
  const plotW = w - PAD.left - PAD.right
  const plotH = h - PAD.top - PAD.bottom
  const cw = plotW / 12
  const runningIndex = rows.findIndex((r) => r.running)

  const top = niceMax(Math.max(0, ...rows.flatMap((r) => [r.pip ?? 0, r.actual ?? 0])))
  const x = (i) => PAD.left + cw * (i + 0.5)
  const y = (v) => PAD.top + plotH - (plotH * v) / top

  const pipPoints = rows.map((r, i) => (r.pip != null ? { i, v: r.pip } : null)).filter(Boolean)
  const actualPoints = rows
    .map((r, i) => (!r.future && !r.running && r.actual != null ? { i, v: r.actual, pip: r.pip } : null))
    .filter(Boolean)
  const path = (points) => points.map((p, n) => `${n ? 'L' : 'M'}${x(p.i).toFixed(1)} ${y(p.v).toFixed(1)}`).join(' ')
  const area =
    actualPoints.length > 1
      ? `${path(actualPoints)} L${x(actualPoints.at(-1).i).toFixed(1)} ${y(0)} L${x(actualPoints[0].i).toFixed(1)} ${y(0)} Z`
      : null

  return (
    <div className="mp2-chart" ref={box}>
      <svg width={w} height={h} viewBox={`0 0 ${w} ${h}`} role="img" aria-label={label}>
        {rows.map((r, i) => {
          const planned = runningIndex >= 0 && i === runningIndex + 1
          return r.future && !planned ? (
            <rect key={`s${i}`} className="mp2-future" x={PAD.left + cw * i} y={PAD.top} width={cw} height={plotH} />
          ) : null
        })}

        {[0, top / 2, top].map((v) => (
          <g key={v}>
            <line className="mp2-grid" x1={PAD.left} x2={w - PAD.right} y1={y(v)} y2={y(v)} />
            <text className="mp2-axis" x={PAD.left - 8} y={y(v)} textAnchor="end" dominantBaseline="middle">
              {v}
            </text>
          </g>
        ))}

        {rows.map((r, i) => (
          <text
            key={`m${i}`}
            className="mp2-month mp-fa"
            data-running={r.running || undefined}
            x={x(i)}
            y={h - 8}
            textAnchor="middle"
          >
            {shamsiMonthName(r.month)}
          </text>
        ))}

        {area && <path className="mp2-area" d={area} />}
        {pipPoints.length > 1 && <path className="mp2-pip-line" d={path(pipPoints)} pathLength="1" />}
        {pipPoints.map((p, n) => (
          <circle key={`p${p.i}`} className="mp2-pip-dot" cx={x(p.i)} cy={y(p.v)} r="3" style={{ '--i': n }} />
        ))}

        {actualPoints.length > 1 && <path className="mp2-actual-line" d={path(actualPoints)} pathLength="1" />}
        {actualPoints.map((p, n) => {
          const under = p.pip != null && p.v < p.pip
          return (
            <g key={`a${p.i}`} className="mp2-actual-dot" style={{ '--i': n }}>
              <circle cx={x(p.i)} cy={y(p.v)} r="6" />
              <text className="mp2-value" x={x(p.i)} y={y(p.v) + (under ? 22 : -12)} textAnchor="middle">
                {p.v}
              </text>
            </g>
          )
        })}

        {runningIndex >= 0 && <Capsule row={rows[runningIndex]} cx={x(runningIndex)} y={y} />}
      </svg>
    </div>
  )
}

/** The running month: as tall as its PIP, filled to what is delivered so far. */
function Capsule({ row, cx, y }) {
  const height = row.pip ?? row.actual ?? 0
  const filled = Math.min(row.actual ?? 0, height)
  const base = y(0)
  const topY = y(height)
  return (
    <g className="mp2-capsule">
      <rect className="mp2-capsule-track" x={cx - 9} y={topY} width="18" height={Math.max(base - topY, 0)} rx="9" />
      {filled > 0 && <rect className="mp2-capsule-fill" x={cx - 9} y={y(filled)} width="18" height={base - y(filled)} rx="9" />}
      <text className="mp2-value" x={cx} y={topY - 8} textAnchor="middle">
        {row.pip != null ? `${row.actual ?? 0} of ${row.pip}` : (row.actual ?? 0)}
      </text>
    </g>
  )
}
