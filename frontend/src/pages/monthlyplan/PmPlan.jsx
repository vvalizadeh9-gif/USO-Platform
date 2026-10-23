import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import Icon from '../../components/Icon'
import PageFrame from '../../components/PageFrame'
import Select from '../../components/Select'
import { PageBar } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { toPersianDigits } from '../../lib/persianDigits'
import { FIRST_SHAMSI_YEAR, currentShamsiPeriod, nextPeriod } from '../../lib/shamsi'
import DecisionDrawer from './DecisionDrawer'
import HistoryTab from './HistoryTab'
import InternalTab from './InternalTab'
import PlansTab from './PlansTab'
import { BAND_STREAMS, monthLabel } from './planBoard'
import { streamMeta } from './streams'
import useInternalTargets from './useInternalTargets'
import useOverview from './useOverview'
import usePlanBoard from './usePlanBoard'
import { downloadXlsx } from './xlsx'
import '../../styles/monthly-plan.css'

const PANEL_ID = 'mp-panel'

/** The pages in order; `?tab=` carries the key. Plans is the default. */
const TAB_KEYS = ['plans', 'history', 'internal']

/** ?tab= names a page this role has; anything else, `approvals` included, is Plans. */
function tabFromParams(params, canSeeInternal) {
  const key = params.get('tab')
  if (key === 'internal' && !canSeeInternal) return 'plans'
  return TAB_KEYS.includes(key) ? key : 'plans'
}

const TITLES = { plans: 'Plans', history: 'History', internal: 'Internal PIP' }

/**
 * The staff side of the Monthly Plan: three pages under one header.
 *
 * * **Plans** (default) -- DT delivery and Acceptance for the planning month:
 *   who submitted, what was asked, and the PM's decision in place. It took
 *   over Approvals, so `?tab=approvals` opens it.
 * * **History** -- each contractor's PIP, actual and assignment across a
 *   Shamsi year, as a trend or a table.
 * * **Internal PIP** -- MTN's own target per stream, planning against running.
 *
 * Role checks decide what is offered, never what is allowed: the server
 * re-checks every read and decision.
 *
 * An Action Center link (?year&month&contractor[&stream]) selects that
 * contractor on Plans, or opens the decision drawer for a revision request or
 * an ICT/CRA plan, which are decided there.
 */
export default function PmPlan({ canDecide, canSetTarget, canSeeInternal }) {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = tabFromParams(params, canSeeInternal)
  const [linked] = useState(() => linkedTarget(params))
  const [running] = useState(() => currentShamsiPeriod())
  const planning = running && nextPeriod(running.year, running.month)
  const linkedHere =
    linked?.contractorId && planning && linked.year === planning.year && linked.month === planning.month && BAND_STREAMS.includes(linked.stream)
  const [drawer, setDrawer] = useState(linked?.contractorId && !linkedHere ? linked : null)
  const [internalMonth, setInternalMonth] = useState('planning')
  const [historyYear, setHistoryYear] = useState(running?.year)
  const [announcement, setAnnouncement] = useState('')

  // The old Approvals address opens Plans.
  useEffect(() => {
    if (params.get('tab') === 'approvals') {
      const next = new URLSearchParams(params)
      next.set('tab', 'plans')
      setParams(next, { replace: true })
    }
  }, [params, setParams])

  const board = usePlanBoard({ period: planning, running, enabled: true })
  const planningOverview = useOverview({
    params: { period: 'month', year: planning?.year, month: planning?.month },
    enabled: canSeeInternal && (tab === 'plans' || tab === 'internal') && Boolean(planning),
  })
  const runningOverview = useOverview({ params: { period: 'month' }, enabled: canSeeInternal && tab === 'internal' })
  const targets = useInternalTargets({ planning, running, enabled: canSeeInternal && tab === 'internal' })

  const internalPip =
    canSeeInternal && planningOverview.state === 'ready'
      ? { DT: planningOverview.data.dt.kpis.internal_pip ?? null, ACCEPTANCE: planningOverview.data.acceptance.kpis.internal_pip ?? null }
      : canSeeInternal
        ? { DT: null, ACCEPTANCE: null }
        : undefined

  function reloadAll() {
    board.reload()
    planningOverview.reload()
  }

  const headerPeriod = tab === 'plans' ? planning : running

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

  const years = []
  for (let y = running?.year; y >= FIRST_SHAMSI_YEAR; y -= 1) years.push(y)

  return (
    <PageFrame
      className="mp-page"
      bar={
        <PageBar
          title={TITLES[tab]}
          actions={
            <>
              {tab === 'plans' && (
                <span className="mp-month-chip mp-fa" data-testid="mp-period">{monthLabel(planning)}</span>
              )}
              {tab === 'history' && (
                <Select
                  aria-label="Year"
                  className="mp-select mp-fa"
                  value={historyYear}
                  onChange={(e) => setHistoryYear(Number(e.target.value))}
                >
                  {years.map((y) => (
                    <option key={y} value={y}>{toPersianDigits(y)}</option>
                  ))}
                </Select>
              )}
              {tab === 'internal' && canSetTarget && (
                <>
                  {targets.saved && !targets.dirty && (
                    <span className="mp2-saved" role="status">
                      <Icon name="checkmark" size={16} /> Saved
                    </span>
                  )}
                  <button type="button" className="mp-btn" disabled={!targets.dirty || targets.saving} onClick={targets.discard}>
                    Discard
                  </button>
                  <button type="button" className="mp-btn mp-btn-primary" disabled={!targets.dirty || targets.saving} onClick={targets.save}>
                    {targets.saving ? 'Saving…' : 'Save'}
                  </button>
                </>
              )}
              <button type="button" className="mp-btn" onClick={exportExcel}>
                <Icon name="download" size={16} /> Export Excel
              </button>
            </>
          }
        />
      }
    >
      <div className="mp-panel" id={PANEL_ID} aria-label={TITLES[tab]} data-tab={tab}>
        {tab === 'plans' && (
          <PlansTab
            board={board}
            planning={planning}
            runningPeriod={running}
            canDecide={canDecide}
            internal={internalPip}
            initialContractor={linkedHere ? linked.contractorId : null}
            onDecided={reloadAll}
            announce={setAnnouncement}
            openDrawer={setDrawer}
          />
        )}
        {tab === 'history' && <HistoryTab year={historyYear} />}
        {tab === 'internal' && (
          <InternalTab
            month={internalMonth}
            onMonth={setInternalMonth}
            targets={targets}
            overviews={{ running: runningOverview, planning: planningOverview }}
            periods={{ running, planning }}
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
