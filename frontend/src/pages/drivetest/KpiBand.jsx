import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertTriangle,
  CheckCircle2,
  CircleDashed,
  Hourglass,
  Minus,
  Radio,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
import { Link } from 'react-router-dom'
import { KPI_DIRECTION, STATE_COLOR } from './constants'
import { achievement, count, deltaTone, percent, TONE_COLOR } from './format'
import {
  doneLink,
  onairLink,
  ongoingLink,
  problematicLink,
  remainingLink,
} from './links'
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

// The bar's four legend swatches, in the order they are named. "Rest of
// pending" is not-started sites: on-air, no drive-test status yet, part of
// Pending but drawn as the neutral rest of the track rather than a fourth
// segment, since nothing is actually happening to them yet.
const BAR_LEGEND = [
  { key: 'done', label: 'DT done', color: STATE_COLOR.done },
  { key: 'ongoing', label: 'Ongoing', color: STATE_COLOR.ongoing },
  { key: 'problematic', label: 'Problematic', color: STATE_COLOR.problematic },
  { key: 'rest', label: 'Rest of pending', color: 'var(--dt-track)' },
]

export default function KpiBand({ kpis, provinceId }) {
  const reduced = useReducedMotion()
  const scope = provinceId == null ? undefined : { provinceId }

  const onair = kpis.total_onair.value
  const done = kpis.total_dt_done.value
  const pending = kpis.total_remaining.value
  const ongoing = kpis.total_ongoing.value
  const problematic = kpis.total_problematic.value

  const pctOfOnair = (v) => (onair ? (v / onair) * 100 : 0)
  // Guarded the same way: a programme with nothing pending has nothing to
  // take a share of, so it reads 0% rather than dividing by zero.
  const pctOfPending = (v) => (pending ? (v / pending) * 100 : 0)
  const donePct = pctOfOnair(done)

  // On air and Pending are totals, not states something is happening to, so
  // they take the neutral mark rather than one of the three state hues —
  // see constants.js for why this page reserves those three for done,
  // ongoing and problematic and nothing else.
  const NEUTRAL = 'var(--dt-notstarted)'

  const tiles = [
    {
      key: 'onair',
      label: 'On air',
      value: onair,
      color: NEUTRAL,
      icon: Radio,
      href: onairLink(scope),
      foot: 'launched sites',
      kpi: kpis.total_onair,
      direction: KPI_DIRECTION.total_onair,
    },
    {
      key: 'done',
      label: 'DT done',
      value: done,
      color: STATE_COLOR.done,
      icon: CheckCircle2,
      href: doneLink(scope),
      foot: `${percent(donePct)} of on air`,
      kpi: kpis.total_dt_done,
      direction: KPI_DIRECTION.total_dt_done,
    },
    {
      key: 'pending',
      label: 'Pending',
      value: pending,
      color: NEUTRAL,
      icon: Hourglass,
      href: remainingLink(scope),
      foot: 'on air minus DT done',
      // No delta chip here: Pending's delta already leads the band on the
      // pill above, and repeating it on the tile is the same number twice
      // rather than a second fact.
      kpi: null,
      tone: 'pending',
    },
    {
      key: 'ongoing',
      label: 'Ongoing',
      value: ongoing,
      color: STATE_COLOR.ongoing,
      icon: CircleDashed,
      href: ongoingLink(scope),
      foot: `${percent(pctOfPending(ongoing))} of pending`,
      kpi: kpis.total_ongoing,
      direction: KPI_DIRECTION.total_ongoing,
    },
    {
      key: 'problematic',
      label: 'Problematic',
      value: problematic,
      color: STATE_COLOR.problematic,
      icon: AlertTriangle,
      href: problematicLink(scope),
      foot: `${percent(pctOfPending(problematic))} of pending`,
      kpi: kpis.total_problematic,
      direction: KPI_DIRECTION.total_problematic,
      tone: 'problem',
    },
  ]

  // The bar draws only the three states something is happening to, in that
  // order: done sits against ongoing and problematic rather than being
  // buried at the far end. Not started is the untouched backlog inside
  // Pending and is never a segment — see BAR_LEGEND above.
  const BAR_ORDER = ['done', 'ongoing', 'problematic']
  const barValues = { done, ongoing, problematic }
  const barColor = { done: STATE_COLOR.done, ongoing: STATE_COLOR.ongoing, problematic: STATE_COLOR.problematic }
  const barLabel = { done: 'DT done', ongoing: 'Ongoing', problematic: 'Problematic' }
  // Only the states that actually have sites are drawn, and the bar's
  // description is built from the same list — a screen reader is told what
  // the bar shows, not "Problematic: 0, 0%" for a state that is empty this
  // month, and Not started is never named here at all.
  const segments = BAR_ORDER.map((key) => ({
    key,
    label: barLabel[key],
    value: barValues[key],
    color: barColor[key],
    share: pctOfOnair(barValues[key]),
  })).filter((s) => s.share > 0)

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
            aria-label={`Pending: ${pending} sites`}
          >
            <b className="tnum">
              <AnimatedNumber value={pending} />
            </b>
            <span>Pending</span>
          </Link>
          <DeltaChip delta={kpis.total_remaining.delta} direction={KPI_DIRECTION.total_remaining} />
        </div>
      </header>

      <div className="dt-hero-bar-row">
        <div
          className="dt-hero-bar"
          role="img"
          aria-label={`${count(onair)} sites on air. ${breakdown}`}
        >
          {segments.map((s, i) => (
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
          ))}
        </div>
        <div className="dt-legend dt-hero-legend">
          {BAR_LEGEND.map((l) => (
            <span key={l.key} className="dt-legend-item">
              <i style={{ background: l.color }} aria-hidden="true" />
              {l.label}
            </span>
          ))}
        </div>
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
                <span className="dt-state-share tnum">{s.foot}</span>
                {s.kpi && <DeltaChip delta={s.kpi.delta} direction={s.direction} small />}
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  )
}
