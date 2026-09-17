import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Minus,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { KPI_DIRECTION, STATE_COLOR } from './constants'
import { achievement, count, deltaTone, percent, TONE_COLOR } from './format'
import { doneLink, onairLink, ongoingLink, problematicLink, remainingLink } from './links'
import { AnimatedNumber } from './charts/primitives'

/**
 * The programme in one line of progress.
 *
 * WHAT THIS REPLACES, AND WHY. A ring split three ways. The ring fixed the
 * split bar it replaced — figures moved out of the geometry and into tiles —
 * but it kept the geometry's own failure: at the completion rate this
 * programme actually runs at, around ninety-five per cent, the done arc is
 * the ring and the two arcs a reader is scanning for are slivers a couple of
 * degrees wide. A part-to-whole chart that cannot show its small parts is
 * decoration.
 *
 * So the shape of the answer leads instead of the picture of it. The
 * completion rate is the hero figure, because it is the one number anybody
 * opening this page came for; the counts it is made of sit under it as
 * arithmetic — 625 of 661 — and the backlog, the thing that is actually
 * managed, is an accent badge rather than grey footer text. The bar under
 * them is a plain segmented track: it still sums to the on-air total by
 * construction, but nothing has to be legible *inside* a segment for the
 * band to be readable, so a two-per-cent segment costing nothing is fine.
 *
 * Each tile is a link to the sites inside it. So are the hero figures and the
 * backlog badge: every number in this band opens the sites it counted.
 */

function DeltaChip({ delta, direction = 'up', small }) {
  // No baseline, no chip. The placeholder this used to render said "no
  // baseline yet" on every tile and every footer line at once — five copies
  // of one fact, repeated on the band a reader looks at most often, which
  // taught them to read past that row entirely.
  if (delta == null) return null
  const tone = deltaTone(delta, direction)
  const color = tone ? TONE_COLOR[tone] : TONE_COLOR.flat
  const Icon = delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown
  return (
    <span className="dt-delta" style={{ color, fontSize: small ? 11.5 : 12.5 }}>
      <Icon size={small ? 12 : 14} strokeWidth={2.2} aria-hidden="true" />
      {delta > 0 ? '+' : ''}
      {count(delta)}
      {/* The period is named once, on the badge that leads the band, rather
          than three more times across the tiles under it. */}
      {!small && ' vs last month'}
    </span>
  )
}

export { DeltaChip }

export default function KpiBand({ kpis, provinceId }) {
  const reduced = useReducedMotion()
  const scope = provinceId == null ? undefined : { provinceId }

  const onair = kpis.total_onair.value
  const done = kpis.total_dt_done.value
  const remaining = kpis.total_remaining.value
  const pct = (v) => (onair ? (v / onair) * 100 : 0)
  const donePct = pct(done)

  const states = [
    {
      key: 'done',
      label: 'Drive tests done',
      value: done,
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
      tone: 'problem',
    },
  ]

  const tiles = states.map((s) => ({ ...s, share: pct(s.value) }))

  // The bar reads done, problematic, ongoing: the blocked work sits against
  // the finished work rather than being buried at the far end, which is the
  // adjacency somebody managing this programme wants to see.
  const ORDER = ['done', 'problematic', 'ongoing']
  const segments = ORDER.map((key) => tiles.find((t) => t.key === key)).filter(Boolean)

  const breakdown = segments
    .map((s) => `${s.label}: ${count(s.value)}, ${percent(s.share)}`)
    .join('. ')

  return (
    <section className="dt-hero" aria-label="Programme totals">
      <header className="dt-hero-head">
        <div className="dt-hero-primary">
          <Link
            to={doneLink(scope)}
            className="dt-hero-figure tnum"
            aria-label={`Overall progress: ${achievement(donePct)}`}
          >
            {achievement(donePct)}
          </Link>
          <span className="dt-hero-label">Overall Progress</span>
          <span className="dt-hero-denominator tnum">
            <Link
              to={doneLink(scope)}
              className="dt-cell-link"
              aria-label={`Drive tests done: ${done} sites`}
            >
              <AnimatedNumber value={done} />
            </Link>
            {' of '}
            <Link
              to={onairLink(scope)}
              className="dt-cell-link"
              aria-label={`Total on-air: ${onair} sites`}
            >
              {count(onair)}
            </Link>
            {' sites done'}
          </span>
        </div>

        <div className="dt-hero-aside">
          <Link
            to={remainingLink(scope)}
            className="dt-backlog"
            aria-label={`Remaining to target: ${remaining} sites`}
          >
            <b className="tnum">
              <AnimatedNumber value={remaining} />
            </b>
            <span>Remaining to Target</span>
          </Link>
          <DeltaChip delta={kpis.total_remaining.delta} direction={KPI_DIRECTION.total_remaining} />
        </div>
      </header>

      <div
        className="dt-hero-bar"
        role="img"
        aria-label={`${count(onair)} sites on air. ${breakdown}`}
      >
        {segments.map((s, i) =>
          s.share <= 0 ? null : (
            <motion.span
              key={s.key}
              data-testid="dt-hero-segment"
              data-state={s.key}
              className="dt-hero-segment"
              style={{ background: s.color }}
              title={`${s.label}: ${count(s.value)} (${percent(s.share)} of on-air)`}
              initial={reduced ? false : { width: 0 }}
              animate={{ width: `${s.share}%` }}
              transition={{ duration: 0.7, delay: 0.05 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
            />
          ),
        )}
      </div>

      <ul className="dt-state-tiles">
        {tiles.map((s) => (
          <li key={s.key}>
            <Link
              to={s.href}
              className={`dt-state-tile${s.tone ? ` dt-state-tile-${s.tone}` : ''}`}
            >
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
    </section>
  )
}
