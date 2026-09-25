import { motion, useReducedMotion } from 'framer-motion'
import { useId, useState } from 'react'
import { DrawPath, FadeArea } from '../drivetest/charts/primitives'
import { fmtCount } from './kpiTheme'

/* ------------------------------------------------------------- line chart */

const LINE_W = 640
const LINE_PAD_L = 8
const LINE_PAD_R = 8
const LINE_PAD_T = 10
const LINE_PAD_B = 22

/**
 * A trend line/area chart for a month-keyed series — the pattern
 * `drivetest/charts/FlowChart.jsx` draws (self-drawing lines, a filled area
 * under one of them, a crosshair that opens on the latest month), rebuilt
 * generically for however many series the Acceptance Dashboard's own charts
 * need, since none of them share FlowChart's on-air/DT-done shape.
 *
 * `series` is `{ key, label, color, dashed, area, value(month) }[]`. A
 * `value` that returns `null` for a month breaks the line rather than
 * drawing through a gap that was never observed (`acceptancePlan.js`'s own
 * rule for a missing drive-test reading).
 */
export function TrendLineChart({ months, series, height = 220, ariaLabel, legend = true }) {
  const reduced = useReducedMotion()
  const base = useId()
  const [hover, setHover] = useState(null)

  const n = months.length
  const plotW = LINE_W - LINE_PAD_L - LINE_PAD_R
  const plotH = height - LINE_PAD_T - LINE_PAD_B
  const x = (i) => LINE_PAD_L + (n > 1 ? (plotW * i) / (n - 1) : plotW / 2)

  const allValues = series.flatMap((s) => months.map((m, i) => s.value(m, i)).filter((v) => v != null))
  const rawMax = allValues.length ? Math.max(...allValues, 0) : 0
  const max = Math.max(rawMax * 1.12, 1)
  const y = (v) => LINE_PAD_T + plotH - (v / max) * plotH

  const latest = n - 1
  const active = hover != null ? hover : latest
  const activeMonth = months[active]

  /** Runs of consecutive non-null points, each its own path segment — a
   * gap in the data breaks the line instead of joining across it. */
  const segments = (s) => {
    const runs = []
    let cur = []
    months.forEach((m, i) => {
      const v = s.value(m, i)
      if (v == null) {
        if (cur.length) runs.push(cur)
        cur = []
      } else {
        cur.push([i, v])
      }
    })
    if (cur.length) runs.push(cur)
    return runs
  }

  const pathFor = (pts) =>
    pts.map(([i, v], k) => `${k === 0 ? 'M' : 'L'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join(' ')

  const areaFor = (pts) => {
    if (pts.length < 2) return ''
    const top = pathFor(pts)
    const [lastI] = pts[pts.length - 1]
    const [firstI] = pts[0]
    return `${top} L${x(lastI).toFixed(1)},${LINE_PAD_T + plotH} L${x(firstI).toFixed(1)},${LINE_PAD_T + plotH} Z`
  }

  const labelEvery = n > 9 ? 2 : 1

  return (
    <div>
      <div
        role="img"
        aria-label={ariaLabel}
        onMouseLeave={() => setHover(null)}
        style={{ width: '100%' }}
      >
        <svg viewBox={`0 0 ${LINE_W} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
          <defs>
            {series.filter((s) => s.area).map((s) => (
              <linearGradient key={s.key} id={`${base}-${s.key}`} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={s.color} stopOpacity="0.22" />
                <stop offset="100%" stopColor={s.color} stopOpacity="0.02" />
              </linearGradient>
            ))}
          </defs>

          <line
            x1={LINE_PAD_L} x2={LINE_W - LINE_PAD_R}
            y1={LINE_PAD_T + plotH} y2={LINE_PAD_T + plotH}
            stroke="var(--border-soft)" strokeWidth={1}
          />

          {n > 0 && (
            <line
              data-testid="acc-trend-crosshair"
              x1={x(active)} x2={x(active)} y1={LINE_PAD_T} y2={LINE_PAD_T + plotH}
              stroke="var(--border)" strokeWidth={1} strokeDasharray="3 3"
            />
          )}

          {series.map((s) => (
            <g key={s.key}>
              {s.area && segments(s).map((run, i) => (
                <FadeArea key={i} d={areaFor(run)} fill={`url(#${base}-${s.key})`} delay={0.1} />
              ))}
              {segments(s).map((run, i) => (
                <DrawPath
                  key={i}
                  d={pathFor(run)}
                  stroke={s.color}
                  strokeWidth={s.dashed ? 1.75 : 2}
                  dashed={s.dashed}
                />
              ))}
              {!s.dashed && months.map((m, i) => {
                const v = s.value(m, i)
                if (v == null) return null
                return (
                  <motion.circle
                    key={i}
                    cx={x(i)} cy={y(v)} r={2.6}
                    fill="var(--surface-1)" stroke={s.color} strokeWidth={1.75}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: 0.5 + i * 0.02, duration: 0.25 }}
                  />
                )
              })}
            </g>
          ))}

          {months.map((m, i) =>
            i % labelEvery === 0 || i === n - 1 ? (
              <text
                key={i} x={x(i)} y={height - 6}
                textAnchor="middle" fontSize={9.5} fill="var(--text-dim)"
              >
                {m.label}
              </text>
            ) : null
          )}

          {months.map((m, i) => (
            <rect
              key={i}
              x={x(i) - plotW / Math.max(n, 1) / 2}
              y={0} width={plotW / Math.max(n, 1)} height={height}
              fill="transparent"
              onMouseEnter={() => setHover(i)}
            />
          ))}
        </svg>
      </div>

      {activeMonth && (
        <div className="row wrap" style={{ gap: 14, fontSize: 11.5, marginTop: 6 }} role="status">
          <b className="dim" style={{ fontWeight: 600 }}>{activeMonth.label}</b>
          {series.map((s) => {
            const v = s.value(activeMonth, active)
            return (
              <span key={s.key} className="row" style={{ gap: 5 }}>
                <i style={{ width: 8, height: 8, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                {s.label}: <b className="tnum">{v == null ? '—' : fmtCount(v)}</b>
              </span>
            )
          })}
        </div>
      )}

      {legend && (
        <div className="row wrap" style={{ gap: 14, fontSize: 11.5, marginTop: 8 }}>
          {series.map((s) => (
            <span key={s.key} className="row" style={{ gap: 5, color: 'var(--text-muted)' }}>
              <i
                style={{
                  width: 14, height: s.dashed ? 0 : 2, display: 'inline-block',
                  borderTop: s.dashed ? `2px dashed ${s.color}` : `2px solid ${s.color}`,
                }}
              />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}

/* ------------------------------------------------------------- bar charts */

const BAR_W = 640
const BAR_PAD_L = 8
const BAR_PAD_R = 8
const BAR_PAD_T = 18
const BAR_PAD_B = 22

/**
 * Grouped, animated vertical bars — "Monthly Approval Velocity": three
 * series that overlap in meaning (an ICT approval and a fully-accepted
 * village are not disjoint counts), so grouped rather than stacked, one
 * cluster of three bars per Shamsi month. Modelled on
 * `drivetest/charts/RankedBars.jsx`'s width-animated bars, turned upright.
 */
export function VelocityBars({ months, series, height = 240 }) {
  const reduced = useReducedMotion()
  const plotW = BAR_W - BAR_PAD_L - BAR_PAD_R
  const plotH = height - BAR_PAD_T - BAR_PAD_B
  const n = months.length || 1

  const allValues = series.flatMap((s) => months.map((m) => s.value(m) ?? 0))
  const max = Math.max(...allValues, 1) * 1.15

  const groupW = plotW / n
  const groupPad = 8
  const barGap = 3
  const barW = Math.max(2, (groupW - groupPad * 2 - barGap * (series.length - 1)) / series.length)

  return (
    <div>
      <svg viewBox={`0 0 ${BAR_W} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        <line
          x1={BAR_PAD_L} x2={BAR_W - BAR_PAD_R} y1={BAR_PAD_T + plotH} y2={BAR_PAD_T + plotH}
          stroke="var(--border-soft)" strokeWidth={1}
        />
        {months.map((m, gi) => {
          const gx0 = BAR_PAD_L + gi * groupW + groupPad
          return (
            <g key={m.key}>
              {series.map((s, si) => {
                const v = Math.max(0, s.value(m) ?? 0)
                const bh = (plotH * v) / max
                const bx = gx0 + si * (barW + barGap)
                const by = BAR_PAD_T + plotH - bh
                return (
                  <motion.rect
                    key={s.key}
                    data-testid="acc-velocity-bar"
                    x={bx} y={by} width={barW} height={Math.max(bh, v > 0 ? 1 : 0)}
                    rx={2} fill={s.color}
                    initial={reduced ? false : { opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ duration: 0.35, delay: gi * 0.03 + si * 0.02 }}
                  />
                )
              })}
              <text
                x={BAR_PAD_L + gi * groupW + groupW / 2} y={height - 6}
                textAnchor="middle" fontSize={9.5} fill="var(--text-dim)"
              >
                {m.label}
              </text>
            </g>
          )
        })}
      </svg>
      <div className="row wrap" style={{ gap: 14, fontSize: 11.5, marginTop: 8 }}>
        {series.map((s) => (
          <span key={s.key} className="row" style={{ gap: 5, color: 'var(--text-muted)' }}>
            <i style={{ width: 9, height: 9, borderRadius: 2, background: s.color, display: 'inline-block' }} />
            {s.label}
          </span>
        ))}
      </div>
    </div>
  )
}

/**
 * "ICT vs CRA Comparison" — one stacked bar per authority (Approved /
 * Pending / Rejected), the same split-bar language `AuthorityCard` already
 * draws lower on this page, with a count/percentage toggle on the trailing
 * figures.
 */
/**
 * One labelled track per verdict, per authority — Approved, Pending and
 * Rejected each get their own row rather than three segments of one stacked
 * bar. Three separate tracks are what makes the two authorities comparable
 * down the column: ICT's Pending row sits directly above CRA's, so the eye
 * reads one verdict across both without first having to find that segment
 * inside a shared bar.
 *
 * Both figures stay on screen in either mode. The toggle chooses which one
 * leads — a count reads as the workload, a percentage as the standing — and
 * the other follows it, muted, so switching never hides a number somebody
 * was reading.
 */
export function AuthorityCompareBars({ rows, mode }) {
  return (
    <div style={{ display: 'grid', gap: 18 }}>
      {rows.map((r) => {
        const total = r.parts.reduce((s, p) => s + p.value, 0) || 1
        return (
          <div key={r.key}>
            <div className="row" style={{ gap: 7, marginBottom: 9 }}>
              <span style={{ color: r.color, fontWeight: 700, fontSize: 13 }}>{r.name}</span>
            </div>
            <div style={{ display: 'grid', gap: 8 }}>
              {r.parts.map((p, i) => {
                const pct = Math.round((p.value / total) * 100)
                const lead = mode === 'pct' ? `${pct}%` : fmtCount(p.value)
                const follow = mode === 'pct' ? fmtCount(p.value) : `${pct}%`
                return (
                  <div key={p.label} className="row" style={{ gap: 10 }}>
                    <span style={{ width: 66, flexShrink: 0, fontSize: 11.5, color: 'var(--text-muted)' }}>
                      {p.label}
                    </span>
                    <span
                      className="split-bar"
                      style={{ flex: '1 1 auto', height: 9, minWidth: 0 }}
                    >
                      <motion.span
                        style={{ background: p.color, transformOrigin: 'left center' }}
                        initial={{ flex: pct || 0.001, scaleX: 0 }}
                        animate={{ flex: pct || 0.001, scaleX: 1 }}
                        transition={{ duration: 0.45, delay: i * 0.05, ease: [0.16, 1, 0.3, 1] }}
                      />
                      {pct < 100 && <span style={{ flex: 100 - pct, background: 'transparent' }} />}
                    </span>
                    <b className="tnum" style={{ width: 58, flexShrink: 0, textAlign: 'right', fontSize: 12.5 }}>
                      {lead}
                    </b>
                    <span
                      className="tnum dim"
                      style={{ width: 46, flexShrink: 0, textAlign: 'right', fontSize: 11.5 }}
                    >
                      {follow}
                    </span>
                  </div>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
}
