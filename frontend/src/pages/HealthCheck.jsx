import { AnimatePresence, motion } from 'framer-motion'
import {
  ClipboardList,
  History,
  ListChecks,
  Radio,
  Shuffle,
  Timer,
  Wrench,
} from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client'
import { PageHead } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { canReview } from '../lib/roles'
import HcBasketTab from './healthcheck/HcBasketTab'
import HcInProgressTab from './healthcheck/HcInProgressTab'
import HcResultsTab from './healthcheck/HcResultsTab'
import HcHistoryTab from './healthcheck/HcHistoryTab'
import RemediationTab from './healthcheck/RemediationTab'
import ReroutesTab from './healthcheck/ReroutesTab'
import DtAssignmentTab from './healthcheck/DtAssignmentTab'
import DtReviewTab from './healthcheck/DtReviewTab'

// The tabs are the lifecycle, in order, and each one is a queue. The badge is
// the count of things that need a decision, so a tab with no badge is finished
// work — the Active Queue Principle made visible in the chrome rather than
// explained in a tooltip.
//
// `count` names the key in /hc/queues/counts. History has none: it is the
// archive, and a number on it would be a number that never goes down.
const TABS = [
  { key: 'pool', label: 'HC Pool', icon: ClipboardList, count: 'pool' },
  { key: 'running', label: 'In Progress', icon: Timer, count: 'in_progress' },
  { key: 'review', label: 'HC Review', icon: ListChecks, count: 'hc_review' },
  { key: 'remediation', label: 'Remediation', icon: Wrench, count: 'remediation' },
  { key: 'reroutes', label: 'Re-routes', icon: Shuffle, count: 'reroutes' },
  { key: 'dt-assign', label: 'DT Assignment', icon: Radio, count: 'dt_assignment' },
  { key: 'dt-review', label: 'DT Review', icon: History, count: 'dt_review' },
  { key: 'history', label: 'History', icon: History },
]

// Superseded tab keys, kept so links people already hold keep working.
// ?tab=results was the combined queue-and-archive table; the queue half of it
// is now Review.
const LEGACY_TABS = { basket: 'pool', results: 'review' }

export default function HealthCheck() {
  const { user } = useAuth()
  const mayReview = canReview(user)
  const [searchParams] = useSearchParams()

  const requested = searchParams.get('tab')
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

  return (
    <>
      <PageHead
        eyebrow="Health Check"
        title="Health Check"
        subtitle="On-air sites from the pool through remediation to a completed drive test. Each tab holds only what still needs a decision."
      />

      <div className="tabs" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t) => {
          const count = t.count ? counts[t.count] : undefined
          return (
            <button
              key={t.key}
              className={`tab ${tab === t.key ? 'active' : ''}`}
              onClick={() => setTab(t.key)}
            >
              <span className="row" style={{ gap: 8 }}>
                <t.icon size={15} /> {t.label}
                {count > 0 && <span className="badge tnum">{count}</span>}
              </span>
            </button>
          )
        })}
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
          {tab === 'dt-assign' && <DtAssignmentTab onCountChange={setCount('dt_assignment')} />}
          {tab === 'dt-review' && <DtReviewTab onCountChange={setCount('dt_review')} />}
          {tab === 'history' && <HcHistoryTab />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}
