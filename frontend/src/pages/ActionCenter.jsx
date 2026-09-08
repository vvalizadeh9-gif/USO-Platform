import { motion } from 'framer-motion'
import { Radio, ClipboardCheck, GitCompare, ClipboardList, Bell, MapPin, Wrench, ListChecks, Undo2 } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { EmptyState, Loading, PageHead, fadeUp, stagger } from '../components/ui'

// One card per queue: icon and accent color. Adding a new counter to the
// backend registry (services/action_center.py) needs nothing here — an
// unknown key falls back to the neutral bell below.
const COUNTER_META = {
  pool: { icon: ClipboardList, color: 'var(--signal)' },
  in_progress: { icon: Radio, color: 'var(--text-dim)' },
  hc_review: { icon: ClipboardCheck, color: 'var(--green)' },
  remediation: { icon: Wrench, color: 'var(--amber)' },
  reroutes: { icon: GitCompare, color: 'var(--amber)' },
  dt_assignment: { icon: Radio, color: 'var(--violet, var(--signal-strong))' },
  dt_review: { icon: ClipboardCheck, color: 'var(--signal)' },
  hc_submit: { icon: ClipboardList, color: 'var(--signal)' },
  my_fixes: { icon: Wrench, color: 'var(--amber)' },
  assigned_sites: { icon: MapPin, color: 'var(--violet, var(--signal-strong))' },
  ready_to_assign: { icon: ListChecks, color: 'var(--signal)' },
  returned: { icon: Undo2, color: 'var(--amber)' },
  cpm: { icon: GitCompare, color: 'var(--amber)' },
}

// The counters are the page.
//
// It used to also list every pending row underneath — one card per site code.
// That answered "what needs me now" badly at scale: thirty-seven review rows
// filled the screen before the second queue appeared, so the question the page
// exists to answer took scrolling to answer, and the per-site detail was a
// worse version of the queue screen each number already links to. The numbers
// are the whole answer; the queue behind a number is one click away.
export default function ActionCenter() {
  const [counters, setCounters] = useState(null)
  const navigate = useNavigate()

  useEffect(() => {
    api
      .get('/action-center/summary')
      .then((r) => setCounters(r.data.counters || []))
      .catch(() => setCounters([]))
  }, [])

  if (!counters) return <Loading label="Loading your actions" />

  return (
    <>
      <PageHead
        eyebrow="My work"
        title="Action Center"
        subtitle="What needs you now. Every number is counted from live state and clears itself the moment the work is done."
      />

      {counters.length === 0 ? (
        <div className="card"><EmptyState title="You're all caught up" hint="Nothing pending right now." /></div>
      ) : (
        <motion.div className="grid grid-kpi" variants={stagger} initial="hidden" animate="show">
          {counters.map((c) => (
            <QueueCounter key={c.key} counter={c} onOpen={() => navigate(c.url)} />
          ))}
        </motion.div>
      )}
    </>
  )
}

// One queue, its size, and where the number leads.
function QueueCounter({ counter, onOpen }) {
  const meta = COUNTER_META[counter.key] || { icon: Bell, color: 'var(--text-dim)' }
  const Icon = meta.icon
  return (
    <motion.div
      className="stat"
      variants={fadeUp}
      style={{ '--accent-glow': meta.color, cursor: 'pointer' }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onClick={onOpen}
    >
      <div className="label">
        <Icon size={15} strokeWidth={2} style={{ color: meta.color }} /> {counter.label}
      </div>
      <div className="value tnum">{counter.count}</div>
    </motion.div>
  )
}
