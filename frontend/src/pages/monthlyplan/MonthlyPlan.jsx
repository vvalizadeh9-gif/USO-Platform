import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { EmptyState, PageHead } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { canDecidePlans, canSeeInternalPip, canSetAcceptancePlan } from '../../lib/roles'
import { planningPeriod } from '../../lib/shamsi'
import ContractorPlan from './ContractorPlan'
import PeriodPicker from './PeriodPicker'
import PmPlan from './PmPlan'

/**
 * The monthly plan (PIP), which is two screens wearing one name.
 *
 * A contractor sees their own form. Everyone else sees the PM's page
 * (PmPlan): a Plans tab and a PIP vs Achieved tab, and only the PM can
 * decide a plan.
 *
 * The role checks here decide what is offered, not what is allowed. Every
 * endpoint behind this screen re-checks the caller, and each panel below
 * handles the 403 that arrives when this disagrees with the server.
 *
 * The old PM screen's month-by-month ledger, shortfall card and commitment
 * chart are no longer rendered here: the ledger is in Export Excel. Their
 * components are kept.
 */
export default function MonthlyPlan() {
  const { user } = useAuth()
  const isContractor = user?.role?.name === 'Contractor'
  if (!isContractor) {
    return (
      <PmPlan
        canDecide={canDecidePlans(user)}
        canSetTarget={canSetAcceptancePlan(user)}
        canSeeInternal={canSeeInternalPip(user)}
      />
    )
  }
  return <ContractorMonthlyPlan />
}

function ContractorMonthlyPlan() {
  // Opens on the month being planned, which is the month *after* this one: a
  // plan is filed during the month before the month it covers. The running
  // month is on the screen as figures (and its revision block), not as the
  // month picked. Not stored: it is a default the picker can change.
  // An Action Center link (?year&month) opens the month it is about.
  const [params] = useSearchParams()
  const [period, setPeriod] = useState(() => {
    const year = Number(params.get('year'))
    const month = Number(params.get('month'))
    return year && month >= 1 && month <= 12 ? { year, month } : planningPeriod()
  })
  const complete = Boolean(period?.year && period?.month)

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Monthly Plan"
        subtitle="The drive tests and acceptances you commit to for next month, and how the month now running is going. The PM approves each number, or sends it back with a comment."
        actions={<PeriodPicker period={period} onChange={setPeriod} />}
      />
      {complete ? (
        <ContractorPlan period={period} />
      ) : (
        // Reached when the browser could not name today's Shamsi month (see
        // lib/shamsi), or when someone clears one of the selects. Asking is
        // better than opening on a month nobody chose.
        <EmptyState title="Pick a month" hint="Choose the Shamsi year and month above." />
      )}
    </>
  )
}
