import { motion } from 'framer-motion'
import { Radio, ClipboardCheck, GitCompare, ClipboardList, Bell, Check, ChevronRight, MapPin, Wrench } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { EmptyState, Loading, PageHead, fadeUp, stagger } from '../components/ui'

// One entry per category: icon, accent color, and a human section title.
// Adding a new category here is the only frontend change needed when the
// backend rule registry (services/action_center.py) gains a new source.
const CATEGORY_META = {
  drive_test: { label: 'Drive Test', icon: Radio, color: 'var(--signal)' },
  assignment: { label: 'Assignment', icon: ClipboardCheck, color: 'var(--violet, var(--signal-strong))' },
  cpm: { label: 'CPM Validation', icon: GitCompare, color: 'var(--amber)' },
  health_check: { label: 'Health Check', icon: ClipboardList, color: 'var(--green)' },
  event: { label: 'Updates', icon: Bell, color: 'var(--text-dim)' },
}
const CATEGORY_ORDER = ['cpm', 'drive_test', 'health_check', 'assignment', 'event']

export default function ActionCenter() {
  const [items, setItems] = useState(null)
  const [busy, setBusy] = useState(null)
  const navigate = useNavigate()

  const [counters, setCounters] = useState([])

  function load() {
    api
      .get('/action-center/summary')
      .then((r) => {
        setCounters(r.data.counters || [])
        setItems(r.data.items || [])
      })
      .catch(() => {
        setCounters([])
        setItems([])
      })
  }
  useEffect(load, [])

  async function dismiss(item, e) {
    e.stopPropagation()
    const notifId = item.id.split(':')[1]
    setBusy(item.id)
    try {
      await api.post(`/notifications/${notifId}/read`)
      setItems((cur) => cur.filter((i) => i.id !== item.id))
    } finally {
      setBusy(null)
    }
  }

  if (!items) return <Loading label="Loading your actions" />

  const groups = CATEGORY_ORDER
    .map((category) => ({ category, rows: items.filter((i) => i.category === category) }))
    .filter((g) => g.rows.length > 0)

  return (
    <>
      <PageHead
        eyebrow="My work"
        title="Action Center"
        subtitle="What needs you now. Every number is counted from live state and clears itself the moment the work is done."
      />

      {/* Counters first, and outside the empty branch: a queue can be a
          standing workload rather than a to-do list — a contractor holding
          forty assigned sites has no item rows to clear, and was told they
          were all caught up while the number sat unrendered. */}
      {counters.length > 0 && (
        <motion.div
          className="grid grid-kpi"
          style={{ marginBottom: 24 }}
          variants={stagger}
          initial="hidden"
          animate="show"
        >
          {counters.map((c) => (
            <QueueCounter
              key={c.key}
              counter={c}
              onOpen={() => navigate(c.url)}
            />
          ))}
        </motion.div>
      )}

      {groups.length === 0 ? (
        <div className="card"><EmptyState title="You're all caught up" hint="Nothing pending right now." /></div>
      ) : (
        <motion.div style={{ display: 'flex', flexDirection: 'column', gap: 22 }} variants={stagger} initial="hidden" animate="show">
          {groups.map(({ category, rows }) => {
            const meta = CATEGORY_META[category]
            return (
              <div key={category}>
                <div className="row" style={{ gap: 8, marginBottom: 10, color: 'var(--text-dim)', fontSize: 12.5, fontWeight: 600, textTransform: 'uppercase', letterSpacing: 0.4 }}>
                  <meta.icon size={14} style={{ color: meta.color }} />
                  {meta.label}
                  <span style={{ color: meta.color }}>{rows.length}</span>
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {rows.map((item) => (
                    <motion.div
                      key={item.id}
                      className="card card-pad row between"
                      variants={fadeUp}
                      whileHover={{ y: -2 }}
                      onClick={() => navigate(item.url)}
                      style={{ cursor: 'pointer', borderLeft: `3px solid ${meta.color}` }}
                    >
                      <div>
                        <div style={{ fontWeight: 500 }}>{item.label}</div>
                        {item.subtitle && <small className="dim">{item.subtitle}</small>}
                      </div>
                      <div className="row" style={{ gap: 10 }}>
                        {item.source === 'event' && (
                          <button
                            className="btn btn-sm btn-ghost"
                            disabled={busy === item.id}
                            onClick={(e) => dismiss(item, e)}
                          >
                            <Check size={14} /> Mark handled
                          </button>
                        )}
                        <ChevronRight size={15} style={{ color: 'var(--text-dim)' }} />
                      </div>
                    </motion.div>
                  ))}
                </div>
              </div>
            )
          })}
        </motion.div>
      )}
    </>
  )
}

// One queue, its size, and where the number leads.
//
// The counters are the page. A flat list of every item answered "what needs me
// now" badly at scale: thirty-seven review rows filled the screen before the
// second category appeared, so the question the page exists to answer took
// scrolling to answer. The items are still below, behind the numbers.
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
  cpm: { icon: GitCompare, color: 'var(--amber)' },
}

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
