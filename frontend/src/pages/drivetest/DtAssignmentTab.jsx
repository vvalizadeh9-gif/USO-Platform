import { Radio, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import AssignDock from '../../components/AssignDock'
import ProvinceFilter from '../../components/ProvinceFilter'
import SiteHistoryDrawer, { SiteCodeButton } from '../../components/SiteHistoryDrawer'
import WaitingPill from '../../components/WaitingPill'
import { Card, EmptyState, Loading } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { DT_ASSIGNMENT_WAITING } from '../../lib/waiting'

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
  const [provinceSel, setProvinceSel] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [assigned, setAssigned] = useState(0)
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

  const provinceOptions = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map((r) => r.province).filter(Boolean))].sort()
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (provinceSel.size && !provinceSel.has(r.province)) return false
      if (!q) return true
      return (r.site_code || '').toLowerCase().includes(q)
    })
  }, [rows, query, provinceSel])

  function toggleProvince(p) {
    setProvinceSel((s) => {
      const next = new Set(s)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  // A filter can hide a row that is still selected. Selection only ever
  // covers what's on screen, so a hidden row drops out rather than being
  // assigned invisibly.
  useEffect(() => {
    setSelected((prev) => {
      const visible = new Set(filtered.map((r) => r.work_item_id))
      const next = new Set([...prev].filter((id) => visible.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [filtered])

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
      setAssigned((n) => n + 1)
      load()
    } catch (err) {
      toast.error('Assign failed', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!rows) return <Loading label="Loading sites ready for drive test" />

  return (
    <>
      <Card
        className="card-fill queue-card"
        icon={Radio}
        title="Assignment"
        description="Sites confirmed Ready by health check. Tick the ones to drive-test, then choose a contractor below."
        actions={
          <>
            <label className="search-box">
              <Search size={16} aria-hidden="true" />
              <input
                className="input"
                placeholder="Search site ID…"
                aria-label="Search site ID"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <ProvinceFilter
              options={provinceOptions}
              selected={provinceSel}
              onToggle={toggleProvince}
              onClear={() => setProvinceSel(new Set())}
            />
          </>
        }
      >
        <div className="queue-toolbar">
          <span className="queue-meta">Sorted: waiting longest first</span>
          <span className="queue-meta tnum">
            {query.trim() || provinceSel.size > 0
              ? `${filtered.length} of ${rows.length} sites ready`
              : `${rows.length} site${rows.length === 1 ? '' : 's'} ready`}
          </span>
        </div>

        {rows.length === 0 ? (
          <EmptyState
            title="No sites waiting for a drive test"
            hint="A site appears here once its health check passes and you confirm it."
          />
        ) : (
          <div className="table-scroll">
            <table className="table table-compact queue-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      aria-label="Select every site shown"
                      checked={allSelected}
                      onChange={() =>
                        setSelected(allSelected ? new Set() : new Set(filtered.map((r) => r.work_item_id)))
                      }
                    />
                  </th>
                  <th>Site ID</th>
                  <th>Province</th>
                  <th>Requested tech</th>
                  <th>Rounds</th>
                  <th>HC contractor</th>
                  <th>Waiting</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((r) => (
                  <tr
                    key={r.work_item_id}
                    className={`row-action${selected.has(r.work_item_id) ? ' row-selected' : ''}`}
                    onClick={() => toggle(r.work_item_id)}
                  >
                    <td className="col-check" onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        aria-label={`Select ${r.site_code || 'site'}`}
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
                    <td className="text-farsi">{r.province || '—'}</td>
                    <td>
                      <span className="tech-chips">
                        {r.requested_technologies.map((t) => (
                          <span key={t} className="pill pill-dim">{t}</span>
                        ))}
                      </span>
                    </td>
                    <td>
                      {/* Only a site that needed more than one pass says so. */}
                      {r.rounds_taken > 1 ? (
                        <span className="pill pill-dim">{r.rounds_taken} rounds</span>
                      ) : (
                        <span className="tnum">1</span>
                      )}
                    </td>
                    <td className="text-farsi">{r.hc_contractor || '—'}</td>
                    <td>
                      <span className="queue-outstanding">
                        <WaitingPill days={r.days_waiting} thresholds={DT_ASSIGNMENT_WAITING} />
                        {r.returned_reason && (
                          <span className="pill pill-amber" title={r.returned_reason}>
                            Handed back
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>

      {rows.length > 0 && (
        <AssignDock
          kind="dt"
          selectedCount={selected.size}
          onClear={() => setSelected(new Set())}
          contractors={contractors}
          contractorId={contractorId}
          onSelectContractor={setContractorId}
          onAssign={assign}
          busy={busy}
          actionLabel="Assign drive test"
          hint="Any contractor can take a site: the health-check one has no privilege."
          reloadKey={assigned}
        />
      )}

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />
    </>
  )
}
