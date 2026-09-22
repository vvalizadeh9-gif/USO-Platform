import { achievement, bandColor, count, planScale } from './format'
import { deliveredLink } from './links'
import BulletBar, { BulletKey } from './charts/BulletBar'
import Section from './Section'
import { DrillLink } from './DrillPanel'

/**
 * What was committed for the month against what was delivered.
 *
 * The first two tiles carry a neutral icon rather than a hue of their own.
 * PIP and Assigned used to be violet and brand teal, which put two more
 * colours on a page whose rule is that a colour means a state — and the teal
 * one was the primary-button colour, so a figure wore the "act on me" tint.
 * Actual is green because it is finished work, which is what green means
 * everywhere else here.
 *
 * A contractor signed in here receives one row — their own — and an unnamed
 * programme average. That is enforced by the endpoint, not by this component,
 * which renders whatever rows it was given.
 *
 * THIS CARD IS NOT NARROWED BY THE PROVINCE SCOPE, and it says so when one is
 * applied. A PIP is a commitment a contractor makes for a month; it carries
 * no province, so there is no province figure to compare a province's
 * delivery against. Narrowing the delivery half alone would produce an
 * achievement rate with a numerator from one province and a denominator from
 * thirty-one — a figure that looks like a measurement and is arithmetic
 * nonsense. Saying so costs one line and is the only honest option.
 */
export default function PlanDelivery({ state, onRetry, scoped, provinceName }) {
  return (
    <Section
      title="Plan and delivery"
      subtitle={state.data?.month_label}
      state={state}
      onRetry={onRetry}
      skeletonRows={5}
    >
      {(data) => {
        const uncommitted = data.uncommitted_contractors
        return (
          <>
            {/* Said out loud, because this is the one card on the page a
                province filter does not reach, and a reader who has narrowed
                everything else would otherwise read these as narrowed too.
                It cannot be narrowed: a PIP is a commitment a contractor
                makes for a month, with no province on it -- see
                `ContractorMonthlyPlan`. Scoping the delivery side alone would
                divide one province's actual by the whole programme's
                commitment and call the result achievement, which is worse
                than not narrowing at all. */}
            {scoped && (
              <p className="dt-scope-note">
                PIP is committed per contractor for the whole programme, not per
                province, so these figures cover every province
                {/* Named where the name is known. Shown on `scoped` rather
                    than on the name, because the name comes from a payload
                    that can fail to arrive while the page stays narrowed --
                    and the warning matters most when things are going wrong. */}
                {provinceName ? (
                  <>
                    {' '}— not just <span className="dt-farsi">{provinceName}</span>.
                  </>
                ) : (
                  ', not only the one this page is narrowed to.'
                )}
              </p>
            )}
            <div className="dt-plan">
              <PlanSummary data={data} uncommitted={uncommitted} />
              <ContractorAchievement
                rows={data.rows}
                programme={data.programme_achievement_percent}
                year={data.shamsi_year}
                month={data.shamsi_month}
              />
            </div>
          </>
        )
      }}
    </Section>
  )
}

/** The month in one block: the rate, then the counts behind it.
 *
 * The rate leads because it is the figure the card is asked for, and it is
 * the one figure here that is comparable month to month — 6 delivered means
 * nothing without the 16 it was promised against. The bar under it is that
 * same rate drawn, capped at the target rather than at the highest bar on
 * screen: this is a share of a commitment, not a quantity competing with
 * other quantities.
 *
 * Four counts under it rather than four tiles. Tiles gave each figure a
 * border, a background and an icon, which spent a card's worth of weight on
 * three numbers that are the arithmetic behind the fourth. Hairlines say the
 * same thing — these belong together and are read across — at a fraction of
 * the ink.
 *
 * "Short by" is the figure the card did not have and is the one somebody is
 * actually chased about. It is arithmetic the reader was being left to do,
 * on two numbers sitting forty pixels apart.
 */
function PlanSummary({ data, uncommitted }) {
  const pct = data.achievement_percent
  const color = bandColor(pct)
  const committed = data.committed_contractors
  const expected = committed + uncommitted
  // Floored at zero: a contractor who overshot is not "short by" a negative
  // number, they are short by nothing.
  const short = pct == null ? null : Math.max(0, data.pip - data.actual)

  return (
    <div className="dt-plan-summary">
      <span className="dt-plan-rate" style={{ color }}>
        {achievement(pct) ?? '—'}
      </span>
      <span className="dt-plan-rate-label">
        Achievement
        {/* Null, not zero: there is no PIP to have achieved a share of, and
            "0%" would report a failure that has not happened. */}
        {pct == null && (
          <>
            {' · '}
            <em>no approved PIP</em>
          </>
        )}
      </span>

      <span
        className="dt-plan-progress"
        role="img"
        aria-label={pct == null ? 'No approved PIP for this month' : `Achievement ${achievement(pct)}`}
      >
        <span
          data-testid="dt-plan-progress-fill"
          className="dt-plan-progress-fill"
          style={{ width: `${Math.min(100, pct ?? 0)}%`, background: color }}
        />
      </span>

      <dl className="dt-plan-figures">
        <PlanFigure label="PIP" value={count(data.pip)} />
        <PlanFigure label="Assignment" value={count(data.assigned)} />
        <PlanFigure
          label="Delivered"
          value={count(data.actual)}
          // The one figure here with a list behind it: PIP and Assignment
          // count commitments and handovers, not sites this dashboard can
          // open.
          href={deliveredLink({ year: data.shamsi_year, month: data.shamsi_month })}
        />
        <PlanFigure
          label="Short by"
          value={short == null ? '—' : count(short)}
          color={short ? 'var(--dt-problem)' : undefined}
        />
      </dl>

      {/* One text node per fact, not an interpolation split across three:
          "1 not committed" has to be findable as the phrase it is. */}
      {/* One element per phrase, not an interpolation split across text
          nodes: "1 not committed" has to be findable as the phrase it is. */}
      <p className="dt-plan-committed">
        <span>{`${count(committed)} of ${count(expected)} contractors committed`}</span>
        {uncommitted > 0 && (
          <>
            {' · '}
            <span>{`${count(uncommitted)} not committed`}</span>
          </>
        )}
      </p>
    </div>
  )
}

function PlanFigure({ label, value, href, color }) {
  return (
    <div className="dt-plan-figure">
      <dt>{label}</dt>
      <dd className="tnum" style={color ? { color } : undefined}>
        {href ? (
          <DrillLink to={href} className="dt-cell-link" aria-label={`${label}: ${value}`}>
            {value}
          </DrillLink>
        ) : (
          value
        )}
      </dd>
    </div>
  )
}

function ContractorAchievement({ rows, programme, year, month }) {
  if (!rows || rows.length === 0) {
    return <div className="dt-empty">No contractor PIP for this month.</div>
  }
  const scaleMax = planScale(rows)

  return (
    <div className="dt-achievement">
      <div className="dt-achievement-head">
        <span className="dt-label">Contractor achievement</span>
        {/* The target explained once, in place, instead of a tooltip on a
            two-pixel tick that a touch screen can never reveal. */}
        <BulletKey scaleMax={scaleMax} />
      </div>
      {rows.map((row, i) => (
        <BulletBar
          key={row.contractor_id}
          label={row.name}
          percent={row.achievement_percent}
          pip={row.pip}
          actual={row.actual}
          detail={`${count(row.actual)} of ${row.pip || '—'}`}
          short={row.achievement_percent == null ? null : Math.max(0, row.pip - row.actual)}
          href={deliveredLink({ year, month, contractorId: row.contractor_id })}
          scaleMax={scaleMax}
          index={i}
        />
      ))}
      {programme != null && (
        <ProgrammeAverage percent={programme} />
      )}
    </div>
  )
}

/** The unnamed programme benchmark a contractor account sees.
 *
 * A rate, not a bullet: there is no single plan or delivery behind it to draw
 * as bars, and inventing one on the shared count scale would put a commitment
 * on the chart that no company made.
 */
function ProgrammeAverage({ percent }) {
  return (
    <div className="dt-bullet dt-anon">
      <span className="dt-bullet-label">Programme average</span>
      <span className="dt-bullet-track dt-bullet-rate">
        <span
          data-testid="achievement-bar"
          className="dt-bullet-fill"
          style={{ width: `${Math.min(100, percent)}%`, background: 'var(--text-dim)' }}
        />
      </span>
      <span className="dt-bullet-detail tnum">all contractors</span>
      <span className="dt-bullet-pct tnum">{achievement(percent)}</span>
    </div>
  )
}
