import { CheckCircle2, Paperclip, Search, XCircle } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import ProvinceFilter from '../../components/ProvinceFilter'
import SiteHistoryDrawer, { SiteCodeButton } from '../../components/SiteHistoryDrawer'
import WaitingPill from '../../components/WaitingPill'
import { ConfirmDialog, EmptyState, Loading } from '../../components/ui'
import { useToast } from '../../context/ToastContext'

/**
 * Drive tests submitted and awaiting approval.
 *
 * Reaching these used to mean opening work items one at a time and knowing
 * which ones to open. Approval is the end of the lifecycle — it writes
 * dt_status = "Done", moves the dashboard KPI and unlocks village acceptance —
 * so it deserves a queue of its own, and the evidence to approve against.
 */
export default function DtReviewTab({ onCountChange }) {
  const toast = useToast()
  const [rows, setRows] = useState(null)
  const [comments, setComments] = useState({})
  const [pending, setPending] = useState(null) // {row, decision} | null
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState({ id: null, code: null })
  const [query, setQuery] = useState('')
  const [provinceSel, setProvinceSel] = useState(() => new Set())
  const [contractorFilter, setContractorFilter] = useState('')

  function load() {
    api
      .get('/hc/queues/dt-review')
      .then((r) => {
        setRows(r.data)
        onCountChange?.(r.data.length)
      })
      .catch(() => setRows([]))
  }
  useEffect(load, [])

  async function decide() {
    if (!pending) return
    setBusy(true)
    try {
      await api.post(`/drive-tests/${pending.row.drive_test_id}/coordinator-review`, {
        decision: pending.decision,
        comment: comments[pending.row.drive_test_id] || null,
      })
      toast.success(
        pending.decision === 'Approved' ? 'Approved — DT Done' : 'Sent back',
        pending.decision === 'Approved'
          ? `${pending.row.site_code} now counts as drive-test complete.`
          : `${pending.row.site_code} returns to the contractor’s queue.`,
      )
      setPending(null)
      load()
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  async function download(evidence) {
    try {
      const res = await api.get(`/drive-tests/evidence/${evidence.id}/download`, {
        responseType: 'blob',
      })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = evidence.original_filename
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed', 'The stored file could not be read.')
    }
  }

  const provinceOptions = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map((r) => r.province).filter(Boolean))].sort()
  }, [rows])

  const contractorOptions = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map((r) => r.contractor_name).filter(Boolean))].sort()
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (provinceSel.size && !provinceSel.has(r.province)) return false
      if (contractorFilter && r.contractor_name !== contractorFilter) return false
      if (!q) return true
      return (r.site_code || '').toLowerCase().includes(q)
    })
  }, [rows, query, provinceSel, contractorFilter])

  function toggleProvince(p) {
    setProvinceSel((s) => {
      const next = new Set(s)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  if (!rows) return <Loading label="Loading drive tests awaiting review" />

  if (rows.length === 0) {
    return (
      <div className="card card-pad">
        <EmptyState
          title="No drive tests waiting"
          hint="Submissions from contractors appear here for approval."
        />
      </div>
    )
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="card card-pad">
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
          <select
            className="input text-data"
            style={{ minWidth: 160 }}
            value={contractorFilter}
            onChange={(e) => setContractorFilter(e.target.value)}
          >
            <option value="">All contractors</option>
            {contractorOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="row between" style={{ marginTop: 8 }}>
          <span className="dim" style={{ fontSize: 11.5 }}>Sorted: waiting longest first</span>
          {(query.trim() || provinceSel.size > 0 || contractorFilter) && (
            <span className="dim" style={{ fontSize: 11.5 }}>
              {filtered.length} of {rows.length}
            </span>
          )}
        </div>
      </div>

      {filtered.length === 0 && (
        <div className="card card-pad">
          <EmptyState title="No drive tests match these filters" />
        </div>
      )}

      {filtered.map((r) => (
        <div key={r.drive_test_id} className="card card-pad">
          <div className="row between wrap" style={{ gap: 14, alignItems: 'flex-start' }}>
            <div style={{ flex: 1, minWidth: 260 }}>
              <div className="row wrap" style={{ gap: 10, alignItems: 'baseline' }}>
                <SiteCodeButton
                  workItemId={r.work_item_id}
                  siteCode={r.site_code}
                  onOpen={(id, code) => setHistory({ id, code })}
                />
                <span className="pill pill-dim">{r.site_type}</span>
                <span className="dim" style={{ fontSize: 13 }}>{r.province}</span>
              </div>

              <div className="row wrap" style={{ gap: 18, marginTop: 10, fontSize: 13 }}>
                <Field label="Carried out" value={r.execution_date || '—'} />
                <Field label="Submitted" value={fmt(r.submitted_at)} />
                <Field label="Waiting" value={<WaitingPill days={r.days_waiting} />} />
                <Field label="Contractor" value={r.contractor_name || '—'} />
              </div>

              <div className="row wrap" style={{ gap: 8, marginTop: 12 }}>
                {r.evidence.length === 0 ? (
                  <span className="dim" style={{ fontSize: 12.5 }}>
                    No report attached — approve only if you have seen it elsewhere.
                  </span>
                ) : (
                  r.evidence.map((e) => (
                    <button
                      key={e.id}
                      className="btn btn-sm"
                      onClick={() => download(e)}
                      title={`${Math.round(e.size_bytes / 1024)} KB`}
                    >
                      <Paperclip size={13} /> {e.original_filename}
                    </button>
                  ))
                )}
              </div>

              <div className="field" style={{ marginTop: 12, maxWidth: 520 }}>
                <label>Comment (required when sending back)</label>
                <textarea
                  className="input"
                  rows={2}
                  value={comments[r.drive_test_id] || ''}
                  onChange={(e) =>
                    setComments((c) => ({ ...c, [r.drive_test_id]: e.target.value }))
                  }
                  placeholder="Optional note for the contractor"
                />
              </div>
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-primary btn-sm"
                onClick={() => setPending({ row: r, decision: 'Approved' })}
              >
                <CheckCircle2 size={14} /> Approve
              </button>
              <button
                className="btn btn-sm"
                style={{ color: 'var(--red)', borderColor: 'var(--red)' }}
                disabled={(comments[r.drive_test_id] || '').trim().length < 3}
                onClick={() => setPending({ row: r, decision: 'Rejected' })}
              >
                <XCircle size={14} /> Send back
              </button>
            </div>
          </div>
        </div>
      ))}

      <ConfirmDialog
        open={pending !== null}
        title={
          pending?.decision === 'Approved'
            ? 'Approve this drive test?'
            : 'Send this drive test back?'
        }
        message={
          pending?.decision === 'Approved'
            ? 'This completes the drive test for the site. It is marked DT Done, counted on the dashboard, and its villages become submittable for acceptance. There is no further approval.'
            : 'The contractor is notified and can resubmit. The site returns to their queue.'
        }
        confirmLabel={pending?.decision === 'Approved' ? 'Yes, approve' : 'Yes, send it back'}
        danger={pending?.decision !== 'Approved'}
        busy={busy}
        onConfirm={decide}
        onCancel={() => setPending(null)}
      />

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />
    </div>
  )
}

function Field({ label, value }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
      <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 }}>
        {label}
      </span>
      <span className="tnum" style={{ fontWeight: 500 }}>
        {value}
      </span>
    </div>
  )
}

function fmt(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10)
}
