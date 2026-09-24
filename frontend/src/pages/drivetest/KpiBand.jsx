import { motion, useReducedMotion } from 'framer-motion'
import {
  AlertCircle,
  CheckCircle2,
  Minus,
  PieChart,
  RadioTower,
  TrendingDown,
  TrendingUp,
} from 'lucide-react'
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

/** The month-over-month change on a KPI card, or beside a chart figure.
 *
 * Three states and no more: grey when the figure did not move, green when it
 * moved the way this KPI wants, red when it moved the other way. Which way is
 * "the way this KPI wants" is not a property of the sign — it comes from
 * `KPI_DIRECTION`, because three of these count work you want to see fall. See
 * `format.deltaTone` for what the dashboard this replaces got backwards.
 *
 * TWO RENDERINGS, ONE RULE. `pill` is the KPI band's: a tinted chip carrying
 * the number, with the comparison spelled out beside it. The default is the
 * inline icon-and-number form, which is what `charts/FlowChart` draws beside
 * the gap figure. They differ in appearance only — the tone, and therefore the
 * meaning, is computed once above the branch.
 */
function DeltaChip({ delta, direction = 'up', small, pill }) {
  if (delta == null) return null
  const tone = deltaTone(delta, direction)
  const color = tone ? TONE_COLOR[tone] : TONE_COLOR.flat
  // A flat month is written ±0 rather than 0: the sign is what the eye reads
  // on this chip, and "0" beside "+4" and "-12" scans as a missing sign.
  const text = delta === 0 ? '±0' : `${delta > 0 ? '+' : ''}${count(delta)}`

  if (pill) {
    return (
      <span className="dt-delta dt-delta-pill">
        <b style={{ color }} data-tone={tone ?? 'flat'}>
          {text}
        </b>
        <span className="dt-delta-since">vs last month</span>
      </span>
    )
  }

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

/** A single track carrying a proportional split.
 *
 * One component for both jobs the band asks of it: the two-part bar under DT
 * done and Pending, and the three-part stack above the pending breakdown. A
 * segment with nothing in it is dropped rather than drawn at zero width, so
 * the count of segments is the count of states that actually have sites.
 *
 * The widths are the only thing here that carries data, and they are handed in
 * already computed — this draws a split, it never works one out.
 */
function SplitBar({ segments, label }) {
  const reduced = useReducedMotion()
  const drawn = segments.filter((s) => s.pct > 0)
  return (
    <div
      className="dt-kpi-split"
      {...(label
        ? { role: 'img', 'aria-label': label }
        : { role: 'presentation', 'aria-hidden': 'true' })}
    >
      {drawn.map((seg, i) => (
        <motion.i
          key={seg.key}
          data-seg={seg.key}
          style={{ background: seg.color }}
          initial={reduced ? false : { width: 0 }}
          animate={{ width: `${seg.pct}%` }}
          transition={{ duration: 0.7, delay: i * 0.08, ease: [0.16, 1, 0.3, 1] }}
        />
      ))}
    </div>
  )
}

export default function KpiBand({ kpis, provinceId }) {
  const scope = provinceId == null ? undefined : { provinceId }

  const onair = kpis.total_onair.value
  const done = kpis.total_dt_done.value
  const pending = kpis.total_remaining.value
  const ongoing = kpis.total_ongoing.value
  const problematic = kpis.total_problematic.value
  const notStarted = kpis.total_not_started.value

  // Unchanged from the band this restyles: the same two ratios, computed the
  // same way, and reused by the split bars rather than worked out a second
  // time. Two figures on one card that disagree about a percentage is the
  // failure this page is most often accused of.
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

  // Named parts only, so the bar's accessible name says which states are in
  // it rather than reading out three numbers where one of them is zero.
  const stackLabel = `Pending status: ${parts
    .filter((p) => p.value > 0)
    .map((p) => `${p.label} ${count(p.value)}`)
    .join(', ')}`

  return (
    <section className="dt-kpi-band" aria-label="Programme totals">
      {/* Card 1: Total On-air.
          No bar. The one it used to carry read value against a maximum that
          was the same number, so it filled the track every time and told a
          reader nothing they could not see from the figure above it. */}
      <div className="dt-kpi-card" data-kpi="onair">
        <div className="dt-kpi-hd">
          <span className="dt-kpi-ic" aria-hidden="true">
            <RadioTower size={13} strokeWidth={2.2} />
          </span>
          <span className="dt-kpi-title">On air</span>
        </div>
        <div className="dt-kpi-v">
          <DrillLink
            to={onairLink(scope)}
            className="dt-kpi-figure tnum"
            aria-label={`Total on-air: ${onair} sites`}
          >
            <AnimatedNumber value={onair} />
          </DrillLink>
        </div>
        <DeltaChip pill delta={kpis.total_onair.delta} direction={KPI_DIRECTION.total_onair} />
      </div>

      {/* Card 2: Total DT Done */}
      <div className="dt-kpi-card" data-kpi="done">
        <div className="dt-kpi-hd">
          <span className="dt-kpi-ic" aria-hidden="true">
            <CheckCircle2 size={13} strokeWidth={2.2} />
          </span>
          <span className="dt-kpi-title">DT done</span>
        </div>
        <div className="dt-kpi-v">
          <DrillLink
            to={doneLink(scope)}
            className="dt-kpi-figure tnum"
            aria-label={`Total DT done: ${done} sites`}
          >
            <AnimatedNumber value={done} />
          </DrillLink>
          {/* The share is stated next to the figure, as the agreed layout
              has it. "of on-air" is what it is a share *of*, and a bare
              percentage beside a count is ambiguous without it, so the
              denominator stays in the accessible name. */}
          <span className="dt-kpi-pct tnum" aria-label={`${percent(donePct)} of on-air`}>
            {percent(donePct)}
          </span>
        </div>
        <SplitBar
          segments={[
            { key: 'done', pct: donePct, color: 'var(--dt-done)' },
            { key: 'rest', pct: pendingPct, color: 'var(--dt-problem-wash)' },
          ]}
        />
        <DeltaChip
          pill
          delta={kpis.total_dt_done.delta}
          direction={KPI_DIRECTION.total_dt_done}
        />
      </div>

      {/* Card 3: Total Pending. The bar mirrors DT done's — same two ratios,
          the other way round — so the pair reads as one split across two
          cards rather than as two unrelated measurements. */}
      <div className="dt-kpi-card" data-kpi="pending">
        <div className="dt-kpi-hd">
          <span className="dt-kpi-ic" aria-hidden="true">
            <AlertCircle size={13} strokeWidth={2.2} />
          </span>
          <span className="dt-kpi-title">Pending</span>
        </div>
        <div className="dt-kpi-v">
          <DrillLink
            to={remainingLink(scope)}
            className="dt-kpi-figure tnum"
            aria-label={`Total pending: ${pending} sites`}
          >
            <AnimatedNumber value={pending} />
          </DrillLink>
          <span className="dt-kpi-pct tnum" aria-label={`${percent(pendingPct)} of on-air`}>
            {percent(pendingPct)}
          </span>
        </div>
        <SplitBar
          segments={[
            { key: 'pending', pct: pendingPct, color: 'var(--dt-problem)' },
            { key: 'rest', pct: donePct, color: 'var(--dt-track)' },
          ]}
        />
        <DeltaChip
          pill
          delta={kpis.total_remaining.delta}
          direction={KPI_DIRECTION.total_remaining}
        />
      </div>

      {/* Card 4: Pending status.
          The stack says how pending divides; the three parts below name each
          one in words and figures. Both, never just the stack: green and
          brick are not separable under deuteranopia (see app.css), so colour
          on this page is the fast read and never the only one.

          The parts sit as three columns rather than three rows wherever the
          card is wide enough (a container query in app.css). As rows they
          made this the tallest card by a clear margin, and a band of equal
          cards takes the height of its tallest, so three cards carried a dead
          strip through their middles to make room for this one. */}
      <div className="dt-kpi-card" data-kpi="status">
        <div className="dt-kpi-hd">
          <span className="dt-kpi-ic" aria-hidden="true">
            <PieChart size={13} strokeWidth={2.2} />
          </span>
          <span className="dt-kpi-title">Pending status</span>
        </div>
        <SplitBar
          label={stackLabel}
          segments={parts.map((p) => ({
            key: p.key,
            pct: pending ? (p.value / pending) * 100 : 0,
            color: p.color,
          }))}
        />
        <ul className="dt-status-list">
          {parts.map((p) => (
            <li key={p.key}>
              {/* The swatch rides with the figures, not the word: in the
                  column layout the word gets the column's full width, which
                  is what keeps "Problematic" whole at the widths where three
                  columns only just fit. */}
              <DrillLink to={p.href} className="dt-status-row">
                <span className="dt-status-name">{p.label}</span>
                <span className="dt-status-figs">
                  <span
                    className="dt-kpi-part-dot"
                    style={{ background: p.color }}
                    aria-hidden="true"
                  />
                  <span className="dt-status-num tnum">{count(p.value)}</span>
                  <span className="dt-status-pct tnum">{shareOfPending(p.value)}</span>
                </span>
              </DrillLink>
            </li>
          ))}
        </ul>
      </div>
    </section>
  )
}
