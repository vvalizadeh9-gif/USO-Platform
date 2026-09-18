import { AnimatePresence, motion } from 'framer-motion'
import { ChevronRight, Eye, Radio, Timer } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client'
import LifecycleStrip from '../components/LifecycleStrip'
import { PageHead } from '../components/ui'
import { useAuth } from '../context/AuthContext'
import { canReview } from '../lib/roles'
import DtAssignmentTab from './drivetest/DtAssignmentTab'
import DtInProgressTab from './drivetest/DtInProgressTab'
import DtReviewTab from './drivetest/DtReviewTab'

// The drive test half of the lifecycle, which used to live as two tabs at the
// far end of the Health Check row. It is a separate process with its own
// contractor relationship and its own end state, and reading it off the end of
// a health-check tab row made it look like a seventh health-check step.
//
// Same shape as Health Check: each tab is a queue, and the badge is the count
// of things waiting on a decision. `count` names the key in
// /hc/queues/counts -- the same endpoint and the same keys as before the
// move, so the numbers here are the numbers the old DT tabs showed.
const TABS = [
  { key: 'assignment', label: 'Assignment', icon: Radio, count: 'dt_assignment' },
  { key: 'in-progress', label: 'In Progress', icon: Timer, count: 'dt_in_progress' },
  { key: 'review', label: 'Review', icon: Eye, count: 'dt_review' },
]

export default function DriveTest() {
  const { user } = useAuth()
  const mayReview = canReview(user)
  const [searchParams] = useSearchParams()

  const [tab, setTab] = useState(searchParams.get('tab') || 'assignment')
  const [counts, setCounts] = useState({})

  const loadCounts = useCallback(() => {
    if (!mayReview) return
    api
      .get('/hc/queues/counts')
      .then((r) => setCounts(r.data))
      .catch(() => {})
  }, [mayReview])

  // Refreshed on every tab change, as on Health Check: acting on one queue
  // usually moves an item into another, and a badge that still shows the
  // pre-action number teaches people to stop trusting the badges.
  useEffect(loadCounts, [loadCounts, tab])

  const setCount = useCallback(
    (key) => (value) => setCounts((c) => ({ ...c, [key]: value })),
    [],
  )

  return (
    <>
      <PageHead
        eyebrow="Drive Test Project"
        title="Drive Test"
        subtitle="Sites confirmed Ready: assign them, follow the contractor’s progress, and review each submission. An approved drive test is final."
      />

      <LifecycleStrip current="dt" />

      <div className="tabs tabs-steps" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t, i) => {
          const count = t.count ? counts[t.count] : undefined
          return (
            <div className="tab-step" key={t.key}>
              {i > 0 && <ChevronRight size={14} className="tab-sep" aria-hidden="true" />}
              <button
                className={`tab ${tab === t.key ? 'active' : ''}`}
                onClick={() => setTab(t.key)}
              >
                <span className="row" style={{ gap: 8 }}>
                  <t.icon size={15} /> {t.label}
                  {count > 0 && <span className="badge tnum">{count}</span>}
                </span>
              </button>
            </div>
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
          {tab === 'assignment' && <DtAssignmentTab onCountChange={setCount('dt_assignment')} />}
          {tab === 'in-progress' && <DtInProgressTab onCountChange={setCount('dt_in_progress')} />}
          {tab === 'review' && <DtReviewTab onCountChange={setCount('dt_review')} />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}
