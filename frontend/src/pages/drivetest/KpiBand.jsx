import { motion, useReducedMotion } from 'framer-motion'
import { Minus, TrendingDown, TrendingUp } from 'lucide-react'
import { Link } from 'react-router-dom'
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
import { AnimatedNumber, Sparkline } from './charts/primitives'

/**
 * The three totals this programme is run on, and what pending is made of.
 *
 * WHAT THIS REPLACES, AND WHY. A hero built around one big completion
 * percentage, with a four-state bar under it and five tiles under that. Two
 * things were wrong with it.
 *
 * The percentage led, and it is the figure nobody acts on. At the rate this
 * programme runs — around ninety-five per cent — it moves a tenth of a point
 * a month and reads the same all year. The reader opening this page is here
 * about the backlog: how big is it, which way is it going, and what is it
 * made of. That is now what the band says, in that order.
 *
 * The four-state bar had the same failure the ring before it had, one level
 * down. A part-to-whole bar of on-air is a done segment that fills it and
 * three slivers, and the slivers are the entire question. Splitting *pending*
 * instead — a number where the three parts are 60/25/15 rather than 95/3/2 —
 * gives every segment a width a reader can actually see and click.
 *
 * So: on air, DT done, and pending, with pending taking the width of the
 * other two together because it is the one carrying detail. The overall
 * progress figure and the four-state bar are gone from this band and have not
 * moved elsewhere.
 *
 * EVERY FIGURE HERE IS A LINK to the sites it counted, the three part rows
 * included — see `links.js`. That is the whole point of the band: a number
 * you cannot open is a number you have to go and re-find by hand.
 */

/** How many points a sparkline needs before it is worth drawing.
 *
 * Seven months, and it is a floor rather than a target: fewer than seven
 * points is a line whose shape is mostly the accident of where the series
 * happens to start, and a trend drawn from four months would be read with a
 * confidence it has not earned. A card whose series is too short draws
 * without one rather than drawing a shorter one — a missing sparkline is
 * obviously missing, where a three-point one looks like an answer.
 */
const SPARK_MIN_POINTS = 7

/** The three cumulative series the band's sparklines draw, or `null`.
 *
 * `/drive-test/flow` returns per-month *activity* — what went on air and what
 * was drive-tested during each month — not balances. The running totals are
 * built here, from the opening balance forward, because that is arithmetic on
 * a payload the page already has: this band adds no request and no backend
 * field.
 *
 * ONE HONEST LIMIT, and it is why these are sparklines rather than figures.
 * `not_placed` — sites whose dates the flow cannot place in any month — sits
 * outside the series by construction, so the last point of each line does not
 * equal the KPI beside it and is not meant to. The line carries the shape;
 * the figure beside it carries the number. Nothing in this band ever reads a
 * value off a sparkline.
 */
function sparkSeries(flow) {
  const months = flow?.months
  if (!months || months.length < SPARK_MIN_POINTS) return null

  let onair = flow.opening?.on_air ?? 0
  let done = flow.opening?.dt_done ?? 0
  const running = months.map((m) => {
    onair += m.on_aired ?? 0
    done += m.dt_done ?? 0
    return { onair, done, pending: onair - done }
  })

  const tail = running.slice(-SPARK_MIN_POINTS)
  return {
    onair: tail.map((p) => p.onair),
    done: tail.map((p) => p.done),
    pending: tail.map((p) => p.pending),
  }
}

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
      {/* The period is named on the three card figures and not again on the
          part rows under them, which share it. */}
      {!small && ' vs last month'}
    </span>
  )
}

export { DeltaChip }

export default function KpiBand({ kpis, flow, provinceId }) {
  const reduced = useReducedMotion()
  const scope = provinceId == null ? undefined : { provinceId }

  const onair = kpis.total_onair.value
  const done = kpis.total_dt_done.value
  const pending = kpis.total_remaining.value
  const ongoing = kpis.total_ongoing.value
  const problematic = kpis.total_problematic.value
  const notStarted = kpis.total_not_started.value

  const series = sparkSeries(flow)
  // Guarded: a programme with nothing on air has nothing to take a share of,
  // so it reads 0% rather than dividing by zero.
  const donePct = onair ? (done / onair) * 100 : 0

  /** A part's share of pending.
   *
   * Guarded rather than left to `share`, which answers an absent denominator
   * with an em dash. That is the right answer in a table, where a dash means
   * "not recorded"; here the denominator is not missing, it is zero, and
   * every part is zero with it. "0% of pending" says that plainly where
   * "— of pending" reads as a figure that failed to load.
   */
  const shareOfPending = (v) => (pending ? share(v, pending) : '0%')

  /** The three states pending is made of, in the order they are acted on.
   *
   * Ongoing first because it is work in flight and the largest of the three;
   * problematic next because it is the blocker; not started last because it
   * is the part nothing has happened to yet. Not started carries no delta —
   * the monthly snapshot has no column for it (see the backend's
   * `total_not_started`) — and `DeltaChip` renders nothing rather than a
   * zero, which is the honest answer until it has a baseline of its own.
   */
  const parts = [
    {
      key: 'ongoing',
      label: 'Ongoing',
      value: ongoing,
      color: STATE_COLOR.ongoing,
      href: ongoingLink(scope),
      kpi: kpis.total_ongoing,
      direction: KPI_DIRECTION.total_ongoing,
    },
    {
      key: 'problematic',
      label: 'Problematic',
      value: problematic,
      color: STATE_COLOR.problematic,
      href: problematicLink(scope),
      kpi: kpis.total_problematic,
      direction: KPI_DIRECTION.total_problematic,
    },
    {
      key: 'not_started',
      label: 'Not started',
      value: notStarted,
      color: STATE_COLOR.not_started,
      href: notStartedLink(scope),
      kpi: kpis.total_not_started,
      direction: KPI_DIRECTION.total_not_started,
    },
  ]

  // Only the parts that actually have sites are drawn, and the bar's
  // description is built from the same list — a screen reader is told what
  // the bar shows rather than "Problematic: 0, 0%" for a state that is empty
  // this month.
  const segments = parts
    .map((p) => ({ ...p, pct: pending ? (p.value / pending) * 100 : 0 }))
    .filter((p) => p.pct > 0)

  const barDescription = segments
    .map((s) => `${s.label}: ${count(s.value)}, ${shareOfPending(s.value)}`)
    .join('. ')

  return (
    <section className="dt-kpi-band" aria-label="Programme totals">
      <KpiCard
        kpiKey="onair"
        title="Total on-air"
        value={onair}
        href={onairLink(scope)}
        figureLabel={`Total on-air: ${onair} sites`}
        kpi={kpis.total_onair}
        direction={KPI_DIRECTION.total_onair}
        sub="launched sites"
        spark={series?.onair}
        sparkColor="var(--dt-notstarted)"
        sparkLabel={`On-air over the last ${SPARK_MIN_POINTS} months`}
      />

      <KpiCard
        kpiKey="done"
        title="Total DT done"
        value={done}
        href={doneLink(scope)}
        figureLabel={`Total DT done: ${done} sites`}
        kpi={kpis.total_dt_done}
        direction={KPI_DIRECTION.total_dt_done}
        sub={`${percent(donePct)} of on-air`}
        spark={series?.done}
        sparkColor={STATE_COLOR.done}
        sparkLabel={`Drive tests done over the last ${SPARK_MIN_POINTS} months`}
      />

      {/* Pending is wider because it is the only card carrying a breakdown.
          The figure and its trend stay on the left, in the same shape as the
          two cards beside it, so the three headline numbers still read as one
          row rather than as two cards and a panel. */}
      <div className="dt-kpi-card dt-kpi-card-wide" data-kpi="pending">
        <div className="dt-kpi-main">
          <span className="dt-kpi-title">Total pending</span>
          <Link
            to={remainingLink(scope)}
            className="dt-kpi-figure tnum"
            aria-label={`Total pending: ${pending} sites`}
          >
            <AnimatedNumber value={pending} />
          </Link>
          <DeltaChip
            delta={kpis.total_remaining.delta}
            direction={KPI_DIRECTION.total_remaining}
          />
          <span className="dt-kpi-sub">on air, drive test not done</span>
          <SparkSlot
            points={series?.pending}
            color={STATE_COLOR.ongoing}
            label={`Pending over the last ${SPARK_MIN_POINTS} months`}
          />
        </div>

        <div className="dt-kpi-parts">
          <div
            className="dt-kpi-partbar"
            role="img"
            aria-label={`${count(pending)} sites pending. ${barDescription}`}
          >
            {segments.map((s, i) => (
              <motion.span
                key={s.key}
                data-testid="dt-kpi-segment"
                data-state={s.key}
                className="dt-kpi-partbar-seg"
                style={{ background: s.color }}
                title={`${s.label}: ${count(s.value)} (${shareOfPending(s.value)} of pending)`}
                initial={reduced ? false : { width: 0 }}
                animate={{ width: `${s.pct}%` }}
                transition={{ duration: 0.7, delay: 0.05 + i * 0.1, ease: [0.16, 1, 0.3, 1] }}
              />
            ))}
          </div>

          <ul className="dt-kpi-partlist">
            {parts.map((p) => (
              <li key={p.key} data-part={p.key}>
                <Link to={p.href} className="dt-kpi-part" data-part={p.key}>
                  <span
                    className="dt-kpi-part-dot"
                    style={{ background: p.color }}
                    aria-hidden="true"
                  />
                  <span className="dt-kpi-part-name">{p.label}</span>
                  <span className="dt-kpi-part-value tnum">{count(p.value)}</span>
                  <DeltaChip delta={p.kpi?.delta} direction={p.direction} small />
                  <span className="dt-kpi-part-share tnum">
                    {shareOfPending(p.value)} of pending
                  </span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  )
}

/** One of the two plain cards. Pending is built inline above: it carries a
 * breakdown these two do not, and abstracting over that difference would
 * cost more in indirection than it saves in lines. */
function KpiCard({
  kpiKey,
  title,
  value,
  href,
  figureLabel,
  kpi,
  direction,
  sub,
  spark,
  sparkColor,
  sparkLabel,
}) {
  return (
    <div className="dt-kpi-card" data-kpi={kpiKey}>
      <div className="dt-kpi-main">
        <span className="dt-kpi-title">{title}</span>
        <Link to={href} className="dt-kpi-figure tnum" aria-label={figureLabel}>
          <AnimatedNumber value={value} />
        </Link>
        <DeltaChip delta={kpi?.delta} direction={direction} />
        <span className="dt-kpi-sub">{sub}</span>
        <SparkSlot points={spark} color={sparkColor} label={sparkLabel} />
      </div>
    </div>
  )
}

/** The sparkline, or the space it would have taken.
 *
 * The slot keeps its height when there is no series, so a card does not jump
 * when `/drive-test/flow` resolves after `/drive-test/overview` — they are
 * separate requests and routinely land in that order.
 */
function SparkSlot({ points, color, label }) {
  return (
    <span className="dt-kpi-sparkslot">
      {points ? <Sparkline points={points} color={color} label={label} /> : null}
    </span>
  )
}
