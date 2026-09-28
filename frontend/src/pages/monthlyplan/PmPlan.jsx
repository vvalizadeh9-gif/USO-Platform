import { ChevronLeft, ChevronRight, Download } from 'lucide-react'
import { useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { PageHead, SegmentedControl, Tabs } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { currentShamsiPeriod, nextPeriod, previousPeriod, shamsiMonthName } from '../../lib/shamsi'
import DecisionDrawer from './DecisionDrawer'
import PipTab from './PipTab'
import PlansTab from './PlansTab'
import { countWaiting } from './planBoard'
import useOverview from './useOverview'
import usePlanBoard from './usePlanBoard'
import { PIP_STREAMS } from './streams'
import { downloadXlsx } from './xlsx'

const VIEWS = [
  { key: 'month', label: 'Month' },
  { key: 'year', label: 'Year' },
  { key: 'since_start', label: 'Since start' },
]

const STREAM_OPTIONS = Object.values(PIP_STREAMS).map((s) => ({ key: s.key, label: s.title }))

/** ?tab=plans is the Plans tab; anything else, or nothing, is PIP vs Achieved. */
function tabFromParams(params) {
  return params.get('tab') === 'plans' ? 'plans' : 'pip'
}

/** ?stream=acceptance (any case, so an Action Center link's ACCEPTANCE
 * counts too) is Acceptance; anything else is DT Delivery. */
function streamFromParams(params) {
  return params.get('stream')?.toLowerCase() === 'acceptance' ? PIP_STREAMS.acceptance : PIP_STREAMS.dt
}

/**
 * The PM's side of the Monthly Plan: two tabs under one header.
 *
 * * **Plans** -- the plans shared for the month being planned (next
 *   month), decided per stream (PlansTab). Its label carries, for the PM, the number of
 *   decisions waiting on them.
 * * **PIP vs Achieved** (the default) -- the month now running, or a year, or
 *   everything since the start, one stream at a time (?stream=acceptance):
 *   GET /pip/overview, drawn by PipTab.
 *
 * Each tab keeps its own month, held here so it survives a tab switch. An
 * Action Center link (?year&month[&stream&contractor]) opens that month on
 * both tabs and, with a contractor, that plan's decision drawer.
 *
 * Role checks decide what is offered, not what is allowed: the page is
 * behind MONTHLY_PLAN_ROLES, decisions are offered for canDecide only, and
 * the server re-checks both.
 */
export default function PmPlan({ canDecide, canSetTarget, canSeeInternal }) {
  const toast = useToast()
  const [params, setParams] = useSearchParams()
  const tab = tabFromParams(params)
  const pipStream = streamFromParams(params)
  const [linked] = useState(() => linkedTarget(params))
  const [running] = useState(() => currentShamsiPeriod())

  const [view, setView] = useState('month')
  const [pipPeriod, setPipPeriod] = useState(() => monthOf(linked) || running || { year: 0, month: 0 })
  const [plansPeriod, setPlansPeriod] = useState(
    () => monthOf(linked) || (running && nextPeriod(running.year, running.month)) || { year: 0, month: 0 },
  )
  const [drawer, setDrawer] = useState(linked?.contractorId ? linked : null)

  const overview = useOverview({ view, period: pipPeriod, enabled: tab === 'pip' })
  // The PM's badge needs the queue on either tab; everyone else only reads it
  // on the Plans tab.
  const board = usePlanBoard({ period: plansPeriod, running, enabled: canDecide || tab === 'plans' })
  const waiting = canDecide ? countWaiting(board) : 0

  function reloadAll() {
    overview.reload()
    board.reload()
  }

  function selectTab(next) {
    const nextParams = new URLSearchParams(params)
    if (next === 'plans') nextParams.set('tab', 'plans')
    else nextParams.delete('tab')
    setParams(nextParams)
  }

  // A view of the same page rather than a place: replaces the entry.
  function selectStream(key) {
    const nextParams = new URLSearchParams(params)
    if (key === 'acceptance') nextParams.set('stream', 'acceptance')
    else nextParams.delete('stream')
    setParams(nextParams, { replace: true })
  }

  const onPip = tab === 'pip'
  const period = onPip ? pipPeriod : plansPeriod
  const pickerView = onPip ? view : 'month'

  function step(direction) {
    const setPeriod = onPip ? setPipPeriod : setPlansPeriod
    if (pickerView === 'year') {
      setPeriod((p) => ({ ...p, year: p.year + direction }))
    } else {
      setPeriod((p) => (direction < 0 ? previousPeriod(p.year, p.month) : nextPeriod(p.year, p.month)))
    }
  }

  async function exportExcel() {
    try {
      // The period on the page, both streams: a "DT Delivery" and an
      // "Acceptance" sheet (the MTN internal PIP rows are the server's to add
      // for staff).
      const exportParams = { period: pickerView }
      if (pickerView === 'year') exportParams.year = period.year
      if (pickerView === 'month') Object.assign(exportParams, { year: period.year, month: period.month })
      await downloadXlsx('/pip/scorecard.xlsx', exportParams, 'pip-plan.xlsx')
    } catch {
      toast.error('Could not build the file', 'Please try again.')
    }
  }

  const data = onPip ? overview.data : null
  const monthName = data?.shamsi_month_name || shamsiMonthName(period.month)
  const pickerLabel =
    pickerView === 'since_start' ? 'Since start' : pickerView === 'year' ? String(period.year) : `${monthName} ${period.year}`

  const tabs = [
    {
      key: 'plans',
      label: (
        <>
          Plans
          {waiting > 0 && (
            <span className="mp-badge tnum" aria-label={`${waiting} waiting`}>{waiting}</span>
          )}
        </>
      ),
    },
    { key: 'pip', label: 'PIP vs Achieved' },
  ]

  return (
    <div className="mp-page">
      <PageHead
        eyebrow="Month-end"
        title="Monthly Plan"
        actions={
          <div className="mp-head-right">
            <MonthPicker
              label={pickerLabel}
              disabled={pickerView === 'since_start'}
              onStep={step}
              sub={
                pickerView === 'month' && data?.day_of_month != null
                  ? `Day ${data.day_of_month} of ${data.days_in_month} · ${
                      data.revision_window_open ? 'revisions until day 15' : 'revisions closed'
                    }`
                  : null
              }
            />
            {onPip && <SegmentedControl options={VIEWS} value={view} onChange={setView} label="Period" />}
            <button type="button" className="btn btn-sm" onClick={exportExcel}>
              <Download size={14} /> Export Excel
            </button>
          </div>
        }
      />

      <div className="mp-tabrow">
        <Tabs tabs={tabs} value={tab} onChange={selectTab} label="Monthly plan views" className="mp-tabs" />
        {onPip && <SegmentedControl options={STREAM_OPTIONS} value={pipStream.key} onChange={selectStream} label="Stream" />}
      </div>

      {onPip ? (
        <PipTab
          data={overview.data}
          failed={overview.failed}
          meta={pipStream}
          view={view}
          period={pipPeriod}
          canSetTarget={canSetTarget}
          canSeeInternal={canSeeInternal}
          onTargetSaved={overview.reload}
          onOpen={setDrawer}
        />
      ) : (
        <PlansTab
          board={board}
          period={plansPeriod}
          runningMonthName={
            board.planning?.DT?.current_month?.shamsi_month_name || (running ? shamsiMonthName(running.month) : '')
          }
          canDecide={canDecide}
          canSeeInternal={canSeeInternal}
          onDecided={board.reload}
        />
      )}

      {drawer && (
        <DecisionDrawer
          target={drawer}
          canDecide={canDecide}
          onClose={() => setDrawer(null)}
          onDecided={reloadAll}
        />
      )}
    </div>
  )
}

function MonthPicker({ label, sub, disabled, onStep }) {
  return (
    <div className="mp-picker">
      <div className="row" style={{ gap: 4 }}>
        <button type="button" className="btn btn-ghost btn-sm" aria-label="Previous" disabled={disabled} onClick={() => onStep(-1)}>
          <ChevronLeft size={15} />
        </button>
        <span className="mp-picker-label" data-testid="mp-period">{label}</span>
        <button type="button" className="btn btn-ghost btn-sm" aria-label="Next" disabled={disabled} onClick={() => onStep(1)}>
          <ChevronRight size={15} />
        </button>
      </div>
      {sub && <div className="mp-picker-sub">{sub}</div>}
    </div>
  )
}

const monthOf = (t) => (t ? { year: t.year, month: t.month } : null)

/** The month (and plan) an Action Center link points at, or null. */
function linkedTarget(params) {
  const year = Number(params.get('year'))
  const month = Number(params.get('month'))
  if (!year || !month || month < 1 || month > 12) return null
  const contractorId = Number(params.get('contractor')) || null
  const stream = params.get('stream')
  return {
    year,
    month,
    contractorId,
    stream: stream === 'ACCEPTANCE' ? 'ACCEPTANCE' : 'DT',
    name: '',
  }
}
