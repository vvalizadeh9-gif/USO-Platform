import { motion } from 'framer-motion'
import { ChevronDown, ChevronRight, CheckCircle2, XCircle, Download } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { EmptyState, Loading } from '../../components/ui'

export default function HcHistoryTab() {
  const toast = useToast()
  const [assignments, setAssignments] = useState(null)
  const [contractors, setContractors] = useState({})
  const [expanded, setExpanded] = useState(() => new Set())
  const [details, setDetails] = useState({}) // id -> { loading, data }
  const [exportingId, setExportingId] = useState(null)

  async function exportAssignment(a) {
    setExportingId(a.id)
    try {
      const res = await api.get(`/hc/assignments/${a.id}/export`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const link = document.createElement('a')
      link.href = url
      link.download = `${a.code}_feedback.xlsx`
      link.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Export failed', 'Could not generate the feedback file.')
    } finally {
      setExportingId(null)
    }
  }

  useEffect(() => {
    api.get('/reference/contractors').then((r) => {
      const map = {}
      r.data.forEach((c) => { map[c.id] = c.name })
      setContractors(map)
    }).catch(() => {})
    api.get('/hc/assignments').then((r) => setAssignments(r.data)).catch(() => setAssignments([]))
  }, [])

  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
    // Lazy-load the assignment detail the first time it's opened.
    if (!details[id]) {
      setDetails((d) => ({ ...d, [id]: { loading: true } }))
      api.get(`/hc/assignments/${id}`)
        .then((r) => setDetails((d) => ({ ...d, [id]: { loading: false, data: r.data } })))
        .catch(() => setDetails((d) => ({ ...d, [id]: { loading: false, data: null } })))
    }
  }

  if (!assignments) return <Loading label="Loading health check history" />

  if (assignments.length === 0) {
    return <div className="card card-pad"><EmptyState title="No assignments yet" hint="Assignments you create appear here." /></div>
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div style={{ maxHeight: 560, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th style={{ width: 28 }}></th>
              <th>Assignment</th>
              <th>Contractor</th>
              <th>Date</th>
              <th>Sites</th>
              <th>Ready</th>
              <th>Not Ready</th>
              <th>Aging</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {assignments.map((a, i) => {
              const isOpen = expanded.has(a.id)
              const detail = details[a.id]
              return (
                <Fragment key={a.id}>
                  <motion.tr
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.02, 0.3) }}
                    onClick={() => toggle(a.id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td style={{ color: 'var(--text-dim)' }}>
                      {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                    </td>
                    <td style={{ fontWeight: 500 }}>{a.code}</td>
                    <td className="text-data">{contractors[a.contractor_id] || '—'}</td>
                    <td className="dim" style={{ fontSize: 12.5 }}>{formatDate(a.created_at)}</td>
                    <td className="tnum">{a.task_count ?? a.tasks?.length ?? '—'}</td>
                    <td className="tnum" style={{ color: 'var(--green)', fontWeight: 500 }}>{a.sites_ready ?? '—'}</td>
                    <td className="tnum" style={{ color: 'var(--red)', fontWeight: 500 }}>{a.sites_not_ready ?? '—'}</td>
                    <td className="dim" style={{ fontSize: 12.5 }}>{formatAging(a)}</td>
                    <td>
                      <span className={`pill ${a.status === 'Completed' ? 'pill-green' : 'pill-amber'}`}>{a.status}</span>
                    </td>
                  </motion.tr>
                  {isOpen && (
                    <tr>
                      <td></td>
                      <td colSpan={8} style={{ background: 'var(--surface-2)', padding: '10px 14px' }}>
                        <AssignmentSummary
                          assignment={a}
                          exporting={exportingId === a.id}
                          onExport={() => exportAssignment(a)}
                        />
                        {detail?.loading && <span className="dim" style={{ fontSize: 12.5 }}>Loading sites…</span>}
                        {detail && !detail.loading && !detail.data && (
                          <span className="dim" style={{ fontSize: 12.5 }}>Couldn't load detail.</span>
                        )}
                        {detail?.data && <AssignmentDetail data={detail.data} />}
                      </td>
                    </tr>
                  )}
                </Fragment>
              )
            })}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function AssignmentSummary({ assignment: a, exporting, onExport }) {
  const stats = [
    { label: 'Sites assigned', value: a.task_count ?? '—' },
    { label: 'Became Ready', value: a.sites_ready ?? '—', color: 'var(--green)' },
    { label: 'Became Not Ready', value: a.sites_not_ready ?? '—', color: 'var(--red)' },
    ...(a.sites_pending ? [{ label: 'Pending feedback', value: a.sites_pending }] : []),
    { label: 'Assignment date', value: formatDate(a.created_at) },
    { label: 'Feedback received', value: a.feedback_received_at ? formatDate(a.feedback_received_at) : 'Awaiting' },
    { label: 'Aging (assign → feedback)', value: formatAging(a) },
  ]
  return (
    <div
      className="row between wrap"
      style={{ gap: 16, alignItems: 'flex-end', paddingBottom: 10, marginBottom: 10, borderBottom: '1px solid var(--border-soft)' }}
    >
      <div className="row wrap" style={{ gap: 18 }}>
        {stats.map((s) => (
          <div key={s.label} style={{ display: 'flex', flexDirection: 'column', gap: 2 }}>
            <span className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3 }}>{s.label}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: s.color || 'var(--text)' }}>{s.value}</span>
          </div>
        ))}
      </div>
      <button className="btn btn-sm" onClick={onExport} disabled={exporting} title="Export this assignment's feedback to Excel">
        {exporting ? <div className="spinner" /> : <><Download size={14} /> Export feedback</>}
      </button>
    </div>
  )
}

function AssignmentDetail({ data }) {
  const tasks = data.tasks || []
  if (tasks.length === 0) {
    return <span className="dim" style={{ fontSize: 12.5 }}>No sites in this assignment.</span>
  }
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      {tasks.map((t) => (
        <div key={t.work_item_id} style={{ borderBottom: '1px solid var(--border-soft)', paddingBottom: 8 }}>
          <div className="row wrap" style={{ gap: 10, alignItems: 'center' }}>
            <span className="text-data" style={{ fontWeight: 600, minWidth: 90 }}>{t.site_code || `#${t.work_item_id}`}</span>
            <span className="pill pill-dim">{t.site_type}</span>
            {(t.requested_technologies || []).map((tech) => (
              <span key={tech} className="pill pill-dim" style={{ fontSize: 11 }}>{tech}</span>
            ))}
            <span style={{ flex: 1 }} />
            <Outcome task={t} />
          </div>
          {(t.technologies || []).some((x) => x.result === 'NotNormal') && (
            <div style={{ marginTop: 6, paddingLeft: 4, display: 'flex', flexDirection: 'column', gap: 3 }}>
              {t.technologies.filter((x) => x.result === 'NotNormal').map((x) => (
                <div key={x.technology} className="dim" style={{ fontSize: 12 }}>
                  <b className="text-data">{x.technology}</b> — Not Normal{x.comment ? `: ${x.comment}` : ''}
                </div>
              ))}
              {t.problem_category && (
                <div style={{ fontSize: 12, color: 'var(--amber-strong, var(--amber))' }}>
                  Category: <b>{t.problem_category}</b>{t.reviewed ? ' · validated' : ' · pending validation'}
                </div>
              )}
            </div>
          )}
        </div>
      ))}
    </div>
  )
}

function Outcome({ task }) {
  if (!task.overall_result) {
    return <span className="dim" style={{ fontSize: 12.5 }}>Pending</span>
  }
  if (task.overall_result === 'Ready') {
    return (
      <span className="row" style={{ gap: 4, color: 'var(--green)', fontSize: 12.5, fontWeight: 500 }}>
        <CheckCircle2 size={14} /> Ready
      </span>
    )
  }
  return (
    <span className="row" style={{ gap: 4, color: 'var(--red)', fontSize: 12.5, fontWeight: 500 }}>
      <XCircle size={14} /> Not Ready
    </span>
  )
}

function formatDate(iso) {
  try {
    return new Date(iso).toLocaleString(undefined, {
      year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
    })
  } catch {
    return iso
  }
}

function formatAging(a) {
  if (a?.aging_days == null) return '—'
  const unit = a.aging_days === 1 ? 'day' : 'days'
  return `${a.aging_days} ${unit}${a.aging_ongoing ? ' (ongoing)' : ''}`
}
