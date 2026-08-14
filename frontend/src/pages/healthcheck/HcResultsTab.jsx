import { CheckCircle2, XCircle, Search, ChevronRight, ChevronDown, ShieldCheck, Download } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { ConfirmDialog, EmptyState, Loading } from '../../components/ui'
import SiteHistoryDrawer, { SiteCodeButton } from '../../components/SiteHistoryDrawer'

// Fallback only. Categories are admin-extendable, so the live list comes from
// /reference/problem-categories; this keeps the screen usable if that fails.
const FALLBACK_CATEGORIES = [
  'Temporary Power',
  'NWG Responsibility',
  'MS Responsibility',
  'Project Responsibility',
]

export default function HcResultsTab({ highlightTaskId } = {}) {
  const { user } = useAuth()
  const toast = useToast()
  const canAssign = ['Admin', 'PM'].includes(user?.role?.name)
  const canReview = ['Admin', 'PM', 'Coordinator'].includes(user?.role?.name)

  const [results, setResults] = useState(null)
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState('all') // all | ready | notready
  const [expanded, setExpanded] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())
  const [contractors, setContractors] = useState([])
  const highlightRef = useRef(null)
  // Pending not-ready category selection awaiting yes/no confirmation —
  // marking a site Problematic drops it out of the normal DT pipeline and
  // into the Drive Test dashboard's Problematic bucket, so it shouldn't
  // happen from a single accidental dropdown click.
  const [pendingReview, setPendingReview] = useState(null) // {taskId, categories} | null
  const [reviewBusy, setReviewBusy] = useState(false)
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES)
  const [history, setHistory] = useState({ id: null, code: null })

  const load = () => {
    setSelected(new Set())
    api.get('/hc/results').then((r) => setResults(r.data)).catch(() => setResults([]))
  }
  useEffect(load, [])

  // Deep-linked from Action Center — scroll the target site's row into view
  // once results have loaded.
  useEffect(() => {
    if (highlightTaskId && highlightRef.current) {
      highlightRef.current.scrollIntoView({ behavior: 'smooth', block: 'center' })
    }
  }, [highlightTaskId, results])

  useEffect(() => {
    if (canAssign) api.get('/reference/contractors').then((r) => setContractors(r.data)).catch(() => {})
  }, [canAssign])

  useEffect(() => {
    api
      .get('/reference/problem-categories')
      .then((r) => r.data.length && setCategories(r.data.map((c) => c.name)))
      .catch(() => {})
  }, [])

  const [exporting, setExporting] = useState(false)
  async function exportExcel() {
    setExporting(true)
    try {
      const res = await api.get('/hc/results/export', { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = 'hc_results.xlsx'
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed', 'Could not generate the results file.')
    } finally {
      setExporting(false)
    }
  }

  async function reviewTask(taskId, problemCategories) {
    const chosen = problemCategories || []
    try {
      await api.post(`/hc/tasks/${taskId}/review`, { problem_categories: chosen })
      toast.success(
        chosen.length ? 'Routed' : 'Validated',
        chosen.length
          ? `${chosen.join(' and ')} notified. The site comes back for re-check once every fix is closed.`
          : 'Site confirmed ready.',
      )
      load()
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    }
  }

  // Confirm-ready is one click and reversible any time, so it goes straight
  // through. Setting a not-ready category is the consequential action — it
  // is what flags the site Problematic in Drive Test — so that path is
  // routed through the confirmation dialog instead of calling reviewTask
  // directly (see CategoryCell below).
  function requestNotReadyReview(taskId, categories) {
    setPendingReview({ taskId, categories })
  }

  async function confirmPendingReview() {
    if (!pendingReview) return
    setReviewBusy(true)
    await reviewTask(pendingReview.taskId, pendingReview.categories)
    setReviewBusy(false)
    setPendingReview(null)
  }

  const toggleRow = (key) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(key) ? next.delete(key) : next.add(key)
      return next
    })

  const toggleSelect = (wid) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(wid) ? next.delete(wid) : next.add(wid)
      return next
    })

  const filtered = useMemo(() => {
    if (!results) return []
    const q = query.trim().toLowerCase()
    return results.filter((r) => {
      if (filter === 'ready' && r.overall_result !== 'Ready') return false
      if (filter === 'notready' && r.overall_result !== 'NotReady') return false
      if (q && !(r.site_code || '').toLowerCase().includes(q)) return false
      return true
    })
  }, [results, query, filter])

  if (!results) return <Loading label="Loading health check results" />

  const readyCount = results.filter((r) => r.overall_result === 'Ready').length
  const notReadyCount = results.filter((r) => r.overall_result === 'NotReady').length

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div className="row between wrap" style={{ gap: 12 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }} />
            <input className="input" style={{ paddingLeft: 32 }} placeholder="Search site ID…" value={query} onChange={(e) => setQuery(e.target.value)} />
          </div>
          <div className="row" style={{ gap: 6 }}>
            <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>All ({results.length})</FilterChip>
            <FilterChip active={filter === 'ready'} onClick={() => setFilter('ready')} color="var(--green)">Ready ({readyCount})</FilterChip>
            <FilterChip active={filter === 'notready'} onClick={() => setFilter('notready')} color="var(--red)">Not Ready ({notReadyCount})</FilterChip>
            <button
              className="btn btn-sm"
              onClick={exportExcel}
              disabled={exporting || results.length === 0}
              title="Export all results to Excel"
            >
              {exporting ? <div className="spinner" /> : <><Download size={14} /> Export Excel</>}
            </button>
          </div>
        </div>
      </div>

      {canAssign && selected.size > 0 && (
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <AssignBar
            count={selected.size}
            contractors={contractors}
            onClear={() => setSelected(new Set())}
            onAssign={async (contractorId) => {
              try {
                await api.post('/work-items/assign', {
                  work_item_ids: [...selected],
                  contractor_id: contractorId,
                  assignment_type: 'official',
                })
                toast.success(`${selected.size} site(s) assigned`)
                load()
              } catch (err) {
                toast.error('Assign failed', err.response?.data?.detail || 'Please try again.')
              }
            }}
          />
        </div>
      )}

      {filtered.length === 0 ? (
        <div style={{ padding: 20 }}>
          <EmptyState title="No results yet" hint="Completed health checks show here." />
        </div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                {canAssign && <th style={{ width: 30 }}></th>}
                <th style={{ width: 28 }}></th>
                <th>Site ID</th>
                <th>Type</th>
                <th>Result</th>
                <th>Category</th>
                <th>Subcontractor</th>
                <th>Assignment</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((r, i) => {
                const key = `${r.work_item_id}-${i}`
                const isOpen = expanded.has(key)
                const techs = r.technologies || []
                const selectable = canAssign && r.overall_result === 'Ready'
                const isHighlighted = r.task_id != null && String(r.task_id) === String(highlightTaskId)
                return (
                  <>
                    <tr
                      key={key}
                      ref={isHighlighted ? highlightRef : null}
                      style={isHighlighted ? { outline: '2px solid var(--signal)', outlineOffset: -2 } : undefined}
                    >
                      {canAssign && (
                        <td>
                          {selectable ? (
                            <input
                              type="checkbox"
                              checked={selected.has(r.work_item_id)}
                              onChange={() => toggleSelect(r.work_item_id)}
                            />
                          ) : null}
                        </td>
                      )}
                      <td
                        style={{ color: 'var(--text-dim)', cursor: techs.length ? 'pointer' : 'default' }}
                        onClick={() => techs.length && toggleRow(key)}
                      >
                        {techs.length ? (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}
                      </td>
                      <td className="text-data" onClick={(e) => e.stopPropagation()}>
                        <SiteCodeButton
                          workItemId={r.work_item_id}
                          siteCode={r.site_code}
                          onOpen={(id, code) => setHistory({ id, code })}
                        />
                      </td>
                      <td className="text-data">{r.site_type}</td>
                      <td>
                        {r.overall_result === 'Ready' ? (
                          <span className="row" style={{ gap: 5, color: 'var(--green)', fontWeight: 500, fontSize: 13 }}>
                            <CheckCircle2 size={15} /> Ready
                          </span>
                        ) : (
                          <span className="row" style={{ gap: 5, color: 'var(--red)', fontWeight: 500, fontSize: 13 }}>
                            <XCircle size={15} /> Not Ready
                          </span>
                        )}
                      </td>
                      <td>
                        <CategoryCell row={r} canReview={canReview} categories={categories} onConfirmReady={reviewTask} onSelectCategory={requestNotReadyReview} />
                      </td>
                      <td className="text-data">{r.contractor_name || '—'}</td>
                      <td className="dim" style={{ fontSize: 12.5 }}>{r.assignment_code}</td>
                    </tr>
                    {isOpen && (
                      <tr key={`${key}-detail`}>
                        {canAssign && <td></td>}
                        <td></td>
                        <td colSpan={6} style={{ background: 'var(--surface-2)', padding: '10px 14px' }}>
                          <TechBreakdown techs={techs} />
                        </td>
                      </tr>
                    )}
                  </>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />

      <ConfirmDialog
        open={pendingReview !== null}
        title="Mark this site Problematic?"
        message={pendingReview ? `This opens a fix for ${pendingReview.categories.join(' and ')} and flags the site as Problematic — it drops out of the normal drive-test pipeline until every fix is closed, at which point it returns for re-check automatically. This can be changed again later if needed.` : ''}
        confirmLabel="Yes, mark Problematic"
        danger
        busy={reviewBusy}
        onConfirm={confirmPendingReview}
        onCancel={() => setPendingReview(null)}
      />
    </div>
  )
}

function CategoryCell({ row, canReview, categories, onConfirmReady, onSelectCategory }) {
  // Ready sites need no category. For coordinators, show a one-click confirm
  // (optional acknowledgement); otherwise just a dash.
  if (row.overall_result === 'Ready') {
    if (row.reviewed) {
      return (
        <span className="row" style={{ gap: 4, color: 'var(--green)', fontSize: 12.5 }}>
          <ShieldCheck size={14} /> Confirmed
        </span>
      )
    }
    if (canReview) {
      return (
        <button
          className="btn btn-sm btn-ghost"
          style={{ fontSize: 12 }}
          onClick={() => onConfirmReady(row.task_id, [])}
        >
          Confirm ready
        </button>
      )
    }
    return <span className="dim">—</span>
  }

  // Not Ready: a category is required. Coordinators pick one; others see the
  // chosen category (or "Pending review"). Picking a category opens a
  // yes/no confirmation before it's written — this is what flags the site
  // Problematic across the rest of the app (Work Items stage, Drive Test
  // dashboard), so it shouldn't commit on a single dropdown click.
  if (canReview && row.task_id) {
    return (
      <CategoryPicker
        row={row}
        categories={categories}
        onRoute={(cats) => onSelectCategory(row.task_id, cats)}
      />
    )
  }
  return (
    <span className="text-data dim">
      {(row.problem_categories?.length
        ? row.problem_categories.join(', ')
        : row.problem_category) || 'Pending review'}
    </span>
  )
}

/**
 * Multi-select category chips for a Not-Ready site.
 *
 * A site can be blocked by more than one thing at once (power *and* planning),
 * so this is deliberately not a dropdown: each chosen category opens its own
 * fix for its own owner, and they work in parallel. Selection is local until
 * "Route" is pressed, because routing is what flags the site Problematic
 * across the rest of the app.
 */
function CategoryPicker({ row, categories, onRoute }) {
  const [picked, setPicked] = useState(() => new Set(row.problem_categories || []))

  const toggle = (c) =>
    setPicked((prev) => {
      const next = new Set(prev)
      next.has(c) ? next.delete(c) : next.add(c)
      return next
    })

  const current = (row.problem_categories || []).join('|')
  const changed = [...picked].sort().join('|') !== current.split('|').sort().join('|')

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8, minWidth: 260 }}>
      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {categories.map((c) => {
          const on = picked.has(c)
          return (
            <button
              key={c}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(c)}
              style={{
                padding: '5px 11px',
                borderRadius: 20,
                fontSize: 12,
                fontWeight: on ? 600 : 500,
                cursor: 'pointer',
                border: `1px solid ${on ? 'transparent' : 'var(--border)'}`,
                background: on ? 'var(--amber-dim)' : 'var(--surface-1)',
                color: on ? 'var(--amber)' : 'var(--text-muted)',
              }}
            >
              {c}
            </button>
          )
        })}
      </div>
      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn btn-primary btn-sm"
          disabled={picked.size === 0 || !changed}
          onClick={() => onRoute([...picked])}
        >
          {row.reviewed ? 'Update routing' : 'Route'}
        </button>
        {row.reviewed && !changed && (
          <ShieldCheck size={15} style={{ color: 'var(--green)' }} title="Routed" />
        )}
      </div>
    </div>
  )
}

function TechBreakdown({ techs }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {techs.map((t) => {
        const normal = t.result === 'Normal'
        return (
          <div key={t.technology} className="row" style={{ gap: 10, alignItems: 'flex-start', fontSize: 13 }}>
            <span className="text-data" style={{ minWidth: 34, fontWeight: 600 }}>{t.technology}</span>
            <span style={{ minWidth: 84, color: normal ? 'var(--green)' : 'var(--red)', fontWeight: 500 }}>
              {normal ? 'Normal' : 'Not Normal'}
            </span>
            {!normal && (
              <span className="dim" style={{ flex: 1 }}>
                {t.comment || 'No comment provided'}
              </span>
            )}
          </div>
        )
      })}
    </div>
  )
}

function AssignBar({ count, contractors, onAssign, onClear }) {
  const [contractorId, setContractorId] = useState('')
  const [busy, setBusy] = useState(false)
  const assign = async () => {
    if (!contractorId) return
    setBusy(true)
    await onAssign(Number(contractorId))
    setBusy(false)
    setContractorId('')
  }
  return (
    <div className="row between wrap" style={{ gap: 12, alignItems: 'center', padding: '10px 12px', border: '1px solid var(--signal)', borderRadius: 10 }}>
      <span style={{ fontWeight: 500 }}>{count} Ready site(s) selected</span>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <select className="input" style={{ minWidth: 200 }} value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
          <option value="">Assign to contractor…</option>
          {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
        <button className="btn btn-primary" disabled={!contractorId || busy} onClick={assign}>
          {busy ? 'Assigning…' : 'Assign (official)'}
        </button>
        <button className="btn" onClick={onClear}>Clear</button>
      </div>
    </div>
  )
}

function FilterChip({ active, onClick, color, children }) {
  return (
    <button
      className="btn btn-sm"
      onClick={onClick}
      style={{
        background: active ? (color || 'var(--signal)') : 'var(--surface-2)',
        color: active ? '#fff' : 'var(--text-muted)',
        border: active ? 'none' : '1px solid var(--border)',
      }}
    >
      {children}
    </button>
  )
}
