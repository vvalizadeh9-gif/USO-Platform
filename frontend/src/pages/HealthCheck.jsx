import {
  ClipboardList,
  History,
  ListChecks,
  RotateCcw,
  Shuffle,
  Timer,
  Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import api from '../api/client'
import PageFrame from '../components/PageFrame'
import ProcessStepper from '../components/ProcessStepper'
import { PageBar, Tabs } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { canReview } from '../lib/roles'
import useCountSetters from '../lib/useCountSetters'
import HcBasketTab from './healthcheck/HcBasketTab'
import HcInProgressTab from './healthcheck/HcInProgressTab'
import HcResultsTab from './healthcheck/HcResultsTab'
import HcHistoryTab from './healthcheck/HcHistoryTab'
import RemediationTab from './healthcheck/RemediationTab'
import ReroutesTab from './healthcheck/ReroutesTab'

// The tabs are the lifecycle, in order, and each one is a queue. The badge is
// the count of things that need a decision, so a tab with no badge is finished
// work — the Active Queue Principle made visible in the chrome rather than
// explained in a tooltip.
//
// `count` names the key in /hc/queues/counts. History has none: it is the
// archive, and a number on it would be a number that never goes down.
//
// Split into three because the row is an order, not a set of filters, and the
// three parts are ordered differently. The steps run left to right with a
// chevron between them; the fix loop is one thing with two queues; History is
// the archive and sits at the far end.
//
// A fix is opened against a category, the owning team closes it, and the site
// returns to the pool by itself at the next round. Neither queue follows the
// other, so the two sit in one group with no chevron between them -- one
// loop. `late` names the key of the In Progress tab's "N late" chip.
const TABS = [
  { key: 'pool', label: 'HC Pool', icon: ClipboardList, count: 'pool' },
  { key: 'running', label: 'In Progress', icon: Timer, count: 'in_progress', late: 'hc_in_progress_late' },
  { key: 'review', label: 'HC Review', icon: ListChecks, count: 'hc_review' },
  { key: 'remediation', label: 'Remediation', icon: Wrench, count: 'remediation', group: 'fix' },
  { key: 'reroutes', label: 'Re-routes', icon: Shuffle, count: 'reroutes', group: 'fix' },
  { key: 'history', label: 'History', icon: History, end: true },
]

const GROUPS = {
  fix: { label: 'Fix loop', icon: RotateCcw, title: 'Fixed sites return to the HC Pool automatically' },
}

// Superseded tab keys, kept so links people already hold keep working.
// ?tab=results was the combined queue-and-archive table; the queue half of it
// is now Review.
const LEGACY_TABS = { basket: 'pool', results: 'review' }

// Tabs that are no longer on this page at all: the drive test is its own
// screen now. These are not renames, so they cannot be handled by the map
// above -- the answer is a different URL, and people (and the Action Center
// URLs the server builds) hold links to the old one.
const MOVED_TO_DRIVE_TEST = { 'dt-assign': 'assignment', 'dt-review': 'review' }

export default function HealthCheck() {
  const { user } = useAuth()
  const mayReview = canReview(user)
  const [searchParams] = useSearchParams()

  const requested = searchParams.get('tab')
  const movedTo = MOVED_TO_DRIVE_TEST[requested]
  const [tab, setTab] = useState(LEGACY_TABS[requested] || requested || 'pool')
  const highlightTaskId = searchParams.get('task')
  const [counts, setCounts] = useState({})

  const loadCounts = useCallback(() => {
    if (!mayReview) return
    api
      .get('/hc/queues/counts')
      .then((r) => setCounts(r.data))
      .catch(() => {})
  }, [mayReview])

  // Refreshed on every tab change rather than only on mount: acting on one
  // queue usually moves an item into another, and a badge that still shows
  // the pre-action number teaches people to stop trusting the badges.
  useEffect(loadCounts, [loadCounts, tab])

  // A tab reporting its own size keeps the badge honest between refreshes.
  const setCount = useCountSetters(setCounts)

  // After every hook, so the hook order is the same on the render that
  // redirects as on the one that does not. `replace` because the old URL is
  // not somewhere Back should return to.
  if (movedTo) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', movedTo)
    return <Navigate replace to={`/drive-test?${params.toString()}`} />
  }

  const tabs = TABS.map((t) => ({
    ...t,
    count: t.count ? counts[t.count] : undefined,
    alert: t.late && counts[t.late] > 0 ? `${counts[t.late]} late` : undefined,
  }))

  return (
    <PageFrame
      className="hc-page"
      bar={
        <PageBar
          eyebrow="Drive Test"
          title="Health Check"
          context={<ProcessStepper current="hc" />}
          tabs={<Tabs steps label="Health check queues" tabs={tabs} groups={GROUPS} value={tab} onChange={setTab} />}
        />
      }
    >
      {/* Opacity only, no exit: the old panel is gone the moment the new
          one mounts, so the page never collapses between them. */}
      <div key={tab} className="tab-panel">
          {tab === 'pool' && (
            <HcBasketTab onCountChange={setCount('pool')} initialState={searchParams.get('state')} />
          )}
          {tab === 'running' && <HcInProgressTab onCountChange={setCount('in_progress')} />}
          {tab === 'review' && (
            <HcResultsTab
              highlightTaskId={highlightTaskId}
              onCountChange={setCount('hc_review')}
            />
          )}
          {tab === 'remediation' && <RemediationTab onCountChange={setCount('remediation')} />}
          {tab === 'reroutes' && <ReroutesTab onCountChange={setCount('reroutes')} />}
          {tab === 'history' && <HcHistoryTab />}
      </div>
    </PageFrame>
  )
}
