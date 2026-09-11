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
import { KPI_DIRECTION } from './constants'
import { count, deltaTone, percent, TONE_COLOR } from './format'
import { doneLink, ongoingLink, problematicLink } from './links'
import { AnimatedNumber } from './charts/primitives'

/**
 * The programme in one bar.
 *
 * WHAT THIS REPLACES, AND WHY. Three equal cards for on-air / done / this
 * month, with a full-width Remaining card nested underneath carrying two
 * sub-tiles. Two problems, and they were the same problem: the figures are
 * arithmetically related and the layout said nothing about it, so the
 * relationship had to be asserted by a heading ("Remaining") and a nesting
 * convention nothing else on the page used. The width mismatch — a full-width
 * card under three one-third cards — was that inconsistency showing.
 *
 * Here the relationship *is* the layout. Every on-air site is in exactly one
 * of three segments of one bar, so the segments sum to the total by
 * construction rather than by a comment. Remaining is not a fourth figure: it
 * is the bracket under the two segments that compose it, which is what it has
 * always been.
 *
 * Each segment is a link to the sites inside it. The bar is the drill-through,
 * not a picture of one.
 */

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

/** One segment of the bar, plus the legend row that explains it below. */
function Segment({ seg, index, reduced }) {
  const body = (
    <>
      <span className="dt-seg-fill" style={{ background: seg.color }} />
      {/* In-bar label, shown only where the segment is wide enough to hold it
          without clipping. Narrow segments are named in the legend instead. */}
      {seg.share >= 12 && (
        <span className="dt-seg-inline">
          <b className="tnum">{count(seg.value)}</b>
          <i>{percent(seg.share)}</i>
        </span>
      )}
    </>
  )

  return (
    <motion.div
      className="dt-seg"
      style={{ flexGrow: Math.max(seg.share, 2) }}
      initial={reduced ? false : { flexGrow: 0.001, opacity: 0 }}
      animate={{ flexGrow: Math.max(seg.share, 2), opacity: 1 }}
      transition={{ duration: 0.7, delay: 0.05 + index * 0.1, ease: [0.16, 1, 0.3, 1] }}
    >
      {seg.href ? (
        <Link to={seg.href} className="dt-seg-hit" aria-label={`${seg.label}: ${seg.value} sites`}>
          {body}
        </Link>
      ) : (
        <span className="dt-seg-hit">{body}</span>
      )}
    </motion.div>
  )
}

export default function KpiBand({ kpis, monthName, provinceId }) {
  const reduced = useReducedMotion()
  const scope = provinceId == null ? undefined : { provinceId }

  const onair = kpis.total_onair.value
  const pct = (v) => (onair ? (v / onair) * 100 : 0)

  const segments = [
    {
      key: 'done',
      label: 'Drive tests done',
      value: kpis.total_dt_done.value,
      share: pct(kpis.total_dt_done.value),
      color: 'var(--green)',
      href: doneLink(scope),
      icon: CheckCircle2,
      kpi: kpis.total_dt_done,
      direction: KPI_DIRECTION.total_dt_done,
    },
    {
      key: 'ongoing',
      label: 'Ongoing',
      value: kpis.total_ongoing.value,
      share: pct(kpis.total_ongoing.value),
      color: 'var(--signal)',
      href: ongoingLink(scope),
      icon: CircleDashed,
      kpi: kpis.total_ongoing,
      direction: KPI_DIRECTION.total_ongoing,
    },
    {
      key: 'problematic',
      label: 'Problematic',
      value: kpis.total_problematic.value,
      share: pct(kpis.total_problematic.value),
      color: 'var(--red)',
      href: problematicLink(scope),
      icon: AlertTriangle,
      kpi: kpis.total_problematic,
      direction: KPI_DIRECTION.total_problematic,
    },
  ]

  // Remaining spans the last two segments. Drawn as a bracket under them
  // rather than as a card of its own, because that is the whole claim it
  // makes: ongoing + problematic, and nothing else.
  const remainingShare = segments[1].share + segments[2].share

  return (
    <section className="dt-band" aria-label="Programme totals">
      <header className="dt-band-head">
        <div className="dt-band-total">
          <span className="dt-band-label">Total on-air</span>
          <span className="dt-band-figure">
            <AnimatedNumber value={onair} />
          </span>
          <DeltaChip delta={kpis.total_onair.delta} direction={KPI_DIRECTION.total_onair} />
        </div>

        <div className="dt-band-month">
          <CalendarCheck size={15} strokeWidth={2} aria-hidden="true" />
          <span className="dt-band-month-label">Done this month ({monthName})</span>
          <b className="tnum">
            <AnimatedNumber value={kpis.current_month_dt_done.value} />
          </b>
          <DeltaChip
            delta={kpis.current_month_dt_done.delta}
            direction={KPI_DIRECTION.current_month_dt_done}
            small
          />
        </div>
      </header>

      <div
        className="dt-bar"
        role="img"
        aria-label={segments
          .map((s) => `${s.label}: ${s.value}, ${Math.round(s.share)} per cent`)
          .join('. ')}
      >
        {segments.map((seg, i) => (
          <Segment key={seg.key} seg={seg} index={i} reduced={reduced} />
        ))}
      </div>

      {/* The Remaining bracket, sized to the two segments it covers. */}
      <div className="dt-bracket-row">
        <span style={{ flexGrow: Math.max(segments[0].share, 2) }} />
        <motion.span
          className="dt-bracket"
          style={{ flexGrow: Math.max(remainingShare, 4) }}
          initial={reduced ? false : { opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.55, duration: 0.4 }}
        >
          <span className="dt-bracket-rule" aria-hidden="true" />
          <span className="dt-bracket-text">
            <span className="dt-bracket-label">Remaining</span>
            <b className="tnum">
              <AnimatedNumber value={kpis.total_remaining.value} />
            </b>
            <span className="dt-bracket-pct tnum">{percent(remainingShare)}</span>
            <DeltaChip
              delta={kpis.total_remaining.delta}
              direction={KPI_DIRECTION.total_remaining}
              small
            />
          </span>
        </motion.span>
      </div>

      <ul className="dt-legend-rows">
        {segments.map((seg) => (
          <li key={seg.key}>
            {seg.href ? (
              <Link to={seg.href} className="dt-legend-row">
                <LegendBody seg={seg} />
              </Link>
            ) : (
              <span className="dt-legend-row">
                <LegendBody seg={seg} />
              </span>
            )}
          </li>
        ))}
      </ul>
    </section>
  )
}

function LegendBody({ seg }) {
  const Icon = seg.icon
  return (
    <>
      <span className="dt-legend-mark" style={{ background: seg.color }} aria-hidden="true">
        <Icon size={12} strokeWidth={2.4} />
      </span>
      <span className="dt-legend-name">{seg.label}</span>
      <b className="tnum">{count(seg.value)}</b>
      <span className="dt-legend-pct tnum">{percent(seg.share)}</span>
      <DeltaChip delta={seg.kpi.delta} direction={seg.direction} small />
    </>
  )
}
