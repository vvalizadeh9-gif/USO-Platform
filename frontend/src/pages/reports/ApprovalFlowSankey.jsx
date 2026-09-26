import { useId } from 'react'
import { FadeArea } from '../drivetest/charts/primitives'
import { fmtCount } from './kpiTheme'
import useChartWidth from './useChartWidth'

const H = 320
const TOP = 20
const BOTTOM = H - 20
const AVAIL = BOTTOM - TOP
const GAP = 12
const NODE_X = 20
const NODE_W = 20
const BAR_W = 14
const LABEL_GAP = 10
// The label column beside the bars: as wide as the longest name needs, and
// never more than half the card, so the ribbons keep room to read as flow.
const LABEL_MAX = 210
// Text sizes on the page's ramp: body for the name, card-title for the
// figure, secondary for its share. The viewBox is the card's real width
// (useChartWidth), so these are the sizes they render at.
const NAME_FONT = 13
const FIGURE_FONT = 15
const PCT_FONT = 12.5
// Line pitch of a wrapped name, and the step from its last line down to the
// figure under it.
const NAME_LINE = 16
const FIGURE_STEP = 19
// Generous per-character estimate at NAME_FONT, used only to decide where a
// name wraps; over-estimating costs an early wrap, never an overlap.
const NAME_CHAR_PX = 7.2

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
  const [wrapRef, W] = useChartWidth()
  if (!total) {
    return <div className="empty" style={{ padding: 18 }}>No DT-done هدف villages yet.</div>
  }

  const labelW = Math.min(LABEL_MAX, Math.floor(W / 2))
  const BAR_X = W - labelW - BAR_W - LABEL_GAP
  const maxChars = Math.max(8, Math.floor(labelW / NAME_CHAR_PX))
  const lines = nodes.map((n) => wrapLabel(n.label, maxChars))

  // Every destination bar has to be at least as tall as the label block
  // parked beside it — its name, one or two lines, over the figure — so a
  // small slice (CRA-approved-ICT-pending is often the thinnest) still
  // carries a readable label, funded from the larger slices rather than left
  // to ride into the one below.
  const longest = Math.max(...lines.map((l) => l.length))
  const minH = (longest - 1) * NAME_LINE + FIGURE_STEP + FIGURE_FONT + 4
  const barsAvail = AVAIL - GAP * (nodes.length - 1)
  const heights = allocateHeights(nodes.map((n) => n.value), barsAvail, minH)

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
    return { ...n, d, destY0, destH, lines: lines[i], pct: Math.round((n.value / total) * 100) }
  })

  return (
    <div ref={wrapRef}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} role="img" aria-label="Approval flow: every village fanned into its ICT and CRA outcome" style={{ width: '100%', height: H, display: 'block' }}>
        <rect x={NODE_X} y={TOP} width={NODE_W} height={AVAIL} rx={6} fill="var(--surface-3)" stroke="var(--border-soft)" />
        <text
          x={NODE_X + NODE_W / 2} y={TOP + AVAIL / 2}
          textAnchor="middle" fontSize={NAME_FONT} fontWeight={700} fill="var(--text)"
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

        {ribbons.map((r) => {
          // The label block — name lines, then the figure — centred on the
          // bar's midpoint.
          const blockH = (r.lines.length - 1) * NAME_LINE + FIGURE_STEP
          const y0 = r.destY0 + r.destH / 2 - blockH / 2
          const tx = BAR_X + BAR_W + LABEL_GAP
          return (
            <g key={`bar-${r.key}`}>
              <rect x={BAR_X} y={r.destY0} width={BAR_W} height={r.destH} rx={4} fill={r.color} />
              <text x={tx} y={y0} fontSize={NAME_FONT} fontWeight={600} fill="var(--text)">
                {r.lines.map((line, li) => (
                  <tspan key={li} x={tx} dy={li === 0 ? 0 : NAME_LINE}>{line}</tspan>
                ))}
              </text>
              <text x={tx} y={y0 + blockH} fontSize={FIGURE_FONT} fontWeight={700} fill={r.color}>
                {fmtCount(r.value)}
                <tspan fill="var(--text-dim)" fontWeight={500} fontSize={PCT_FONT}> · {r.pct}%</tspan>
              </text>
            </g>
          )
        })}
      </svg>
    </div>
  )
}

/** Break a name into at most two lines of about `maxChars`, at spaces. */
function wrapLabel(text, maxChars) {
  const lines = ['']
  for (const word of String(text).split(' ')) {
    const cur = lines[lines.length - 1]
    if (cur && (cur + ' ' + word).length > maxChars && lines.length < 2) lines.push(word)
    else lines[lines.length - 1] = cur ? `${cur} ${word}` : word
  }
  return lines
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
