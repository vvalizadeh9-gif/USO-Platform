import { motion } from 'framer-motion'
import { Check, X, Archive, ArrowRightLeft, MapPinned, Radio } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { EmptyState, Loading } from '../../components/ui'

// Friendly label + icon per tracked change type.
const CHANGE_META = {
  site_type: { label: 'Site type change', icon: ArrowRightLeft, color: 'var(--amber)' },
  village_qty: { label: 'Village quantity change', icon: MapPinned, color: 'var(--signal-strong)' },
  requested_tech: { label: 'Requested technology change', icon: Radio, color: 'var(--violet, var(--signal-strong))' },
  field: { label: 'Field change', icon: ArrowRightLeft, color: 'var(--text-muted)' },
}

export default function ValidateCpmTab({ onDecided, highlightId }) {
  const toast = useToast()
  const [items, setItems] = useState(null)
  const highlightRef = useRef(null)

  function load() {
    api.get('/admin/cpm/change-requests').then((r) => setItems(r.data)).catch(() => setItems([]))
  }
  useEffect(load, [])

  // Deep-linked from Action Center — scroll the target row into view once
  // the list has loaded.
  useEffect(() => {
    if (highlightId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightId, items])

  async function decide(id, decision) {
    try {
      await api.post(`/admin/cpm/change-requests/${id}/decide`, { decision })
      toast.success(`Change ${decision.toLowerCase()}`)
      load()
      onDecided?.()
    } catch (err) {
      toast.error('Action failed', err.response?.data?.detail || 'Please try again.')
    }
  }

  if (!items) return <Loading label="Loading change requests" />

  if (items.length === 0) {
    return (
      <div className="card">
        <EmptyState
          title="No pending changes"
          hint="Only three change types need validation: site type, village quantity, and requested technology. They appear here after a monthly re-import."
        />
      </div>
    )
  }

  return (
    <div>
      <p className="muted mb-16" style={{ fontSize: 13, lineHeight: 1.6 }}>
        {items.length} change{items.length === 1 ? '' : 's'} on existing sites need your validation.
        These are <b>blocked</b> until you decide. Accept applies the change; Ignore keeps the current
        data; Archive sets it aside. All other CPM fields update automatically and don't appear here.
      </p>

      <div className="grid" style={{ gap: 10 }}>
        {items.map((cr, i) => {
          const meta = CHANGE_META[cr.change_type] || CHANGE_META.field
          const Icon = meta.icon
          const isHighlighted = String(cr.id) === String(highlightId)
          return (
            <motion.div
              key={cr.id}
              ref={isHighlighted ? highlightRef : null}
              className="card card-pad"
              initial={{ opacity: 0, y: 8 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: Math.min(i * 0.03, 0.3) }}
              style={isHighlighted ? { borderColor: 'var(--signal)', borderWidth: 1.5 } : undefined}
            >
              <div className="row between wrap" style={{ gap: 14 }}>
                <div style={{ minWidth: 220, flex: 1 }}>
                  <div className="row" style={{ gap: 8 }}>
                    <span className="text-data" style={{ fontWeight: 600 }}>{cr.site_code}</span>
                    <span className="row pill" style={{ gap: 5, background: 'var(--surface-2)', color: meta.color }}>
                      <Icon size={12} /> {meta.label}
                    </span>
                  </div>
                  {cr.change_type === 'village_qty' ? (
                    <VillageChanges cr={cr} />
                  ) : (cr.old_value || cr.new_value) ? (
                    <div className="row wrap mt-8" style={{ gap: 10, fontSize: 13, alignItems: 'center' }}>
                      <span className="pill pill-red" style={{ textDecoration: 'line-through' }}>{cr.old_value || '—'}</span>
                      <span className="dim">→</span>
                      <span className="pill pill-green">{cr.new_value || '—'}</span>
                    </div>
                  ) : cr.detail ? (
                    <p className="muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>{cr.detail}</p>
                  ) : null}
                </div>
                <div className="row" style={{ gap: 6 }}>
                  <button className="btn btn-sm btn-primary" onClick={() => decide(cr.id, 'Accepted')}>
                    <Check size={14} /> Accept
                  </button>
                  <button className="btn btn-sm" onClick={() => decide(cr.id, 'Ignored')}>
                    <X size={14} /> Ignore
                  </button>
                  <button className="btn btn-sm btn-ghost" onClick={() => decide(cr.id, 'Archived')}>
                    <Archive size={14} /> Archive
                  </button>
                </div>
              </div>
            </motion.div>
          )
        })}
      </div>
    </div>
  )
}

function VillageChanges({ cr }) {
  let added = []
  let removed = []
  try {
    const p = JSON.parse(cr.payload_json || '{}')
    added = p.added || []
    removed = p.removed || []
  } catch {
    return cr.detail ? (
      <p className="muted" style={{ fontSize: 13, marginTop: 8, lineHeight: 1.5 }}>{cr.detail}</p>
    ) : null
  }
  return (
    <div className="row wrap mt-8" style={{ gap: 6, fontSize: 12.5, alignItems: 'center' }}>
      {added.map((v) => (
        <span key={`a-${v.village_code}`} className="pill pill-green" title={v.village_name || ''}>
          + {v.village_code || '?'}{v.village_name ? ` · ${v.village_name}` : ''}
        </span>
      ))}
      {removed.map((code) => (
        <span key={`r-${code}`} className="pill pill-red" style={{ textDecoration: 'line-through' }}>
          − {code}
        </span>
      ))}
      {added.length === 0 && removed.length === 0 && (
        <span className="dim">No village-level detail.</span>
      )}
    </div>
  )
}
