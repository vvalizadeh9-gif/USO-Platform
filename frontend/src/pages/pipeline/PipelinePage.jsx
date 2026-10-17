import { useCallback, useEffect, useRef, useState } from 'react'
import { Navigate, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import { useFillPage } from '../../components/pageMode'
import { SegmentedControl } from '../../components/ui'
import PageHeading from '../../components/work/PageHeading'
import PipelineStrip from '../../components/work/PipelineStrip'
import RecentActions from '../../components/work/RecentActions'
import { ActionNotice } from '../../components/work/parts'
import { WorkProvider, useWork } from '../../components/work/WorkContext'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { downloadCsv } from '../../lib/csv'
import { describeBlobError, saveBlob } from '../../lib/download'
import { HISTORY_TAB, PAGE_PATH, resolveTab, stepUrl, tabId } from '../../lib/pipelineSteps'
import { canReview } from '../../lib/roles'
import AppFooter from '../../shell/AppFooter'
import { useHomeData } from '../../shell/HomeData'
import HcHistoryTab from '../healthcheck/HcHistoryTab'
import AssignStep from './AssignStep'
import DtReviewStep from './DtReviewStep'
import HcReviewStep from './HcReviewStep'
import HeldStep from './HeldStep'
import { DoneStep, RemediationStep, ReroutesStep, SentBackStep } from './LoopSteps'
import '../../styles/home.css'
import '../../styles/work.css'

const PANEL_ID = 'pipeline-panel'

/** The steps whose list card carries its own confirmation (the assign panel). */
const HAS_PANEL = new Set(['hc1', 'dt4'])

/** Views with no list of sites to download. */
const NO_EXPORT = new Set(['done', 'reroutes'])

const STEP_VIEWS = {
  hc1: (p) => <AssignStep process="hc" {...p} />,
  hc2: (p) => <HeldStep process="hc" {...p} />,
  hc3: (p) => <HcReviewStep {...p} />,
  dt4: (p) => <AssignStep process="dt" {...p} />,
  dt5: (p) => <HeldStep process="dt" {...p} />,
  dt6: (p) => <DtReviewStep {...p} />,
  done: (p) => <DoneStep {...p} />,
  remediation: (p) => <RemediationStep {...p} />,
  reroutes: (p) => <ReroutesStep {...p} />,
  sent_back: (p) => <SentBackStep {...p} />,
}

/** The strip's figures, read again after every action. */
function useSummary(enabled) {
  const { version } = useWork()
  const [summary, setSummary] = useState(null)
  useEffect(() => {
    if (!enabled) {
      setSummary({})
      return undefined
    }
    let live = true
    api
      .get('/drive-test/pipeline/summary')
      .then((r) => live && setSummary(r.data))
      .catch(() => live && setSummary({}))
    return () => {
      live = false
    }
  }, [enabled, version])
  return summary
}

/**
 * The Health check and Drive test work pages (UEP-06): one pipeline, two
 * pages. The heading, the strip, the current step's list, then Home's footer,
 * in Home's frame. The step is the URL's `?tab=`; see lib/pipelineSteps.js.
 *
 * @param {{ page: 'hc' | 'dt' }} props
 */
export default function PipelinePage({ page }) {
  useFillPage()
  const [params] = useSearchParams()
  const resolved = resolveTab(page, params.get('tab'), params)
  // `replace`: the old URL is not somewhere Back should return to.
  if (resolved.redirect) return <Navigate replace to={resolved.redirect} />
  return (
    <WorkProvider>
      <PipelineView page={page} resolved={resolved} highlightTaskId={params.get('task')} />
    </WorkProvider>
  )
}

function PipelineView({ page, resolved, highlightTaskId }) {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const location = useLocation()
  const { headingRef, clearNotice } = useWork()
  const { data: home, error: homeError, counts } = useHomeData()
  const summary = useSummary(canReview(user))
  const exportRef = useRef(null)
  const [exporting, setExporting] = useState(false)
  const [archive, setArchive] = useState(false)

  const step = resolved.history ? null : resolved.step
  const figures = step ? summary?.[step.key] : null

  // Leaving a step clears the on-screen confirmation, so a message never
  // stays over content it no longer describes (Undo stays in History).
  const stepKey = step?.key ?? HISTORY_TAB
  useEffect(() => {
    clearNotice()
    exportRef.current = null
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [stepKey])

  const select = useCallback(
    (next, viaKeyboard) => navigate(stepUrl(next), { state: viaKeyboard ? { focusStrip: true } : undefined }),
    [navigate],
  )
  const onExportRows = useCallback((payload) => {
    exportRef.current = payload
  }, [])

  async function exportList() {
    if (step?.key === 'hc3') {
      // The review step keeps the server's results workbook.
      setExporting(true)
      try {
        const res = await api.get('/hc/results/export', { responseType: 'blob' })
        saveBlob(res.data, 'hc_results.xlsx')
      } catch (err) {
        toast.error('Export failed', await describeBlobError(err, 'Could not generate the results file.'))
      } finally {
        setExporting(false)
      }
      return
    }
    const payload = exportRef.current
    if (!payload?.columns || !payload.rows.length) {
      toast.info('Nothing to export', 'This list has no rows to download.')
      return
    }
    downloadCsv(`${step.name.toLowerCase().replace(/\W+/g, '_')}.csv`, payload.columns, payload.rows)
  }

  const panelProps = step
    ? { id: PANEL_ID, role: 'tabpanel', 'aria-labelledby': tabId(step.key) }
    : { id: PANEL_ID, 'aria-label': 'History' }

  return (
    <div className="uep-home uw-page">
      <PageHeading
        title={step ? step.name : 'History'}
        // One count per queue (UEP-13 §3.2): the header leads with the number
        // Home and the rail show, read from the same /me/home field.
        count={counts?.[step?.queue] ?? figures?.count}
        late={figures?.late}
        headingRef={headingRef}
        historyOpen={!step}
        onHistory={() => navigate(step ? `${PAGE_PATH[page]}?tab=${HISTORY_TAB}` : PAGE_PATH[page])}
        onExport={step && !NO_EXPORT.has(step.key) ? exportList : undefined}
        exporting={exporting}
      />
      <PipelineStrip
        summary={summary}
        selected={step?.key ?? null}
        onSelect={select}
        panelId={PANEL_ID}
        focusSelected={Boolean(location.state?.focusStrip)}
      />
      <div className="uw-content">
        {step ? (
          STEP_VIEWS[step.key]({ key: step.key, step, figures, panelProps, onExport: onExportRows, highlightTaskId })
        ) : (
          <RecentActions
            panelProps={panelProps}
            extra={
              page === 'hc'
                ? {
                    tools: (
                      <SegmentedControl
                        label="History view"
                        options={[
                          { key: 'recent', label: 'Your recent actions' },
                          { key: 'archive', label: 'Health-check archive' },
                        ]}
                        value={archive ? 'archive' : 'recent'}
                        onChange={(v) => setArchive(v === 'archive')}
                      />
                    ),
                    body: archive ? <div className="uw-archive"><HcHistoryTab /></div> : undefined,
                  }
                : undefined
            }
          />
        )}
      </div>
      {step && !HAS_PANEL.has(step.key) && <ActionNotice floating />}
      <AppFooter data={home} failed={Boolean(homeError) && !home} />
    </div>
  )
}
