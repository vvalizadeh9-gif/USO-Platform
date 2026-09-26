import { useState } from 'react'
import { EmptyState, PageHead } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { canDecidePlans } from '../../lib/roles'
import { planningPeriod } from '../../lib/shamsi'
import AcceptanceTarget from './AcceptanceTarget'
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
  // Both sides open on the month being decided, which is the month *after*
  // this one. A plan is filed and approved during the month before the month
  // it covers, so opening on today's month opens both screens on the month
  // nobody can change any more -- the contractor cannot refile it and the PM
  // has nothing left to approve. Where the running month matters, and it does
  // to both, it is on the screen as figures rather than as the month picked.
  // Not stored: it is a default the picker can change, and the server converts
  // every date that is kept.
  const [period, setPeriod] = useState(planningPeriod)
  const complete = Boolean(period?.year && period?.month)

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Monthly Plan"
        subtitle={
          isContractor
            ? 'The drive tests you commit to for next month, and how the month now running is going. The PM approves the number, or sends it back with a comment.'
            : 'What each contractor is proposing for next month, judged against what they are holding and finishing in this one.'
        }
        actions={<PeriodPicker period={period} onChange={setPeriod} />}
      />

      {/* The programme's acceptance target: one figure a PM sets each month,
          which the Acceptance Dashboard's Plan vs Actual chart draws its
          dashed line from. A contractor has no part in it. */}
      {!isContractor && <AcceptanceTarget />}

      <div>
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

      {/* The record, under the decisions rather than over them.
          It used to be the first thing on the page for everybody. For a
          contractor it is gone entirely -- the three cards and the six-month
          chart on their own screen answer the same question about their own
          company, in the same words. For everyone else it stays, because it is
          the one place every contractor's months sit side by side and the only
          way out to the spreadsheet; but the PM opens this screen to decide a
          month, and an eleven-column ledger is what you read after deciding,
          not before reaching the decision. */}
      {!isContractor && complete && (
        <div className="mt-24">
          <Scorecard canSeeAllContractors />
        </div>
      )}
    </>
  )
}
