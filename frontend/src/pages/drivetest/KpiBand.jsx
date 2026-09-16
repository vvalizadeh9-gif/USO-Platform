import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  CircleDashed,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { KPI_DIRECTION, STATE_COLOR } from './constants'
import { count, deltaTone, percent, TONE_COLOR } from './format'
import { doneLink, onairLink, ongoingLink, problematicLink, remainingLink } from './links'
import { AnimatedNumber } from './charts/primitives'

/**
 * The programme in one ring.
 *
 * WHAT THIS REPLACES, AND WHY. A single horizontal bar split three ways, with
 * a drawn bracket underneath spanning two of the segments to assert that they
 * add up to Remaining. Two things were wrong with it. The segments were sized
 * by share, so the smallest — problematic, usually a few per cent — collapsed
 * to a sliver with its label suppressed and its figure unreadable, which is
 * the one segment somebody scanning this page is looking for. And the bracket
 * was a piece of chart furniture invented for this page alone: a hand-drawn
 * rule with a caption hanging off it, in a layout that reflowed whenever the
 * shares moved.
 *
 * A ring solves the first problem and deletes the second. Every on-air site
 * is one degree of arc, so the three states still sum to the total by
 * construction, but the figures no longer live inside the geometry — they sit
 * in tiles beside it at a size that does not depend on how big the slice is.
 * The total goes in the middle of the ring, where a part-to-whole chart
 * already points. Remaining stops being a bracket and becomes what it is: a
 * line of arithmetic under the tiles it is the sum of.
 *
 * Each tile is a link to the sites inside it. So are the total in the middle
 * and the Remaining line under them: every figure in this hero opens the sites
 * it counted.
 */

const SIZE = 210
const STROKE = 22
const R = (SIZE - STROKE) / 2 - 6
const C = 2 * Math.PI * R
/** Surface-coloured gap between arcs, in arc length. Marks touching fills
 * apart with white rather than with a stroke, which would add ink that is not
 * data. Two pixels at this radius. */
const GAP = 2

function DeltaChip({ delta, direction = 'up', small }) {
  if (delta == null) {
    return <span className="dt-delta dt-delta-none">no baseline yet</span>
  }
  const tone = deltaTone(delta, direction)
  const color = tone ? TONE_COLOR[tone] : TONE_COLOR.flat
  const Icon = delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown
  return (
    <span className="dt-delta" style={{ color, fontSize: small ? 11.5 : 12.5 }}>
      <Icon size={small ? 12 : 14} strokeWidth={2.2} aria-hidden="true" />
      {delta > 0 ? '+' : ''}
      {count(delta)}
      {!small && ' vs last month'}
    </span>
  )
}

export { DeltaChip }

export default function KpiBand({ kpis, monthName, provinceId }) {
  const reduced = useReducedMotion()
  const scope = provinceId == null ? undefined : { provinceId }

  const onair = kpis.total_onair.value
  const pct = (v) => (onair ? (v / onair) * 100 : 0)

  const states = [
    {
      key: 'done',
      label: 'Drive tests done',
      value: kpis.total_dt_done.value,
      color: STATE_COLOR.done,
      href: doneLink(scope),
      icon: CheckCircle2,
      kpi: kpis.total_dt_done,
      direction: KPI_DIRECTION.total_dt_done,
    },
    {
      key: 'ongoing',
      label: 'Ongoing',
      value: kpis.total_ongoing.value,
      color: STATE_COLOR.ongoing,
      href: ongoingLink(scope),
      icon: CircleDashed,
      kpi: kpis.total_ongoing,
      direction: KPI_DIRECTION.total_ongoing,
    },
    {
      key: 'problematic',
      label: 'Problematic',
      value: kpis.total_problematic.value,
      color: STATE_COLOR.problematic,
      href: problematicLink(scope),
      icon: AlertTriangle,
      kpi: kpis.total_problematic,
      direction: KPI_DIRECTION.total_problematic,
    },
  ]

  // Arc geometry. Each state gets its share of the circumference; the running
  // offset is what makes the three of them a single closed ring rather than
  // three charts drawn on top of each other.
  let running = 0
  const arcs = states.map((s) => {
    const share = pct(s.value)
    const length = (share / 100) * C
    const arc = { ...s, share, length, offset: running }
    running += length
    return arc
  })

  const remainingShare = pct(kpis.total_remaining.value)

  return (
    <section className="dt-hero" aria-label="Programme totals">
      <div className="dt-hero-ring">
        <svg
          viewBox={`0 0 ${SIZE} ${SIZE}`}
          className="dt-ring-svg"
          role="img"
          aria-label={
            `${onair} sites on air. ` +
            arcs
              .map((a) => `${a.label}: ${a.value}, ${Math.round(a.share)} per cent`)
              .join('. ')
          }
        >
          <g transform={`rotate(-90 ${SIZE / 2} ${SIZE / 2})`}>
            {/* The track. Visible on its own so a programme that is barely
                started still reads as a ring with very little in it, rather
                than as three stray marks. */}
            <circle
              cx={SIZE / 2}
              cy={SIZE / 2}
              r={R}
              fill="none"
              stroke="var(--dt-track)"
              strokeWidth={STROKE}
            />
            {arcs.map((arc, i) => {
              if (arc.length <= 0) return null
              const drawn = Math.max(arc.length - GAP, 0.5)
              return (
                <motion.circle
                  key={arc.key}
                  data-testid="dt-ring-arc"
                  data-state={arc.key}
                  cx={SIZE / 2}
                  cy={SIZE / 2}
                  r={R}
                  fill="none"
                  stroke={arc.color}
                  strokeWidth={STROKE}
                  strokeDasharray={`${drawn} ${C - drawn}`}
                  initial={reduced ? false : { strokeDashoffset: -arc.offset - arc.length }}
                  animate={{ strokeDashoffset: -arc.offset }}
                  transition={{
                    duration: 0.7,
                    delay: 0.05 + i * 0.12,
                    ease: [0.16, 1, 0.3, 1],
                  }}
                />
              )
            })}
          </g>
        </svg>

        <div className="dt-ring-core">
          <Link
            to={onairLink(scope)}
            className="dt-ring-figure"
            aria-label={`Total on-air: ${onair} sites`}
          >
            <AnimatedNumber value={onair} />
          </Link>
          <span className="dt-ring-label">sites on air</span>
          <DeltaChip delta={kpis.total_onair.delta} direction={KPI_DIRECTION.total_onair} small />
        </div>
      </div>

      <div className="dt-hero-body">
        <ul className="dt-state-tiles">
          {arcs.map((s) => (
            <li key={s.key}>
              <Link to={s.href} className="dt-state-tile">
                <span className="dt-state-head">
                  <span className="dt-state-mark" style={{ background: s.color }} aria-hidden="true">
                    <s.icon size={12} strokeWidth={2.4} />
                  </span>
                  <span className="dt-state-name">{s.label}</span>
                </span>
                <span className="dt-state-figure tnum">{count(s.value)}</span>
                <span className="dt-state-foot">
                  <span className="dt-state-share tnum">{percent(s.share)} of on-air</span>
                  <DeltaChip delta={s.kpi.delta} direction={s.direction} small />
                </span>
              </Link>
            </li>
          ))}
        </ul>

        <div className="dt-hero-foot">
          {/* Remaining is not a fourth state — it is the two tiles above it
              added together, said in a line rather than drawn as a bracket. */}
          <span className="dt-foot-item">
            <span className="dt-foot-label">Remaining</span>
            {/* The <b> stays inside the link: it is what gives this figure its
                weight, and a bare link in its place would render as body
                text. */}
            <Link
              to={remainingLink(scope)}
              className="dt-cell-link"
              aria-label={`Remaining: ${kpis.total_remaining.value} sites`}
            >
              <b className="tnum">
                <AnimatedNumber value={kpis.total_remaining.value} />
              </b>
            </Link>
            <span className="dt-foot-sub tnum">{percent(remainingShare)}</span>
            <DeltaChip
              delta={kpis.total_remaining.delta}
              direction={KPI_DIRECTION.total_remaining}
              small
            />
          </span>
          <span className="dt-foot-item">
            <CalendarCheck size={14} strokeWidth={2} aria-hidden="true" />
            <span className="dt-foot-label">Done this month ({monthName})</span>
            <b className="tnum">
              <AnimatedNumber value={kpis.current_month_dt_done.value} />
            </b>
            <DeltaChip
              delta={kpis.current_month_dt_done.delta}
              direction={KPI_DIRECTION.current_month_dt_done}
              small
            />
          </span>
        </div>
      </div>
    </section>
  )
}
