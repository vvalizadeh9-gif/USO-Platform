import { Timer } from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading } from '../../components/ui'
import { useToast } from '../../context/ToastContext'

const MIN_DAYS = 1
const MAX_DAYS = 365

/**
 * How many days each Action Center queue's items may wait before they count
 * as overdue. Every queue starts at 14; a change applies on the next read of
 * every board, the sidebar badge and the next daily digest -- no deploy.
 *
 * Two queues are shown but not editable: fixes are late against their own
 * problem category's SLA (Problem Categories tab), and the monthly plan
 * against its deadline.
 */
export default function ActionSlaTab() {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    api.get('/admin/action-sla').then((r) => setRows(r.data)).catch(() => setRows([]))
  }, [])

  const changed = (rows || []).filter(
    (r) => draft[r.queue_key] !== undefined && Number(draft[r.queue_key]) !== r.sla_days,
  )
  const invalid = changed.some((r) => {
    const n = Number(draft[r.queue_key])
    return !Number.isInteger(n) || n < MIN_DAYS || n > MAX_DAYS
  })

  async function save() {
    setBusy(true)
    try {
      const r = await api.put(
        '/admin/action-sla',
        changed.map((row) => ({ queue_key: row.queue_key, sla_days: Number(draft[row.queue_key]) })),
      )
      setRows(r.data)
      setDraft({})
      toast.success('SLA saved', `${changed.length} queue${changed.length === 1 ? '' : 's'} updated.`)
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (rows === null) return <Loading label="Loading SLA settings" />
  if (rows.length === 0) {
    return <div className="card"><EmptyState title="No queues" hint="The Action Center registry is empty." /></div>
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-pad row between" style={{ gap: 12 }}>
        <div className="row" style={{ gap: 8 }}>
          <Timer size={16} aria-hidden="true" />
          <b>Action Center SLA</b>
          <span className="dim">Days an item may wait before it counts as overdue.</span>
        </div>
        <button
          type="button"
          className="btn btn-primary btn-sm"
          disabled={busy || changed.length === 0 || invalid}
          onClick={save}
        >
          Save {changed.length > 0 ? `(${changed.length})` : ''}
        </button>
      </div>
      <table>
        <thead>
          <tr><th>Stage</th><th>Queue</th><th style={{ width: 160 }}>SLA (days)</th></tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.queue_key}>
              <td className="dim">{r.stage}</td>
              <td>{r.label}</td>
              <td>
                {r.configurable ? (
                  <input
                    className="input"
                    type="number"
                    min={MIN_DAYS}
                    max={MAX_DAYS}
                    aria-label={`SLA days for ${r.stage}: ${r.label}`}
                    value={draft[r.queue_key] ?? r.sla_days}
                    onChange={(e) => setDraft((d) => ({ ...d, [r.queue_key]: e.target.value }))}
                    style={{ width: 96 }}
                  />
                ) : (
                  <span className="dim">{r.queue_key === 'hc_fixes' ? 'Category SLA' : 'Plan deadline'}</span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
