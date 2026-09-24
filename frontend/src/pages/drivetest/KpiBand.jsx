import { motion, useReducedMotion } from 'framer-motion'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { KPI_DIRECTION, STATE_COLOR } from './constants'
import { count, deltaTone, percent, share, TONE_COLOR } from './format'
import {
  doneLink,
  notStartedLink,
  onairLink,
  ongoingLink,
  problematicLink,
  remainingLink,
} from './links'
import { AnimatedNumber } from './charts/primitives'
import { DrillLink } from './DrillPanel'

function DeltaChip({ delta, direction = 'up', small }) {
  if (delta == null) return null
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

function DonutChart({ ongoing, problematic, notStarted, total }) {
  const reduced = useReducedMotion()
  const radius = 48
  const cx = 62
  const cy = 62
  const circumference = 2 * Math.PI * radius
  const strokeW = 13

  const segments = [
    { value: ongoing, color: STATE_COLOR.ongoing, label: 'Ongoing' },
    { value: problematic, color: STATE_COLOR.problematic, label: 'Problematic' },
    { value: notStarted, color: STATE_COLOR.not_started, label: 'Not started' },
  ].filter((s) => s.value > 0)

  let offset = 0

  return (
    <svg
      viewBox={`0 0 ${cx * 2} ${cy * 2}`}
      className="dt-donut-svg"
      role="img"
      aria-label={`Pending status: ${segments.map((s) => `${s.label} ${count(s.value)}`).join(', ')}`}
    >
      <circle
        cx={cx}
        cy={cy}
        r={radius}
        fill="none"
        stroke="var(--surface-3)"
        strokeWidth={strokeW}
      />
      {segments.map((seg, i) => {
        const pct = total ? seg.value / total : 0
        const dashLen = pct * circumference
        const gap = circumference - dashLen
        const currentOffset = -offset + circumference * 0.25
        offset += dashLen
        return (
          <motion.circle
            key={seg.label}
            cx={cx}
            cy={cy}
            r={radius}
            fill="none"
            stroke={seg.color}
            strokeWidth={strokeW}
            strokeDasharray={`${dashLen} ${gap}`}
            strokeDashoffset={currentOffset}
            strokeLinecap="butt"
            initial={reduced ? false : { strokeDasharray: `0 ${circumference}` }}
            animate={{ strokeDasharray: `${dashLen} ${gap}` }}
            transition={{ duration: 0.8, delay: i * 0.12, ease: [0.16, 1, 0.3, 1] }}
          />
        )
      })}
      <text x={cx} y={cy - 4} textAnchor="middle" className="dt-donut-value tnum">
        {count(total)}
      </text>
      <text x={cx} y={cy + 14} textAnchor="middle" className="dt-donut-label">
        sites
      </text>
    </svg>
  )
}

function ProgressBar({ value, max, color }) {
  const reduced = useReducedMotion()
  const pct = max > 0 ? Math.min((value / max) * 100, 100) : 0
  return (
    <div className="dt-kpi-pbar">
      <motion.div
        className="dt-kpi-pbar-fill"
        style={{ background: color }}
        initial={reduced ? false : { width: 0 }}
        animate={{ width: `${pct}%` }}
        transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
      />
    </div>
  )
}

export default function KpiBand({ kpis, flow, provinceId }) {
  const scope = provinceId == null ? undefined : { provinceId }

  const onair = kpis.total_onair.value
  const done = kpis.total_dt_done.value
  const pending = kpis.total_remaining.value
  const ongoing = kpis.total_ongoing.value
  const problematic = kpis.total_problematic.value
  const notStarted = kpis.total_not_started.value

  const donePct = onair ? (done / onair) * 100 : 0
  const pendingPct = onair ? (pending / onair) * 100 : 0

  const shareOfPending = (v) => (pending ? share(v, pending) : '0%')

  const parts = [
    {
      key: 'ongoing',
      label: 'Ongoing',
      value: ongoing,
      color: STATE_COLOR.ongoing,
      href: ongoingLink(scope),
    },
    {
      key: 'problematic',
      label: 'Problematic',
      value: problematic,
      color: STATE_COLOR.problematic,
      href: problematicLink(scope),
    },
    {
      key: 'not_started',
      label: 'Not started',
      value: notStarted,
      color: STATE_COLOR.not_started,
      href: notStartedLink(scope),
    },
  ]

  return (
    <section className="dt-kpi-band" aria-label="Programme totals">
      {/* Card 1: Total On-air */}
      <div className="dt-kpi-card" data-kpi="onair">
        <div className="dt-kpi-main">
          <span className="dt-kpi-title">Total On-air</span>
          <DrillLink
            to={onairLink(scope)}
            className="dt-kpi-figure tnum"
            aria-label={`Total on-air: ${onair} sites`}
          >
            <AnimatedNumber value={onair} />
          </DrillLink>
          <DeltaChip delta={kpis.total_onair.delta} direction={KPI_DIRECTION.total_onair} />
          <span className="dt-kpi-sub">Launched sites</span>
          <ProgressBar value={onair} max={onair} color="var(--border)" />
          <span className="dt-kpi-target tnum">{count(onair)} / {count(onair)}</span>
        </div>
      </div>

      {/* Card 2: Total DT Done */}
      <div className="dt-kpi-card" data-kpi="done">
        <div className="dt-kpi-main">
          <span className="dt-kpi-title">Total DT Done</span>
          <DrillLink
            to={doneLink(scope)}
            className="dt-kpi-figure tnum"
            aria-label={`Total DT done: ${done} sites`}
          >
            <AnimatedNumber value={done} />
          </DrillLink>
          <DeltaChip delta={kpis.total_dt_done.delta} direction={KPI_DIRECTION.total_dt_done} />
          <span className="dt-kpi-sub">{percent(donePct)} of on-air</span>
          <ProgressBar value={done} max={onair} color="var(--dt-done)" />
          <span className="dt-kpi-target tnum">
            {count(done)} / {count(onair)}
            {pending > 0 && (
              <span className="dt-kpi-behind"> · {count(pending)} remaining</span>
            )}
          </span>
        </div>
      </div>

      {/* Card 3: Total Pending */}
      <div className="dt-kpi-card" data-kpi="pending">
        <div className="dt-kpi-main">
          <span className="dt-kpi-title">Total Pending</span>
          <DrillLink
            to={remainingLink(scope)}
            className="dt-kpi-figure tnum"
            aria-label={`Total pending: ${pending} sites`}
          >
            <AnimatedNumber value={pending} />
          </DrillLink>
          <DeltaChip
            delta={kpis.total_remaining.delta}
            direction={KPI_DIRECTION.total_remaining}
          />
          <span className="dt-kpi-sub">On air, drive test not done</span>
          <ProgressBar value={pending} max={onair} color="var(--dt-problem)" />
          <span className="dt-kpi-target tnum">{percent(pendingPct)} of on-air</span>
        </div>
      </div>

      {/* Card 4: Pending Status donut */}
      <div className="dt-kpi-card dt-kpi-card-donut" data-kpi="status">
        <span className="dt-kpi-title">Pending Status</span>
        <div className="dt-donut-wrap">
          <DonutChart
            ongoing={ongoing}
            problematic={problematic}
            notStarted={notStarted}
            total={pending}
          />
          <ul className="dt-donut-legend">
            {parts.map((p) => (
              <li key={p.key}>
                <DrillLink to={p.href} className="dt-donut-item">
                  <span
                    className="dt-kpi-part-dot"
                    style={{ background: p.color }}
                    aria-hidden="true"
                  />
                  <span className="dt-donut-name">{p.label}</span>
                  <span className="dt-donut-num tnum">{count(p.value)}</span>
                  <span className="dt-donut-pct tnum">{shareOfPending(p.value)}</span>
                </DrillLink>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}
