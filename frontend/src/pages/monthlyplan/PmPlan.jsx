import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import PageFrame from '../../components/PageFrame'
import ProcessStepper from '../../components/ProcessStepper'
import { PageBar, Tabs } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { currentShamsiPeriod, nextPeriod } from '../../lib/shamsi'
import ApprovalsTab from './ApprovalsTab'
import DecisionDrawer from './DecisionDrawer'
import HistoryTab from './HistoryTab'
import InternalTab from './InternalTab'
import PlansTab from './PlansTab'
import { countWaiting, monthLabel } from './planBoard'
import { streamMeta } from './streams'
import useOverview from './useOverview'
import usePlanBoard from './usePlanBoard'
import { downloadXlsx } from './xlsx'
import '../../styles/monthly-plan.css'
import { useHomeData } from '../../shell/HomeData'

const PANEL_ID = 'mp-panel'

/** The tabs in order; `?tab=` carries the key. Approvals is the default. */
const TAB_KEYS = ['approvals', 'plans', 'history', 'internal']

/** ?tab= names a tab this role has; anything else, or nothing, is Approvals. */
function tabFromParams(params, canSeeInternal) {
  const key = params.get('tab')
  if (key === 'internal' && !canSeeInternal) return 'approvals'
  return TAB_KEYS.includes(key) ? key : 'approvals'
}

/**
 * The staff side of the Monthly Plan: four tabs under one header.
 *
 * * **Approvals** (default) -- every plan waiting on the PM for the planning
 *   month, and revision requests on the running month, on one page.
 * * **Plans** -- who shared a plan for the planning month, and progress in
 *   the running month.
 * * **History** -- plan against delivered, month by month, for any year.
 * * **Internal PIP** -- MTN's own target per stream, against coverage.
 *
 * The header shows the planning month on Approvals and Plans and the running
 * month elsewhere. Role checks decide what is offered, never what is
 * allowed: the server re-checks every read and decision.
 *
 * An Action Center link (?year&month&contractor[&stream]) still opens that
 * plan's decision drawer.
 */
export default function PmPlan({ canDecide, canSetTarget, canSeeInternal }) {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = tabFromParams(params, canSeeInternal)
  const [linked] = useState(() => linkedTarget(params))
  const [running] = useState(() => currentShamsiPeriod())
  const planning = running && nextPeriod(running.year, running.month)
  const [drawer, setDrawer] = useState(linked?.contractorId ? linked : null)
  const [internalMonth, setInternalMonth] = useState('running')
  const [announcement, setAnnouncement] = useState('')

  const board = usePlanBoard({ period: planning, running, enabled: true })
  const runningOverview = useOverview({
    params: { period: 'month' },
    enabled: canSeeInternal && tab !== 'history',
  })
  const planningOverview = useOverview({
    params: { period: 'month', year: planning?.year, month: planning?.month },
    enabled: canSeeInternal && tab === 'internal' && Boolean(planning),
  })
  // One count per queue (UEP-13 §3.2): the rail's /me/home number when it has
  // one, so menu, Home and page agree; the board's own count otherwise.
  const { counts } = useHomeData()
  const waiting = counts?.plans_approve ?? countWaiting(board)

  function selectTab(next) {
    const nextParams = new URLSearchParams(params)
    if (next === 'approvals') nextParams.delete('tab')
    else nextParams.set('tab', next)
    setParams(nextParams)
  }

  function reloadAll() {
    board.reload()
    runningOverview.reload()
  }

  const headerPeriod = tab === 'approvals' || tab === 'plans' ? planning : running

  async function exportExcel() {
    if (!headerPeriod) return
    try {
      await downloadXlsx(
        '/pip/scorecard.xlsx',
        { period: 'month', year: headerPeriod.year, month: headerPeriod.month },
        'pip-plan.xlsx',
      )
    } catch {
      toast.error('Could not build the file', 'Please try again.')
    }
  }

  const tabs = [
    { key: 'approvals', label: 'Approvals', count: waiting, countLabel: 'waiting' },
    { key: 'plans', label: 'Plans' },
    { key: 'history', label: 'History' },
    ...(canSeeInternal ? [{ key: 'internal', label: 'Internal PIP' }] : []),
  ]

  return (
    <PageFrame
      className="mp-page"
      bar={
        <PageBar
          eyebrow="Planning"
          title="Monthly Plan"
          context={<ProcessStepper current="plan" />}
          actions={
            <>
              <span className="mp-month-chip mp-fa" data-testid="mp-period">{monthLabel(headerPeriod)}</span>
              <button type="button" className="mp-btn" onClick={exportExcel}>
                <Icon name="download" size={16} /> Export Excel
              </button>
            </>
          }
          tabs={<Tabs tabs={tabs} value={tab} onChange={selectTab} label="Monthly plan" panelId={PANEL_ID} />}
        />
      }
    >
      <div
        className="mp-panel"
        role="tabpanel"
        id={PANEL_ID}
        aria-labelledby={`${PANEL_ID}-tab-${tab}`}
        data-tab={tab}
      >
        {tab === 'approvals' && (
          <ApprovalsTab
            board={board}
            running={runningOverview.data}
            canDecide={canDecide}
            onDecided={reloadAll}
            announce={setAnnouncement}
          />
        )}
        {tab === 'plans' && (
          <PlansTab board={board} running={runningOverview.data} planning={planning} runningPeriod={running} />
        )}
        {tab === 'history' && <HistoryTab runningYear={running?.year} />}
        {tab === 'internal' && (
          <InternalTab
            month={internalMonth}
            onMonth={setInternalMonth}
            running={{ ...runningOverview, period: running }}
            planning={{ overview: planningOverview, period: planning }}
            board={board}
            canSetTarget={canSetTarget}
          />
        )}
      </div>
      <div className="sr-only" role="status" aria-live="polite" data-testid="mp-live">{announcement}</div>

      {drawer && (
        <DecisionDrawer
          target={drawer}
          canDecide={canDecide}
          onClose={() => setDrawer(null)}
          onDecided={reloadAll}
        />
      )}
    </PageFrame>
  )
}

/** The month (and plan) an Action Center link points at, or null. */
function linkedTarget(params) {
  const year = Number(params.get('year'))
  const month = Number(params.get('month'))
  if (!year || !month || month < 1 || month > 12) return null
  return {
    year,
    month,
    contractorId: Number(params.get('contractor')) || null,
    stream: streamMeta(params.get('stream')).stream,
    name: '',
  }
}
