import { CheckCircle2, ClipboardList, Gauge, Target } from 'lucide-react'
import { Link } from 'react-router-dom'
import { achievement, bandColor, count, planScale } from './format'
import { deliveredLink } from './links'
import BulletBar, { BulletKey } from './charts/BulletBar'
import Section from './Section'

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
 */
export default function PlanDelivery({ state, onRetry }) {
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
            <div className="dt-figures">
              <Figure
                icon={Target}
                label="PIP"
                value={count(data.pip)}
                color="var(--text-dim)"
                note={
                  uncommitted > 0
                    ? `${uncommitted} not committed`
                    : `${data.committed_contractors} committed`
                }
              />
              <Figure
                icon={ClipboardList}
                label="Assigned"
                value={count(data.assigned)}
                color="var(--text-dim)"
              />
              <Figure
                icon={CheckCircle2}
                label="Actual"
                value={count(data.actual)}
                color="var(--dt-done)"
                // Delivered is the one figure here with a list behind it: PIP
                // and Assigned count commitments and handovers, not sites this
                // dashboard can open.
                href={deliveredLink({
                  year: data.shamsi_year,
                  month: data.shamsi_month,
                })}
              />
              <Figure
                icon={Gauge}
                label="Achievement"
                value={achievement(data.achievement_percent) ?? '—'}
                color={bandColor(data.achievement_percent)}
                // Null, not zero: there is no plan to have achieved a share
                // of, and "0%" would report a failure that has not happened.
                note={data.achievement_percent == null ? 'no approved plan' : null}
                emphasis
              />
            </div>

            <ContractorAchievement
              rows={data.rows}
              programme={data.programme_achievement_percent}
              year={data.shamsi_year}
              month={data.shamsi_month}
            />
          </>
        )
      }}
    </Section>
  )
}

function Figure({ icon: Icon, label, value, color, note, emphasis, href }) {
  return (
    <div className={`dt-figure-tile${emphasis ? ' dt-figure-emphasis' : ''}`}>
      <span className="dt-figure-label">
        <Icon size={14} strokeWidth={2} style={{ color }} aria-hidden="true" />
        {label}
      </span>
      {href ? (
        <Link to={href} className="dt-cell-link" aria-label={`${label}: ${value}`}>
          <span className="dt-figure" style={emphasis ? { color } : undefined}>
            {value}
          </span>
        </Link>
      ) : (
        <span className="dt-figure" style={emphasis ? { color } : undefined}>
          {value}
        </span>
      )}
      {note && <span className="dt-figure-note">{note}</span>}
    </div>
  )
}

function ContractorAchievement({ rows, programme, year, month }) {
  if (!rows || rows.length === 0) {
    return <div className="dt-empty">No contractor plans for this month.</div>
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
