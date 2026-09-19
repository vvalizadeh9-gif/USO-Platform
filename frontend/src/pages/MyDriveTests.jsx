import { motion } from 'framer-motion'
import { ChevronRight, Search, X } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client'
import DriveTestSubmitForm from '../components/DriveTestSubmitForm'
import LifecycleStrip from '../components/LifecycleStrip'
import ProvinceFilter from '../components/ProvinceFilter'
import ReturnToCoordinatorForm from '../components/ReturnToCoordinatorForm'
import SiteHistoryDrawer, { SiteCodeButton } from '../components/SiteHistoryDrawer'
import WaitingPill from '../components/WaitingPill'
import { useToast } from '../context/ToastContext'
import { EmptyState, Loading, PageHead } from '../components/ui'

const TABS = [
  { key: 'todo', label: 'To do', count: 'todo' },
  { key: 'submitted', label: 'Submitted', count: 'submitted' },
]

// One place for a contractor to work drive tests instead of knowing which
// sites to open on Work Items -- the same reason My Health Check exists.
//
// To do mirrors the PM/Coordinator's own dt_in_progress queue, narrowed to
// this company (see hc_queues.contractor_dt_todo on the backend); Submitted
// is read-only, because every row there is waiting on a reviewer, not on the
// contractor looking at it.
export default function MyDriveTests() {
  const toast = useToast()
  const [searchParams, setSearchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') === 'submitted' ? 'submitted' : 'todo')
  const [rows, setRows] = useState(null)
  const [counts, setCounts] = useState({})
  const [openId, setOpenId] = useState(null)
  const [history, setHistory] = useState({ id: null, code: null })
  const [query, setQuery] = useState('')
  const [provinceSel, setProvinceSel] = useState(() => new Set())

  const loadCounts = useCallback(() => {
    api.get('/drive-tests/my/counts').then((r) => setCounts(r.data)).catch(() => {})
  }, [])

  const loadRows = useCallback((forTab) => {
    setRows(null)
    api
      .get('/drive-tests/my/queue', { params: { tab: forTab } })
      .then((r) => setRows(r.data))
      .catch(() => setRows([]))
  }, [])

  useEffect(loadCounts, [loadCounts])
  useEffect(() => { loadRows(tab) }, [tab, loadRows])

  function selectTab(next) {
    if (next === tab) return
    // Cleared here rather than left to the effect below: otherwise the
    // render in between still holds the old tab's rows, and the other
    // table momentarily maps over data shaped for a different tab.
    setRows(null)
    setTab(next)
    setOpenId(null)
    setQuery('')
    setProvinceSel(new Set())
    const params = new URLSearchParams(searchParams)
    params.set('tab', next)
    setSearchParams(params, { replace: true })
  }

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

  // Shared by submit and return: close the panel, reload the lists and
  // counts behind it, and say what happened. Mirrors the "action" wrapper on
  // the Work Item page, which this panel reuses the same forms from.
  async function action(fn, okMsg) {
    try {
      const res = await fn()
      toast.success(okMsg)
      setOpenId(null)
      loadRows(tab)
      loadCounts()
      return res?.data
    } catch (err) {
      toast.error('Action failed', err.response?.data?.detail || 'Please try again.')
      return undefined
    }
  }

  const active = tab === 'todo' ? rows?.find((r) => r.work_item_id === openId) || null : null

  return (
    <>
      <PageHead
        eyebrow="Drive Test Project"
        title="My Drive Tests"
        subtitle="Sites assigned to your company. Fill each one in when the drive test is done; a PM or Coordinator reviews it."
      />

      <LifecycleStrip current="dt" variant="contractor" />

      <div className="tabs tabs-steps" style={{ flexWrap: 'wrap' }}>
        {TABS.map((t, i) => (
          <div className="tab-step" key={t.key}>
            {i > 0 && <ChevronRight size={14} className="tab-sep" aria-hidden="true" />}
            <button className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => selectTab(t.key)}>
              <span className="row" style={{ gap: 8 }}>
                {t.label}
                {counts[t.count] > 0 && <span className="badge tnum">{counts[t.count]}</span>}
              </span>
            </button>
          </div>
        ))}
      </div>

      {rows === null ? (
        <Loading label="Loading your sites" />
      ) : (
        <>
          {rows.length > 0 && (
            <div className="card card-pad" style={{ marginBottom: 16 }}>
              <div className="row between wrap" style={{ gap: 12 }}>
                <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
                  <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }} />
                  <input
                    className="input"
                    style={{ paddingLeft: 32 }}
                    placeholder="Search site ID…"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                  />
                </div>
                <ProvinceFilter
                  options={provinceOptions}
                  selected={provinceSel}
                  onToggle={toggleProvince}
                  onClear={() => setProvinceSel(new Set())}
                />
              </div>
              {(query.trim() || provinceSel.size > 0) && (
                <div className="row" style={{ marginTop: 8, justifyContent: 'flex-end' }}>
                  <span className="dim" style={{ fontSize: 11.5 }}>
                    {filtered.length} of {rows.length}
                  </span>
                </div>
              )}
            </div>
          )}

          {tab === 'todo' ? (
            <div className="mydt-grid">
              <ToDoTable
                rows={filtered}
                openId={openId}
                onFillIn={setOpenId}
                onOpenHistory={(id, code) => setHistory({ id, code })}
              />
              {active && (
                <ToDoPanel
                  key={active.work_item_id}
                  row={active}
                  onClose={() => setOpenId(null)}
                  onSubmit={(payload) =>
                    action(
                      () => api.post(`/work-items/${active.work_item_id}/drive-test`, payload),
                      'Drive test submitted for review',
                    )
                  }
                  onReturn={(payload) =>
                    action(
                      () => api.post(`/work-items/${active.work_item_id}/return-to-coordinator`, payload),
                      'Site returned to coordinator',
                    )
                  }
                />
              )}
            </div>
          ) : (
            <SubmittedTable rows={filtered} onOpenHistory={(id, code) => setHistory({ id, code })} />
          )}
        </>
      )}

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />
    </>
  )
}

function ToDoTable({ rows, openId, onFillIn, onOpenHistory }) {
  if (rows.length === 0) {
    return (
      <div className="card card-pad">
        <EmptyState title="No sites waiting for a drive test." />
      </div>
    )
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table>
        <thead>
          <tr>
            <th>Site</th>
            <th>Province</th>
            <th>Status</th>
            <th>Waiting</th>
            <th style={{ width: 90 }}></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => {
            const sentBack = r.status === 'sent_back'
            return (
              <tr key={r.work_item_id}>
                <td>
                  <SiteCodeButton
                    workItemId={r.work_item_id}
                    siteCode={r.site_code}
                    onOpen={onOpenHistory}
                  />
                </td>
                <td className="text-data dim">{r.province || '—'}</td>
                <td>
                  <span className={`pill ${sentBack ? 'pill-red' : 'pill-dim'}`}>
                    {sentBack ? 'Sent back' : 'New'}
                  </span>
                </td>
                <td>
                  <WaitingPill days={r.days_since_assigned} />
                </td>
                <td>
                  <button
                    className={`btn btn-sm ${openId === r.work_item_id ? 'btn-primary' : ''}`}
                    onClick={() => onFillIn(r.work_item_id)}
                  >
                    Fill in
                  </button>
                </td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function ToDoPanel({ row, onClose, onSubmit, onReturn }) {
  const sentBack = row.status === 'sent_back'
  return (
    <motion.div
      className="mydt-panel"
      initial={{ opacity: 0, x: 12 }}
      animate={{ opacity: 1, x: 0 }}
      style={{ display: 'flex', flexDirection: 'column', gap: 14 }}
    >
      <div className="card card-pad" style={{ paddingBottom: sentBack ? 14 : 20 }}>
        <div className="row between">
          <h3 style={{ fontSize: 15 }}>{row.site_code || `Site #${row.work_item_id}`}</h3>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close panel">
            <X size={15} />
          </button>
        </div>
        {sentBack && row.sent_back_comment && (
          <div
            style={{
              marginTop: 10, background: 'var(--red-dim)', borderRadius: 'var(--radius-sm)',
              padding: '10px 12px', fontSize: 12.5, color: 'var(--red)', lineHeight: 1.5,
            }}
          >
            <b>Sent back:</b> {row.sent_back_comment}
          </div>
        )}
      </div>

      <DriveTestSubmitForm
        onSubmit={onSubmit}
        footer={
          <>
            <p className="dim" style={{ fontSize: 12.5, marginBottom: 10 }}>
              Can't do this site? (road blocked, site down…)
            </p>
            <ReturnToCoordinatorForm onSubmit={onReturn} />
          </>
        }
      />
    </motion.div>
  )
}

function SubmittedTable({ rows, onOpenHistory }) {
  if (rows.length === 0) {
    return (
      <div className="card card-pad">
        <EmptyState title="Nothing waiting for review." />
      </div>
    )
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table>
        <thead>
          <tr>
            <th>Site</th>
            <th>Province</th>
            <th>Carried out</th>
            <th>Submitted</th>
            <th>Waiting</th>
            <th>Files</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.drive_test_id}>
              <td>
                <SiteCodeButton
                  workItemId={r.work_item_id}
                  siteCode={r.site_code}
                  onOpen={onOpenHistory}
                />
              </td>
              <td className="text-data dim">{r.province || '—'}</td>
              <td className="text-data tnum">{r.execution_date || '—'}</td>
              <td className="text-data dim tnum">
                {r.submitted_at ? new Date(r.submitted_at).toISOString().slice(0, 10) : '—'}
              </td>
              <td>
                <WaitingPill days={r.days_waiting} />
              </td>
              <td className="dim" style={{ fontSize: 12.5 }}>
                {r.evidence_filenames?.length ? r.evidence_filenames.join(', ') : '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
