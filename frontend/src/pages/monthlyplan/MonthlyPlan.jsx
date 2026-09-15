import { useState } from 'react'
import { EmptyState, PageHead } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { canDecidePlans } from '../../lib/roles'
import { currentShamsiPeriod, planningPeriod } from '../../lib/shamsi'
import ContractorPlan from './ContractorPlan'
import PeriodPicker from './PeriodPicker'
import PlanQueue from './PlanQueue'
import Scorecard from './Scorecard'

/**
 * The monthly plan (PIP), which is two screens wearing one name.
 *
 * A contractor sees their own form; everyone else sees the month's queue, and
 * only the PM can decide a row in it. The same submit-versus-review split
 * SubmissionForm makes, and for the same reason: it is one subject, and
 * putting the two halves on two routes means two places to find out what a
 * plan is worth this month.
 *
 * The role checks here decide what is offered, not what is allowed. Every
 * endpoint behind this screen re-checks the caller, and each panel below
 * handles the 403 that arrives when this disagrees with the server.
 */
export default function MonthlyPlan() {
  const { user } = useAuth()
  const isContractor = user?.role?.name === 'Contractor'
  // The month each side opens on is the month it has business with, and they
  // are not the same month. A contractor is filing for the month *after* this
  // one -- opening their form on today's month opens it on the one they can no
  // longer change. Everybody else is chasing the month now running. Neither is
  // stored: it is a default the picker can change, and the server converts
  // every date that is kept.
  const [period, setPeriod] = useState(
    isContractor ? planningPeriod : currentShamsiPeriod,
  )
  const complete = Boolean(period?.year && period?.month)

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Monthly Plan"
        subtitle={
          isContractor
            ? 'The drive tests you commit to for next month, and how the month now running is going. The PM approves the number, or sends it back with a comment.'
            : 'What each contractor has committed to this month, and who has not filed yet.'
        }
        actions={<PeriodPicker period={period} onChange={setPeriod} />}
      />

      {/* The record first, then the month.
          A commitment is decided by looking at the last few months, so the
          record is above the form rather than behind a tab. It is no longer
          shown to a contractor: the three cards and the six-month chart on
          their own screen answer the same question about their own company, in
          the same words, and an eleven-column ledger beside them was a second
          answer to it. Everyone else still reads it, because for them it is
          the one place every contractor's months sit side by side. */}
      {!isContractor && <Scorecard canSeeAllContractors />}

      <div className={isContractor ? undefined : 'mt-24'}>
        {complete ? (
          isContractor ? (
            <ContractorPlan period={period} />
          ) : (
            <PlanQueue period={period} canDecide={canDecidePlans(user)} />
          )
        ) : (
        // Reached when the browser could not name today's Shamsi month (see
        // lib/shamsi), or when someone clears one of the selects. Asking is
        // better than opening on a month nobody chose.
          <EmptyState
            title="Pick a month"
            hint="Choose the Shamsi year and month above."
          />
        )}
      </div>
    </>
  )
}
