import { motion } from 'framer-motion'
import {
  AlertTriangle,
  CalendarCheck,
  CheckCircle2,
  ChevronRight,
  CircleDashed,
  Clock,
  Minus,
  Radio,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { KPI_DIRECTION } from './constants'
import { count, deltaTone, percent, TONE_COLOR } from './format'
import { doneLink, ongoingLink, problematicLink } from './links'
import { AnimatedNumber } from './charts/primitives'

/**
 * The six programme figures, in two ranks.
 *
 * The old page gave eight cards the same border, radius and shadow and left
 * the reader to work out which mattered. Here the three totals that describe
 * the whole programme are full cards, and the three that describe the
 * outstanding work are a subordinate row under Remaining — smaller, quieter,
 * and visibly parts of the number above them rather than three more
 * independent facts.
 */

export function DeltaChip({ delta, direction = 'up', small }) {
  const fontSize = small ? 11.5 : 12.5
  if (delta == null) {
    return (
      <span className="dt-delta dt-delta-none" style={{ fontSize }}>
        no baseline yet
      </span>
    )
  }

  const tone = deltaTone(delta, direction)
  const color = tone ? TONE_COLOR[tone] : TONE_COLOR.flat
  const Icon = delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown

  return (
    <span className="dt-delta" style={{ fontSize, color }}>
      <Icon size={small ? 12 : 14} strokeWidth={2.2} aria-hidden="true" />
      {delta > 0 ? '+' : ''}
      {count(delta)}
      {!small && ' vs last month'}
    </span>
  )
}

function KpiCard({ icon: Icon, label, kpi, accent, direction, href, sub, delay }) {
  const inner = (
    <>
      <span className="dt-kpi-label">
        <Icon size={15} strokeWidth={2} aria-hidden="true" />
        {label}
        {href && <ChevronRight size={14} className="dt-kpi-go" aria-hidden="true" />}
      </span>
      <span className="dt-kpi-value">
        <AnimatedNumber value={kpi.value} />
      </span>
      <span className="dt-kpi-foot">
        <DeltaChip delta={kpi.delta} direction={direction} />
        {sub}
      </span>
    </>
  )

  return (
    <motion.div
      className="dt-kpi"
      style={{ '--accent-glow': accent }}
      initial={{ opacity: 0, y: 14 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay, duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      whileHover={href ? { y: -3 } : undefined}
    >
      {href ? (
        <Link to={href} className="dt-kpi-body">
          {inner}
        </Link>
      ) : (
        <span className="dt-kpi-body">{inner}</span>
      )}
    </motion.div>
  )
}

function SubKpi({ icon: Icon, label, kpi, color, direction, href, index }) {
  const inner = (
    <>
      <span className="dt-subkpi-label">
        <Icon size={14} strokeWidth={2} style={{ color }} aria-hidden="true" />
        {label}
        {href && <ChevronRight size={13} className="dt-kpi-go" aria-hidden="true" />}
      </span>
      <span className="dt-subkpi-figure">
        <AnimatedNumber value={kpi.value} className="tnum dt-figure" />
        <DeltaChip delta={kpi.delta} direction={direction} small />
        {kpi.percent_of_onair != null && (
          <span className="dt-subkpi-pct tnum">{percent(kpi.percent_of_onair)}</span>
        )}
      </span>
    </>
  )
  return (
    <motion.div
      className="dt-subkpi"
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.18 + index * 0.05, duration: 0.35 }}
    >
      {href ? (
        <Link to={href} className="dt-subkpi-body">
          {inner}
        </Link>
      ) : (
        <span className="dt-subkpi-body">{inner}</span>
      )}
    </motion.div>
  )
}

export default function KpiRail({ kpis, monthName, provinceId }) {
  const scope = provinceId == null ? undefined : { provinceId }

  return (
    <>
      <div className="dt-kpi-grid">
        <KpiCard
          icon={Radio}
          label="Total on-air"
          kpi={kpis.total_onair}
          accent="var(--signal-glow)"
          direction={KPI_DIRECTION.total_onair}
          delay={0}
        />
        <KpiCard
          icon={CheckCircle2}
          label="Drive tests done"
          kpi={kpis.total_dt_done}
          accent="var(--green-dim)"
          direction={KPI_DIRECTION.total_dt_done}
          href={doneLink(scope)}
          delay={0.05}
          sub={
            kpis.total_dt_done.percent_of_onair != null && (
              <span className="dt-kpi-sub tnum">
                {percent(kpis.total_dt_done.percent_of_onair)} of on-air
              </span>
            )
          }
        />
        <KpiCard
          icon={CalendarCheck}
          label={`Done this month (${monthName})`}
          kpi={kpis.current_month_dt_done}
          accent="var(--violet-dim)"
          direction={KPI_DIRECTION.current_month_dt_done}
          delay={0.1}
        />
      </div>

      <motion.section
        className="dt-remaining"
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.14, duration: 0.4 }}
        aria-label="Remaining work"
      >
        <header className="dt-remaining-head">
          <span className="dt-kpi-label">
            <Clock size={15} strokeWidth={2} aria-hidden="true" />
            Remaining
          </span>
          <span className="dt-remaining-figure">
            <AnimatedNumber value={kpis.total_remaining.value} className="tnum dt-figure-lg" />
            <DeltaChip delta={kpis.total_remaining.delta} direction={KPI_DIRECTION.total_remaining} />
            {kpis.total_remaining.percent_of_onair != null && (
              <span className="dt-kpi-sub tnum">
                {percent(kpis.total_remaining.percent_of_onair)} of on-air
              </span>
            )}
          </span>
        </header>
        <div className="dt-remaining-split">
          <SubKpi
            icon={CircleDashed}
            label="Ongoing"
            kpi={kpis.total_ongoing}
            color="var(--signal-strong)"
            direction={KPI_DIRECTION.total_ongoing}
            href={ongoingLink(scope)}
            index={0}
          />
          <SubKpi
            icon={AlertTriangle}
            label="Problematic"
            kpi={kpis.total_problematic}
            color="var(--red)"
            direction={KPI_DIRECTION.total_problematic}
            href={problematicLink(scope)}
            index={1}
          />
        </div>
      </motion.section>
    </>
  )
}
