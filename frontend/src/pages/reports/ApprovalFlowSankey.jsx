import { useId } from 'react'
import { FadeArea } from '../drivetest/charts/primitives'
import { fmtCount } from './kpiTheme'

const W = 640
const H = 320
const TOP = 20
const BOTTOM = H - 20
const AVAIL = BOTTOM - TOP
const GAP = 12
const NODE_X = 20
const NODE_W = 20
const BAR_X = W - 220
const BAR_W = 14
const MIN_H = 26

/**
 * "Approval Flow & Status Distribution" — every DT-done هدف village, fanned
 * from one source bar into the four ICT/CRA outcomes it can be in, as
 * ribbons whose width is each outcome's share of the whole.
 *
 * Rebuilt fresh in this app's SVG/React idiom off the mockup's visual idea
 * (`design-previews/acceptance-dashboard.html` ~L658-738: one source bar,
 * cubic-bezier ribbons into four destination bars, each ending in a label +
 * count + percentage) — not its vanilla-JS DOM code, and reading directly
 * off the /acceptance/overview payload this page already has, since all
 * four numbers live in `analysis` and `kpis.total_dt_done_villages` already.
 */
export default function ApprovalFlowSankey({ total, nodes }) {
  const base = useId()
  if (!total) {
    return <div className="empty" style={{ padding: 18 }}>No DT-done هدف villages yet.</div>
  }

  // Every destination bar gets at least MIN_H of height so a small slice
  // (CRA-approved-ICT-pending is often the thinnest) still carries a
  // readable label, taken from the larger slices rather than left to
  // overflow the plot.
  const barsAvail = AVAIL - GAP * (nodes.length - 1)
  const heights = allocateHeights(nodes.map((n) => n.value), barsAvail, MIN_H)

  let srcCum = 0
  let destCum = TOP
  const ribbons = nodes.map((n, i) => {
    const srcH = (n.value / total) * AVAIL
    const srcY0 = TOP + srcCum
    const srcY1 = srcY0 + srcH
    const destH = heights[i]
    const destY0 = destCum
    const destY1 = destY0 + destH
    const x1 = NODE_X + NODE_W
    const x2 = BAR_X
    const cx = (x1 + x2) / 2
    const d =
      `M${x1},${srcY0} C${cx},${srcY0} ${cx},${destY0} ${x2},${destY0} ` +
      `L${x2},${destY1} C${cx},${destY1} ${cx},${srcY1} ${x1},${srcY1} Z`
    srcCum += srcH
    destCum += destH + GAP
    return { ...n, d, destY0, destH, pct: Math.round((n.value / total) * 100) }
  })

  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Approval flow: every village fanned into its ICT and CRA outcome" style={{ width: '100%', height: 'auto', display: 'block' }}>
      <rect x={NODE_X} y={TOP} width={NODE_W} height={AVAIL} rx={6} fill="var(--surface-3)" stroke="var(--border-soft)" />
      <text
        x={NODE_X + NODE_W / 2} y={TOP + AVAIL / 2}
        textAnchor="middle" fontSize={11} fontWeight={700} fill="var(--text)"
        transform={`rotate(-90 ${NODE_X + NODE_W / 2} ${TOP + AVAIL / 2})`}
      >
        {fmtCount(total)} villages
      </text>

      {ribbons.map((r) => (
        // The wash tint, not the solid accent — the ribbon reads as a shadow
        // the destination bar casts back to the source, not a second solid
        // block competing with it. Same WASH table the icon chips use
        // elsewhere on this page (see AcceptanceDashboard.jsx).
        <FadeArea key={`${base}-${r.key}`} d={r.d} fill={r.wash || r.color} />
      ))}

      {ribbons.map((r) => (
        <g key={`bar-${r.key}`}>
          <rect x={BAR_X} y={r.destY0} width={BAR_W} height={r.destH} rx={4} fill={r.color} />
          <text x={BAR_X + BAR_W + 10} y={r.destY0 + r.destH / 2 - 4} fontSize={11} fontWeight={600} fill="var(--text)">
            {r.label}
          </text>
          <text x={BAR_X + BAR_W + 10} y={r.destY0 + r.destH / 2 + 12} fontSize={11.5} fontWeight={700} fill={r.color}>
            {fmtCount(r.value)}
            <tspan fill="var(--text-dim)" fontWeight={500}> · {r.pct}%</tspan>
          </text>
        </g>
      ))}
    </svg>
  )
}

/** Give every node at least `minH`, funding it from the nodes with room to
 * spare — the mockup's own algorithm, so a thin slice still reads. */
function allocateHeights(values, total, minH) {
  const heights = new Array(values.length).fill(0)
  let remaining = values.map((_, i) => i)
  let avail = total
  while (remaining.length) {
    const sum = remaining.reduce((s, i) => s + values[i], 0)
    const clamped = remaining.filter((i) => (sum ? (values[i] / sum) * avail : avail / remaining.length) < minH)
    if (clamped.length) {
      clamped.forEach((i) => {
        heights[i] = minH
        avail -= minH
      })
      remaining = remaining.filter((i) => heights[i] === 0)
    } else {
      const sum2 = remaining.reduce((s, i) => s + values[i], 0)
      remaining.forEach((i) => {
        heights[i] = sum2 ? (values[i] / sum2) * avail : avail / remaining.length
      })
      remaining = []
    }
  }
  return heights
}
