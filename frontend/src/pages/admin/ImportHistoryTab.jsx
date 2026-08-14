import { motion } from 'framer-motion'
import { History } from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState } from '../../components/ui'
import { formatDateTime } from '../../lib/auditLog'

export default function ImportHistoryTab() {
  const [history, setHistory] = useState(null)

  useEffect(() => {
    api
      .get('/admin/cpm/import-history')
      .then((r) => setHistory(r.data))
      .catch(() => setHistory([]))
  }, [])

  return (
    <div className="card">
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <History size={16} style={{ color: 'var(--text-muted)' }} />
          <h3 style={{ fontSize: 15 }}>Import history</h3>
        </div>
      </div>
      <HistoryList history={history} />
    </div>
  )
}

function HistoryList({ history }) {
  if (history === null) {
    return <div style={{ padding: '0 20px 20px' }} className="dim">Loading…</div>
  }
  if (history.length === 0) {
    return <div style={{ padding: '0 10px 10px' }}><EmptyState title="No imports yet" hint="Upload a CPM file in the CPM Import tab to see it here." /></div>
  }
  return (
    <div style={{ padding: '0 20px 20px' }}>
      {history.map((h, i) => (
        <motion.div
          key={h.id}
          initial={{ opacity: 0, x: 10 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ delay: Math.min(i * 0.03, 0.3) }}
          style={{
            padding: '12px 0',
            borderBottom: i < history.length - 1 ? '1px solid var(--border-soft)' : 'none',
          }}
        >
          <div className="row between">
            <span style={{ fontWeight: 500, fontSize: 13.5 }} className="text-data">{h.filename}</span>
          </div>
          <div className="dim" style={{ fontSize: 12, marginTop: 2 }}>
            {formatDateTime(h.created_at)}
          </div>
          <div className="row wrap" style={{ gap: 6, marginTop: 8 }}>
            <span className="pill pill-green">{h.new_count} new</span>
            {h.new_villages_count > 0 && <span className="pill pill-green">{h.new_villages_count} villages</span>}
            {h.changed_count > 0 && <span className="pill pill-amber">{h.changed_count} changed</span>}
            {h.changed_village_qty > 0 && <span className="pill pill-amber">{h.changed_village_qty} village qty</span>}
            {h.changed_site_type > 0 && <span className="pill pill-amber">{h.changed_site_type} site type</span>}
            {h.changed_requested_tech > 0 && <span className="pill pill-amber">{h.changed_requested_tech} tech</span>}
            <span className="pill pill-dim">{h.unchanged_count} unchanged</span>
            {h.skipped_satellite > 0 && <span className="pill pill-dim">{h.skipped_satellite} skipped</span>}
          </div>
        </motion.div>
      ))}
    </div>
  )
}
