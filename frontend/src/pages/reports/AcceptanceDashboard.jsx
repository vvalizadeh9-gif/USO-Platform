import { useCallback, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import PageFrame from '../../components/PageFrame'
import { PageBar, Tabs } from '../../components/ui'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
import DashboardActions from '../drivetest/Toolbar'
import { AcceptanceDrillProvider } from './AcceptanceDrillPanel'
import KpiBand from './acceptance/KpiBand'
import MonthPanel from './acceptance/MonthPanel'
import ProgressChart from './acceptance/ProgressChart'
import ScopePicker from './acceptance/ScopePicker'
import { STREAMS, monthKey } from './acceptance/model'
import useAcceptanceData from './acceptance/useAcceptanceData'

const TABS = STREAMS.map((s) => ({ key: s.key, label: s.label }))
const TAB_KEYS = new Set(TABS.map((t) => t.key))

/**
 * Acceptance → Dashboard: am I on plan month by month, and what happened in
 * a given month?
 *
 * Three streams, one tab each -- Village (fully accepted: ICT and CRA),
 * ICT, CRA -- each with the same three parts: the KPI band, the progress
 * chart against both plans (Internal PIP and Contractor PIP), and the month
 * panel beside it. Two reads feed the whole page: /acceptance/overview (the
 * band) and /acceptance/progress (the chart and the panel, all three streams
 * at once, so a tab switch never refetches). Each card loads, fails and
 * retries on its own.
 *
 * One screen at 1440×900: the page never scrolls; below 1100px the panel
 * stacks under the chart. The tab (?tab=) and the month (?month=1405-07)
 * are in the address; the Monthly/Cumulative switch is shared across tabs.
 * The stream's colour is set once, on the page (`.acc-stream-*`), and every
 * part reads it.
 *
 * Per-owner and per-contractor performance is not here: that is Roles
 * Performance. Every number opens the villages behind it.
 */
export default function AcceptanceDashboard() {
  const { user } = useAuth()
  const toast = useToast()
  const isContractor = user?.role?.name === 'Contractor'
  const [params, setParams] = useSearchParams()
  const [picked, setPicked] = useState({ contractor_id: null, province_id: null })
  const [mode, setMode] = useState('monthly')
  const [exporting, setExporting] = useState(false)

  // A contractor is always its own company (the server enforces it too), so
  // the band and the chart count the same villages.
  const scope = useMemo(
    () =>
      clean(
        isContractor
          ? { contractor_id: user?.contractor_id ?? null }
          : picked,
      ),
    [isContractor, user?.contractor_id, picked],
  )
  const { overview, progress, refresh, refreshing, loadedAt } = useAcceptanceData(scope)

  const tab = TAB_KEYS.has(params.get('tab')) ? params.get('tab') : 'village'
  const month = selectedMonth(progress.data, params.get('month'))

  const setParam = useCallback(
    (name, value) => {
      const next = new URLSearchParams(params)
      next.set(name, value)
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
      tabs={<Tabs tabs={TABS} value={tab} onChange={(key) => setParam('tab', key)} label="Acceptance streams" />}
    />
  )

  return (
    <PageFrame className={`acc-page acc-stream-${tab}`} bar={bar}>
      <AcceptanceDrillProvider scope={scope}>
        <KpiBand state={overview} stream={tab} />
        <div className="accd-body">
          <ProgressChart
            state={progress}
            stream={tab}
            mode={mode}
            onMode={setMode}
            selected={month}
            onSelect={(key) => setParam('month', key)}
            isContractor={isContractor}
          />
          <MonthPanel
            state={progress}
            stream={tab}
            month={month}
            onMonth={(key) => setParam('month', key)}
            isContractor={isContractor}
          />
        </div>
      </AcceptanceDrillProvider>
    </PageFrame>
  )
}

/** The scope without its unset fields: the server reads absent as "all". */
function clean(scope) {
  return Object.fromEntries(Object.entries(scope).filter(([, v]) => v != null))
}

/** ?month= when it is in the window, else the running month. */
function selectedMonth(progress, requested) {
  const months = progress?.months ?? []
  const keys = months.map(monthKey)
  if (keys.includes(requested)) return requested
  const current = months.find((m) => m.is_current)
  return current ? monthKey(current) : keys[keys.length - 1] ?? null
}
