import { Radio, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import SiteHistoryDrawer, { SiteCodeButton } from '../../components/SiteHistoryDrawer'
import { EmptyState, Loading } from '../../components/ui'
import { useToast } from '../../context/ToastContext'

/**
 * Sites cleared for an official drive test and not yet assigned to one.
 *
 * The queue's condition is exactly what the server enforces on the way in —
 * latest completed round Ready, and confirmed by a PM or Coordinator — so
 * nothing can appear here that the assignment endpoint would then refuse. A
 * queue that offers rows the server rejects is worse than no queue.
 *
 * The health-check subcontractor is shown but carries no privilege: picking a
 * different company for the drive test is one click, and the two assignments
 * are separate records.
 */
export default function DtAssignmentTab({ onCountChange }) {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [contractors, setContractors] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [contractorId, setContractorId] = useState('')
  const [query, setQuery] = useState('')
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState({ id: null, code: null })

  function load() {
    setSelected(new Set())
    api
      .get('/hc/queues/dt-assignment')
      .then((r) => {
        setRows(r.data)
        onCountChange?.(r.data.length)
      })
      .catch(() => setRows([]))
  }

  useEffect(() => {
    load()
    api.get('/reference/contractors').then((r) => setContractors(r.data)).catch(() => {})
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => (r.site_code || '').toLowerCase().includes(q))
  }, [rows, query])

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const allSelected = filtered.length > 0 && filtered.every((r) => selected.has(r.work_item_id))

  async function assign() {
    if (!contractorId || selected.size === 0) return
    setBusy(true)
    try {
      const { data } = await api.post('/work-items/assign', {
        work_item_ids: [...selected],
        contractor_id: Number(contractorId),
        assignment_type: 'official',
      })
      toast.success(
        `${data.assigned} site${data.assigned === 1 ? '' : 's'} assigned`,
        'They move to the contractor’s queue for the drive test.',
      )
      setContractorId('')
      load()
    } catch (err) {
      toast.error('Assign failed', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!rows) return <Loading label="Loading sites ready for drive test" />

  if (rows.length === 0) {
    return (
      <div className="card card-pad">
        <EmptyState
          title="No sites waiting for a drive test"
          hint="A site appears here once its health check passes and you confirm it."
        />
      </div>
    )
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div style={{ position: 'relative', marginBottom: 12 }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }} />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Search site ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>

        <div className="row between wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block', marginBottom: 6 }}>
              Drive test contractor
            </label>
            <div className="row wrap" style={{ gap: 8 }}>
              {contractors.map((c) => {
                const active = String(contractorId) === String(c.id)
                return (
                  <button
                    key={c.id}
                    type="button"
                    className="btn btn-sm"
                    onClick={() => setContractorId(active ? '' : String(c.id))}
                    style={{
                      background: active ? 'var(--signal)' : 'var(--surface-2)',
                      color: active ? '#fff' : 'var(--text-muted)',
                      border: active ? 'none' : '1px solid var(--border)',
                    }}
                  >
                    {c.name}
                  </button>
                )
              })}
            </div>
          </div>
          <button
            className="btn btn-primary"
            disabled={!contractorId || selected.size === 0 || busy}
            onClick={assign}
          >
            {busy ? <div className="spinner" /> : <><Radio size={15} /> Assign DT ({selected.size})</>}
          </button>
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th style={{ width: 40 }}>
              <input
                type="checkbox"
                checked={allSelected}
                onChange={() =>
                  setSelected(
                    allSelected ? new Set() : new Set(filtered.map((r) => r.work_item_id)),
                  )
                }
              />
            </th>
            <th>Site ID</th>
            <th>Province</th>
            <th>Requested Tech</th>
            <th>Rounds</th>
            <th>HC Contractor</th>
            <th>Waiting</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr
              key={r.work_item_id}
              className={selected.has(r.work_item_id) ? 'row-selected' : ''}
              onClick={() => toggle(r.work_item_id)}
              style={{
                cursor: 'pointer',
                ...(selected.has(r.work_item_id) ? { background: 'var(--signal-glow)' } : {}),
              }}
            >
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  checked={selected.has(r.work_item_id)}
                  onChange={() => toggle(r.work_item_id)}
                />
              </td>
              <td onClick={(e) => e.stopPropagation()}>
                <SiteCodeButton
                  workItemId={r.work_item_id}
                  siteCode={r.site_code}
                  onOpen={(id, code) => setHistory({ id, code })}
                />
              </td>
              <td className="text-data dim">{r.province || '—'}</td>
              <td>
                <div className="row" style={{ gap: 5 }}>
                  {r.requested_technologies.map((t) => (
                    <span key={t} className="pill pill-dim" style={{ fontSize: 11.5 }}>{t}</span>
                  ))}
                </div>
              </td>
              <td>
                {/* Only a site that needed more than one pass says so. */}
                {r.rounds_taken > 1 ? (
                  <span className="pill pill-cyan" style={{ fontSize: 11.5 }}>
                    {r.rounds_taken} rounds
                  </span>
                ) : (
                  <span className="dim tnum">1</span>
                )}
              </td>
              <td className="text-data dim">{r.hc_contractor || '—'}</td>
              <td>
                <span className="tnum">{r.days_waiting}d</span>
                {r.returned_reason && (
                  <span
                    className="pill pill-amber"
                    style={{ marginLeft: 6, fontSize: 11 }}
                    title={r.returned_reason}
                  >
                    Handed back
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />
    </div>
  )
}
