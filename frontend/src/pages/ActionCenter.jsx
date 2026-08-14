import { motion } from 'framer-motion'
import { Radio, ClipboardCheck, GitCompare, ClipboardList, Bell, Check, ChevronRight } from 'lucide-react'
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

  function load() {
    api.get('/action-center').then((r) => setItems(r.data)).catch(() => setItems([]))
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
        subtitle="Everything that needs your attention right now, derived from live state — clears itself as things get handled."
      />

      {groups.length === 0 ? (
        <div className="card"><EmptyState title="You're all caught up" hint="Nothing pending right now." /></div>
      ) : (
        <>
          <motion.div
            className="grid grid-kpi"
            style={{ marginBottom: 24 }}
            variants={stagger}
            initial="hidden"
            animate="show"
          >
            {groups.map(({ category, rows }) => (
              <CategoryKpiCard
                key={category}
                meta={CATEGORY_META[category]}
                count={rows.length}
                onOpen={() => navigate(rows[0].url)}
              />
            ))}
          </motion.div>

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
        </>
      )}
    </>
  )
}

function CategoryKpiCard({ meta, count, onOpen }) {
  return (
    <motion.div
      className="stat"
      variants={fadeUp}
      style={{ '--accent-glow': meta.color, cursor: 'pointer' }}
      whileHover={{ y: -3 }}
      transition={{ type: 'spring', stiffness: 300, damping: 20 }}
      onClick={onOpen}
    >
      <div className="label"><meta.icon size={15} strokeWidth={2} style={{ color: meta.color }} /> {meta.label}</div>
      <div className="value tnum">{count}</div>
    </motion.div>
  )
}
