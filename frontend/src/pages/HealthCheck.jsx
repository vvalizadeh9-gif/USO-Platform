import { AnimatePresence, motion } from 'framer-motion'
import {
  ChevronRight,
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
import LifecycleStrip from '../components/LifecycleStrip'
import { PageHead } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { canReview } from '../lib/roles'
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
const STEPS = [
  { key: 'pool', label: 'HC Pool', icon: ClipboardList, count: 'pool' },
  { key: 'running', label: 'In Progress', icon: Timer, count: 'in_progress' },
  { key: 'review', label: 'HC Review', icon: ListChecks, count: 'hc_review' },
]

// A fix is opened against a category, the owning team closes it, and the site
// returns to the pool by itself at the next round. Neither queue follows the
// other, so there is no chevron between them -- they are one loop.
const FIX_LOOP = [
  { key: 'remediation', label: 'Remediation', icon: Wrench, count: 'remediation' },
  { key: 'reroutes', label: 'Re-routes', icon: Shuffle, count: 'reroutes' },
]

const ARCHIVE = { key: 'history', label: 'History', icon: History }

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
  const setCount = useCallback(
    (key) => (value) => setCounts((c) => ({ ...c, [key]: value })),
    [],
  )

  // After every hook, so the hook order is the same on the render that
  // redirects as on the one that does not. `replace` because the old URL is
  // not somewhere Back should return to.
  if (movedTo) {
    const params = new URLSearchParams(searchParams)
    params.set('tab', movedTo)
    return <Navigate replace to={`/drive-test?${params.toString()}`} />
  }

  return (
    <>
      <PageHead
        eyebrow="Drive Test Project"
        title="Health Check"
        subtitle="Everything about the health check: assign it, follow it, confirm Ready sites, route problems to the right team, and look back in History."
      />

      <LifecycleStrip current="hc" />

      <div className="tabs tabs-steps" style={{ flexWrap: 'wrap' }}>
        {STEPS.map((t, i) => (
          <div className="tab-step" key={t.key}>
            {i > 0 && <ChevronRight size={14} className="tab-sep" aria-hidden="true" />}
            <TabButton t={t} counts={counts} tab={tab} setTab={setTab} />
          </div>
        ))}

        <div className="tab-step">
          <ChevronRight size={14} className="tab-sep" aria-hidden="true" />
          <div className="tab-group">
            <span
              className="tab-group-label"
              title="Fixed sites return to the HC Pool automatically"
            >
              <RotateCcw size={12} /> Fix loop
            </span>
            {FIX_LOOP.map((t) => (
              <TabButton key={t.key} t={t} counts={counts} tab={tab} setTab={setTab} />
            ))}
          </div>
        </div>

        <div className="tab-end">
          <TabButton t={ARCHIVE} counts={counts} tab={tab} setTab={setTab} />
        </div>
      </div>

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {tab === 'pool' && <HcBasketTab onCountChange={setCount('pool')} />}
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
        </motion.div>
      </AnimatePresence>
    </>
  )
}

/** One tab. Unchanged markup: the row around it is what became ordered. */
function TabButton({ t, counts, tab, setTab }) {
  const count = t.count ? counts[t.count] : undefined
  const isActive = tab === t.key
  return (
    <button
      className={`tab ${isActive ? 'active' : ''}`}
      onClick={() => setTab(t.key)}
    >
      <span className="row" style={{ gap: 8 }}>
        <t.icon size={15} /> {t.label}
        {count > 0 && (
          <span className={`badge tnum ${isActive ? 'badge-active' : ''}`}>{count}</span>
        )}
      </span>
    </button>
  )
}
