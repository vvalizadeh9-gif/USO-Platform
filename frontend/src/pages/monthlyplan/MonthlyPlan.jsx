import { useState } from 'react'
import { EmptyState, PageHead } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { canDecidePlans } from '../../lib/roles'
import { currentShamsiPeriod } from '../../lib/shamsi'
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
  // Opens on the current Shamsi month, which is the month somebody is filing
  // for or chasing on almost every visit. Not stored anywhere: it is a
  // default the picker can change, and the server converts every date that
  // is kept.
  const [period, setPeriod] = useState(currentShamsiPeriod)

  const isContractor = user?.role?.name === 'Contractor'
  const complete = Boolean(period?.year && period?.month)

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Monthly Plan"
        subtitle={
          isContractor
            ? 'How many drive tests you commit to this month. The PM approves it, or sends it back with a comment.'
            : 'What each contractor has committed to this month, and who has not filed yet.'
        }
        actions={<PeriodPicker period={period} onChange={setPeriod} />}
      />

      {/* The record first, then the month.
          A commitment is decided by looking at the last few months, so the
          record is above the form rather than behind a tab: splitting them
          would put the main input to this month's number one click away from
          the field it goes in. The scorecard carries its own range, which is
          why it is not driven by the picker above -- that picks the month
          being filed for, and this is about the ones already filed. */}
      <Scorecard canSeeAllContractors={!isContractor} />

      <div className="mt-24">
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
