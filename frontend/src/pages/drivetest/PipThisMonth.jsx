import { monthProgress } from '../../lib/shamsi'
import { DrillLink } from './DrillPanel'
import InfoTip from './InfoTip'
import MonthLabel from '../../components/MonthLabel'
import Section from '../../components/Section'
import { achievement, count } from './format'
import { deliveredLink } from './links'

/**
 * The month's PIP in four figures: what was planned, what was handed out,
 * what is still owed, and what was delivered.
 *
 * This replaces the summary half of the "Plan and delivery" card, which spent
 * a half-width card's height -- a rate, a bar, four captioned tiles and a
 * sentence -- on figures that, in a month with nothing committed, were a
 * column of zeros and dashes. The per-contractor half moves into the
 * contractor scorecard, where it is the same rows as the rest of each
 * contractor's figures.
 *
 * NOTHING HERE IS COMPUTED DIFFERENTLY. Plan, Assigned and Achieved are the
 * payload's `pip`, `assigned` and `actual`. Remaining is the old card's "Short
 * by", arithmetic unchanged: `pip - actual`, floored at zero because a
 * contractor who overshot is short by nothing, and null -- drawn as a dash --
 * when there is no approved PIP to be short of.
 *
 * A MONTH WITH NOTHING COMMITTED IS DRAWN AS ONE. With no approved PIP,
 * every figure is set in the softest text colour, so a zero reads as "nothing
 * was committed" rather than as a measured result of nothing delivered, and a
 * sentence in place of the bar says so in words.
 *
 * The rate and its "Today" pace tick come only when there is something to
 * pace: "37.5%" means nothing without knowing the month is 60% gone. There is
 * no note under the bar (UEP-04a): the card ends on the bar, and What moved
 * below takes the space.
 *
 * A PIP CARRIES NO PROVINCE, so this card is not narrowed by the province
 * filter and says so when one is applied -- see the note in `useDashboard`.
 * Narrowing the delivered half alone would divide one province's delivery by
 * the whole programme's commitment and call it achievement.
 *
 * A contractor account receives its own figures here, and the unnamed
 * programme average as its only benchmark past its own row. That is enforced
 * by the endpoint; this component shows whatever it was given.
 */
export default function PipThisMonth({ state, onRetry, scoped, provinceName }) {
  return (
    <Section
      title="PIP this month"
      tile="calendar"
      subtitle={state.data?.month_label && <MonthLabel label={state.data.month_label} />}
      inline
      // The month's achievement, as the card's total on the right.
      actions={
        state.data?.achievement_percent != null && (
          <span className="dt-section-total tnum">
            <b>{achievement(state.data.achievement_percent)}</b>
          </span>
        )
      }
      state={state}
      onRetry={onRetry}
      skeletonRows={3}
      className="dt-pip-section"
      info={
        <InfoTip label="About PIP this month">
          Each contractor&rsquo;s own plan and delivery are in the contractor scorecard. A PIP
          has to be approved before its achievement is scored, and a PIP is committed for the
          whole programme, not per province.
        </InfoTip>
      }
    >
      {(data) => (
        <PipTiles data={data} scoped={scoped} provinceName={provinceName} />
      )}
    </Section>
  )
}

function PipTiles({ data, scoped, provinceName }) {
  const pct = data.achievement_percent
  const committed = pct != null
  const remaining = committed ? Math.max(0, data.pip - data.actual) : null
  const expected = data.committed_contractors + data.uncommitted_contractors
  const pace = committed ? monthProgress(data.shamsi_year, data.shamsi_month) : null

  return (
    <>
      {scoped && (
        <p className="dt-scope-note">
          Not narrowed to{' '}
          {provinceName ? <span className="dt-farsi">{provinceName}</span> : 'this province'}: a
          PIP is committed per contractor for the whole programme.
        </p>
      )}

      <dl className={`dt-pip-tiles${committed ? '' : ' is-uncommitted'}`}>
        <PipTile label="Plan" value={count(data.pip)} />
        <PipTile label="Assigned" value={count(data.assigned)} />
        <PipTile
          label="Achieved"
          value={count(data.actual)}
          tone={committed && data.actual > 0 ? 'done' : undefined}
          // The one figure here with a list of sites behind it: Plan and
          // Assigned count commitments and handovers, not sites.
          href={deliveredLink({ year: data.shamsi_year, month: data.shamsi_month })}
        />
        <PipTile
          label="Remaining"
          value={remaining == null ? '—' : count(remaining)}
          tone={remaining > 0 ? 'problem' : undefined}
        />
      </dl>

      {committed && (
        <div
          className="dt-plan-progress"
          role="img"
          aria-label={`Achievement ${achievement(pct)}${
            pace ? `, ${count(pace.elapsed)} of ${count(pace.total)} days into the month` : ''
          }`}
        >
          <span
            data-testid="dt-pip-progress-fill"
            className="dt-plan-progress-fill"
            style={{ width: `${Math.min(100, pct)}%` }}
          />
          {/* Where an even pace through the month would be today, labelled
              in words under the tick (UEP-04). */}
          {pace && (
            <span
              data-testid="dt-pip-pace"
              className="dt-plan-pace"
              style={{ left: `${Math.min(100, pace.percent)}%` }}
              aria-hidden="true"
            >
              <span className="dt-plan-pace-label">Today</span>
            </span>
          )}
        </div>
      )}

      {/* Nothing committed is a state, not a note: no bar, and why. */}
      {!committed && (
        <p className="dt-pip-uncommitted">
          {count(data.committed_contractors)} of {count(expected)} contractors have an approved
          PIP, so nothing is committed and nothing is scored.
        </p>
      )}
    </>
  )
}

function PipTile({ label, value, tone, href }) {
  return (
    <div className="dt-pip-tile" data-tone={tone}>
      <dt>{label}</dt>
      <dd className="tnum">
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
