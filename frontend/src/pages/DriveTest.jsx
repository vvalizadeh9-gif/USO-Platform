import { Eye, Radio, Timer } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client'
import PageFrame from '../components/PageFrame'
import ProcessStepper from '../components/ProcessStepper'
import { PageBar, Tabs } from '../components/ui'
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

  const tabs = TABS.map((t) => ({ ...t, count: counts[t.count] }))

  return (
    <PageFrame
      className="dtq-page"
      bar={
        <PageBar
          eyebrow="Drive Test"
          title="Drive Test"
          context={<ProcessStepper current="dt" />}
          tabs={<Tabs steps label="Drive test queues" tabs={tabs} value={tab} onChange={setTab} />}
        />
      }
    >
      {/* Opacity only, no exit: the old panel is gone the moment the new
          one mounts, so the page never collapses between them. */}
      <div key={tab} className="tab-panel">
          {tab === 'assignment' && <DtAssignmentTab onCountChange={setCount('dt_assignment')} />}
          {tab === 'in-progress' && <DtInProgressTab onCountChange={setCount('dt_in_progress')} />}
          {tab === 'review' && <DtReviewTab onCountChange={setCount('dt_review')} />}
      </div>
    </PageFrame>
  )
}
