import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import { CardBoundary } from '../../components/ErrorBoundary'
import PageFrame from '../../components/PageFrame'
import { PageBar, Tabs } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
import { currentShamsiPeriod } from '../../lib/shamsi'
import DashboardActions from '../drivetest/Toolbar'
import { AcceptanceDrillProvider } from './AcceptanceDrillPanel'
import KpiBand from './acceptance/KpiBand'
import PipCard from './acceptance/PipCard'
import ProgressChart from './acceptance/ProgressChart'
import ScopePicker from './acceptance/ScopePicker'
import { STREAMS, selectedMonth } from './acceptance/model'
import useAcceptanceData from './acceptance/useAcceptanceData'

/** A tab's 8px authority dot, drawn where the tab puts its icon. */
const dot = (color) =>
  function StreamDot() {
    return <i className="acc-tab-dot" style={{ background: color }} aria-hidden="true" />
  }
const TABS = STREAMS.map((s) => ({ key: s.key, label: s.label, icon: s.dot ? dot(s.dot) : undefined }))
const TAB_KEYS = new Set(TABS.map((t) => t.key))

/**
 * Acceptance → Dashboard: am I on plan this month, and this year?
 *
 * The Drive test dashboard's look (UEP-07). Three streams, one tab each --
 * Fully accepted (ICT and CRA), ICT, CRA -- each with the same three parts:
 * the KPI strip, one Shamsi year's approvals against both plans (Internal
 * PIP and Contractor PIP), and the PIP card for one month beside it. Two
 * reads feed the page: /acceptance/overview (the strip) and
 * /acceptance/progress?year= (the chart and the card, all three streams at
 * once, so a tab switch never refetches). Each card loads, fails and
 * retries on its own.
 *
 * One screen at 1440×900: the page never scrolls. The tab (?tab=), the year
 * (?year=1405, default the current one) and the month (?month=1405-07) are
 * in the address. Every number opens the villages behind it.
 */
export default function AcceptanceDashboard() {
  const { user } = useAuth()
  const toast = useToast()
  const isContractor = user?.role?.name === 'Contractor'
  const [params, setParams] = useSearchParams()
  const [picked, setPicked] = useState({ contractor_id: null, province_id: null })
  const [exporting, setExporting] = useState(false)

  // A contractor is always its own company (the server enforces it too), so
  // the strip and the chart count the same villages.
  const scope = useMemo(
    () =>
      clean(
        isContractor
          ? { contractor_id: user?.contractor_id ?? null }
          : picked,
      ),
    [isContractor, user?.contractor_id, picked],
  )

  const tab = TAB_KEYS.has(params.get('tab')) ? params.get('tab') : 'village'
  const year = yearOf(params.get('year'))
  const { overview, progress, refresh, refreshing, loadedAt } = useAcceptanceData(scope, year)
  const month = selectedMonth(progress.data, params.get('month'))

  // The running month's approvals for the strip's "+n this month"; left out
  // while /progress loads or fails, and for a year that is not this one.
  const thisMonth =
    progress.loading || progress.error
      ? null
      : progress.data?.months.find((m) => m.is_current)?.[tab]?.approved ?? null

  const update = useCallback(
    (changes) => {
      const next = new URLSearchParams(params)
      for (const [name, value] of Object.entries(changes)) {
        if (value == null) next.delete(name)
        else next.set(name, value)
      }
      setParams(next)
    },
    [params, setParams],
  )

  async function exportProgress() {
    setExporting(true)
    try {
      const res = await api.get('/acceptance/progress/export', { params: scope, responseType: 'blob' })
      saveBlob(res.data, filenameFrom(res.headers, 'acceptance-progress.xlsx'))
    } catch (err) {
      toast.error('Export failed', await describeBlobError(err))
    } finally {
      setExporting(false)
    }
  }

  const bar = (
    <PageBar
      eyebrow="Acceptance"
      title="Dashboard"
      context={isContractor ? null : <ScopePicker scope={picked} onChange={setPicked} />}
      actions={
        <DashboardActions
          onRefresh={refresh}
          refreshing={refreshing}
          generatedAt={loadedAt}
          onExport={exportProgress}
          exporting={exporting}
        />
      }
      tabs={<Tabs tabs={TABS} value={tab} onChange={(key) => update({ tab: key })} label="Acceptance streams" />}
    />
  )

  return (
    <PageFrame className="dt-page acc-page" bar={bar}>
      <AcceptanceDrillProvider scope={scope}>
        <div className="dt-bench acc-bench">
          <CardBoundary title="Totals" tile="certificate--check" onRetry={refresh}>
            <KpiBand state={overview} stream={tab} thisMonth={thisMonth} />
          </CardBoundary>
          <div className="dt-grid2 acc-grid">
            <ProgressChart
              state={progress}
              stream={tab}
              year={year ?? progress.data?.today?.shamsi_year ?? null}
              years={progress.data?.years}
              // A new year opens on its own default month.
              onYear={(y) => update({ year: y, month: null })}
              selected={month}
              onSelect={(key) => update({ month: key })}
              isContractor={isContractor}
            />
            <div className="dt-stack">
              <PipCard
                state={progress}
                stream={tab}
                month={month}
                onMonth={(key) => update({ month: key })}
                isContractor={isContractor}
              />
            </div>
          </div>
        </div>
      </AcceptanceDrillProvider>
    </PageFrame>
  )
}

/** The scope without its unset fields: the server reads absent as "all". */
function clean(scope) {
  return Object.fromEntries(Object.entries(scope).filter(([, v]) => v != null))
}

/** ?year= when it is a plausible Shamsi year, else the current one; null when
 * the runtime cannot tell (the server then sends its default window). */
function yearOf(requested) {
  const value = Number(requested)
  if (Number.isInteger(value) && value >= 1300 && value <= 1500) return value
  return currentShamsiPeriod()?.year ?? null
}
