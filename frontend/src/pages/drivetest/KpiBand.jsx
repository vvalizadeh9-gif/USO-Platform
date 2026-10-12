import { motion, useReducedMotion } from 'framer-motion'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import KpiSpark from '../../components/KpiSpark'
import { KPI_DIRECTION } from './constants'
import { count, deltaTone, kpiPercent, share, TONE_COLOR } from './format'
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
 * TWO RENDERINGS, ONE RULE. `pill` is the KPI band's: the signed number in
 * bold ink with the comparison spelled out beside it, and no colour -- a
 * period-over-period change is shown neutral with its sign (Cobalt: figures
 * are ink). The tone is still computed and carried as `data-tone`, and a
 * visually hidden word says it, so the meaning is still announced. The
 * default is the inline icon-and-number form, which is what
 * `charts/FlowChart` draws beside the gap figure.
 */
function DeltaChip({ delta, direction = 'up', small, pill }) {
  if (delta == null) return null
  const tone = deltaTone(delta, direction)
  const color = tone ? TONE_COLOR[tone] : TONE_COLOR.flat
  // A flat month is written ±0 rather than 0: the sign is what the eye reads
  // on this chip, and "0" beside "+4" and "-12" scans as a missing sign.
  const text = delta === 0 ? '±0' : `${delta > 0 ? '+' : ''}${count(delta)}`

  if (pill) {
    // The KPI tile's change line (UEP-04): "+64 vs last month", or "No
    // change" for a flat month. Danger ink only when the change is bad.
    return (
      <span className="dt-delta dt-delta-pill">
        <b data-tone={tone ?? 'flat'}>{delta === 0 ? 'No change' : text}</b>
        <span className="dt-sr-only">{TONE_WORD[tone ?? 'flat']}</span>
        {delta !== 0 && <span className="dt-delta-since">vs last month</span>}
      </span>
    )
  }

  const Icon = delta === 0 ? Minus : delta > 0 ? TrendingUp : TrendingDown
  return (
    <span className="dt-delta" style={{ color, fontSize: small ? 12 : 14 }}>
      <Icon size={small ? 12 : 14} strokeWidth={2.2} aria-hidden="true" />
      {delta > 0 ? '+' : ''}
      {count(delta)}
      {!small && ' vs last month'}
    </span>
  )
}

/** What the tone of a change means, in words, for a screen reader: the
 * number itself is drawn in neutral ink. */
const TONE_WORD = { good: 'better', bad: 'worse', flat: 'no change' }

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

/** The shortest series a KPI sparkline is drawn from. A line from four
 * points is mostly the accident of where the series starts. */
const SPARK_MIN_POINTS = 7

/** The Pending-by-status colours: ongoing is the data colour, problematic
 * the one bad colour, not started the neutral (never a fourth hue). */
const STATUS_COLOR = {
  ongoing: 'var(--uep-accent)',
  problematic: 'var(--uep-danger)',
  not_started: 'var(--uep-neutral-data)',
}

/**
 * One KPI tile, the same anatomy as Home's strip (kpi-strip.css): label,
 * figure, change line and a 12-month sparkline. The share of on air, where a
 * tile has one, is the end of the change line rather than a meter of its own.
 */
function KpiTile({ kpi, direction, index, title, value, href, ariaLabel, metric, ofOnAir, series }) {
  const tone = metric.delta == null ? null : deltaTone(metric.delta, direction)
  return (
    <div className="hk-tile dt-kpi-card" data-kpi={kpi} style={{ '--i': index }}>
      <span className="hk-label dt-kpi-title">{title}</span>
      <DrillLink to={href} className="hk-value dt-kpi-figure tnum" aria-label={ariaLabel}>
        <AnimatedNumber value={value} />
      </DrillLink>
      <span className="hk-delta dt-kpi-change" data-tone={tone ?? 'flat'}>
        <DeltaChip pill delta={metric.delta} direction={direction} />
        {ofOnAir != null && (
          <span className="dt-kpi-pct tnum">
            {metric.delta != null && ' · '}
            {kpiPercent(ofOnAir)} of on air
          </span>
        )}
      </span>
      {series?.length >= SPARK_MIN_POINTS && (
        <KpiSpark
          values={series}
          baseline="fit"
          testId="dt-spark"
          label={`${title} over the last ${series.length} months`}
        />
      )}
    </div>
  )
}

export default function KpiBand({ kpis, provinceId, series }) {
  const scope = provinceId == null ? undefined : { provinceId }

  const onair = kpis.total_onair.value
  const done = kpis.total_dt_done.value
  const pending = kpis.total_remaining.value
  const ongoing = kpis.total_ongoing.value
  const problematic = kpis.total_problematic.value
  const notStarted = kpis.total_not_started.value

  // The same two ratios as before, computed once, now said in the change
  // line. Two figures on one card that disagree about a percentage is the
  // failure this page is most often accused of.
  const donePct = onair ? (done / onair) * 100 : 0
  const pendingPct = onair ? (pending / onair) * 100 : 0

  const shareOfPending = (v) => (pending ? share(v, pending) : '0%')

  const parts = [
    { key: 'ongoing', label: 'Ongoing', value: ongoing, href: ongoingLink(scope) },
    { key: 'problematic', label: 'Problematic', value: problematic, href: problematicLink(scope) },
    { key: 'not_started', label: 'Not started', value: notStarted, href: notStartedLink(scope) },
  ]

  // Named parts only, so the bar's accessible name says which states are in
  // it rather than reading out three numbers where one of them is zero.
  const stackLabel = `Pending by status: ${parts
    .filter((p) => p.value > 0)
    .map((p) => `${p.label} ${count(p.value)}`)
    .join(', ')}`

  return (
    <section className="hk-strip dt-kpi-band" aria-label="Programme totals">
      <KpiTile
        kpi="onair"
        direction={KPI_DIRECTION.total_onair}
        index={0}
        title="On air"
        value={onair}
        href={onairLink(scope)}
        ariaLabel={`Total on-air: ${onair} sites`}
        metric={kpis.total_onair}
        series={series?.onAir}
      />
      <KpiTile
        kpi="done"
        direction={KPI_DIRECTION.total_dt_done}
        index={1}
        title="DT done"
        value={done}
        href={doneLink(scope)}
        ariaLabel={`Total DT done: ${done} sites`}
        metric={kpis.total_dt_done}
        ofOnAir={donePct}
        series={series?.dtDone}
      />
      <KpiTile
        kpi="pending"
        direction={KPI_DIRECTION.total_remaining}
        index={2}
        title="Pending"
        value={pending}
        href={remainingLink(scope)}
        ariaLabel={`Total pending: ${pending} sites`}
        metric={kpis.total_remaining}
        ofOnAir={pendingPct}
        series={series?.pending}
      />

      {/* Pending by status: no headline figure, because it would repeat
          Pending. Three rows in words and figures, then the stack -- colour
          is the fast read here, never the only one. */}
      <div className="hk-tile dt-kpi-card" data-kpi="status" style={{ '--i': 3 }}>
        <span className="hk-label dt-kpi-title">Pending by status</span>
        <ul className="dt-status-list">
          {parts.map((p) => (
            <li key={p.key}>
              <DrillLink to={p.href} className="dt-status-row">
                <span className="dt-status-name">
                  <span
                    className="dt-kpi-part-dot"
                    style={{ background: STATUS_COLOR[p.key] }}
                    aria-hidden="true"
                  />
                  {p.label}
                </span>
                <span className="dt-status-figs">
                  <span className="dt-status-num tnum">{count(p.value)}</span>
                  <span className="dt-status-pct tnum">{shareOfPending(p.value)}</span>
                </span>
              </DrillLink>
            </li>
          ))}
        </ul>
        <SplitBar
          label={stackLabel}
          segments={parts.map((p) => ({
            key: p.key,
            pct: pending ? (p.value / pending) * 100 : 0,
            color: STATUS_COLOR[p.key],
          }))}
        />
      </div>
    </section>
  )
}
