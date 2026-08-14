import { motion } from 'framer-motion'
import { Download, Upload, ChevronRight, CheckCircle2, XCircle, Info, HelpCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client'
import { useToast } from '../context/ToastContext'
import { EmptyState, Loading, PageHead } from '../components/ui'

export default function MyHealthCheck() {
  const [assignments, setAssignments] = useState(null)
  const [active, setActive] = useState(null)
  // Deep-linked from Action Center: ?assignment=<id>&task=<id> auto-opens the
  // assignment and jumps straight into that site's submission form.
  const [searchParams] = useSearchParams()
  const deepLinkAssignmentId = searchParams.get('assignment')
  const deepLinkTaskId = searchParams.get('task')
  const [autoOpenedTask, setAutoOpenedTask] = useState(false)

  function load() {
    api.get('/hc/my/assignments').then((r) => {
      setAssignments(r.data)
      // keep the open assignment in sync after a submit
      setActive((cur) => (cur ? r.data.find((a) => a.id === cur.id) || null : null))
    }).catch(() => setAssignments([]))
  }
  useEffect(load, [])

  useEffect(() => {
    if (!assignments || !deepLinkAssignmentId) return
    const match = assignments.find((a) => String(a.id) === String(deepLinkAssignmentId))
    if (match) setActive(match)
  }, [assignments, deepLinkAssignmentId])

  if (!assignments) return <Loading label="Loading your assignments" />

  return (
    <>
      <PageHead
        eyebrow="Field Team"
        title="My Health Check Assignments"
        subtitle="Submit Ready / Not Ready per technology, in-app or by bulk Excel upload."
      />
      {assignments.length === 0 ? (
        <div className="card card-pad"><EmptyState title="No assignments yet" hint="Health check assignments appear here." /></div>
      ) : (
        <div className="grid" style={{ gridTemplateColumns: active ? '0.85fr 1.5fr' : '1fr', gap: 16, alignItems: 'start' }}>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {assignments.map((a) => (
              <AssignmentCard key={a.id} assignment={a} active={active?.id === a.id} onOpen={() => setActive(a)} />
            ))}
          </div>
          {active && (
            <AssignmentDetail
              key={active.id}
              assignment={active}
              onRefresh={load}
              autoOpenTaskId={!autoOpenedTask ? deepLinkTaskId : null}
              onAutoOpened={() => setAutoOpenedTask(true)}
            />
          )}
        </div>
      )}
    </>
  )
}

function AssignmentCard({ assignment, active, onOpen }) {
  const total = assignment.tasks.length
  const done = assignment.tasks.filter((t) => t.overall_result).length
  return (
    <motion.div
      className="card card-pad"
      whileHover={{ y: -2 }}
      onClick={onOpen}
      style={{ cursor: 'pointer', borderColor: active ? 'var(--signal)' : 'var(--border)', borderWidth: active ? 1.5 : 1 }}
    >
      <div className="row between">
        <span style={{ fontWeight: 600, fontSize: 14 }}>{assignment.title || assignment.code}</span>
        <span className={`pill ${assignment.status === 'Completed' ? 'pill-green' : 'pill-amber'}`}>{assignment.status}</span>
      </div>
      <div className="row between" style={{ marginTop: 10 }}>
        <span className="dim" style={{ fontSize: 12.5 }}>{done}/{total} sites done</span>
        <ChevronRight size={16} style={{ color: 'var(--text-dim)' }} />
      </div>
      <div style={{ height: 5, background: 'var(--surface-3)', borderRadius: 3, marginTop: 8, overflow: 'hidden' }}>
        <div style={{ width: `${total ? (done / total) * 100 : 0}%`, height: '100%', background: 'var(--green)' }} />
      </div>
    </motion.div>
  )
}

function AssignmentDetail({ assignment, onRefresh, autoOpenTaskId, onAutoOpened }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [openTask, setOpenTask] = useState(null)
  const tasks = assignment.tasks

  useEffect(() => {
    if (!autoOpenTaskId) return
    const task = tasks.find((t) => String(t.id) === String(autoOpenTaskId))
    if (task) {
      setOpenTask(task)
      onAutoOpened?.()
    }
  }, [autoOpenTaskId, tasks])

  async function downloadTemplate() {
    try {
      const res = await api.get(`/hc/assignments/${assignment.id}/template`, { responseType: 'blob' })
      const url = URL.createObjectURL(res.data)
      const a = document.createElement('a')
      a.href = url
      a.download = `${assignment.code}_healthcheck.xlsx`
      a.click()
      URL.revokeObjectURL(url)
    } catch {
      toast.error('Download failed', 'Could not generate the template.')
    }
  }

  async function uploadTemplate(file) {
    if (!file) return
    const form = new FormData()
    form.append('file', file)
    try {
      const { data } = await api.post(`/hc/assignments/${assignment.id}/upload`, form, {
        headers: { 'Content-Type': 'multipart/form-data' },
      })
      toast.success('Bulk upload applied', `${data.sites_applied} sites updated.`)
      onRefresh?.()
    } catch (err) {
      toast.error('Upload failed', err.response?.data?.detail || 'Check the file and try again.')
    }
  }

  return (
    <motion.div className="card" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }} style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div className="row between wrap" style={{ gap: 10 }}>
          <div>
            <h3 style={{ fontSize: 15 }}>{assignment.title || assignment.code}</h3>
            <span className="dim" style={{ fontSize: 12.5 }}>{tasks.length} sites</span>
          </div>
          <div className="row" style={{ gap: 8 }}>
            <button className="btn btn-sm" onClick={downloadTemplate}><Download size={14} /> Template</button>
            <button className="btn btn-sm btn-primary" onClick={() => fileRef.current?.click()}><Upload size={14} /> Bulk upload</button>
            <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden onChange={(e) => uploadTemplate(e.target.files[0])} />
          </div>
        </div>
      </div>

      <div style={{ maxHeight: 520, overflowY: 'auto' }}>
        <table>
          <thead>
            <tr>
              <th>Site ID</th>
              <th>Type</th>
              <th>Province</th>
              <th>Tech</th>
              <th>Result</th>
              <th style={{ width: 80 }}></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="text-data" style={{ fontWeight: 500 }}>{t.site_code || `#${t.work_item_id}`}</td>
                <td className="text-data">{t.site_type || '—'}</td>
                <td className="text-data dim">{t.province || '—'}</td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    {(t.requested_technologies || []).map((x) => (
                      <span key={x} className="pill pill-dim" style={{ fontSize: 11 }}>{x}</span>
                    ))}
                  </div>
                </td>
                <td>
                  {t.overall_result === 'Ready' && <span className="row" style={{ gap: 5, color: 'var(--green)', fontSize: 13 }}><CheckCircle2 size={14} /> Ready</span>}
                  {t.overall_result === 'NotReady' && <span className="row" style={{ gap: 5, color: 'var(--red)', fontSize: 13 }}><XCircle size={14} /> Not Ready</span>}
                  {!t.overall_result && <span className="dim" style={{ fontSize: 12.5 }}>Pending</span>}
                </td>
                <td>
                  <button className="btn btn-sm" onClick={() => setOpenTask(t)}>
                    {t.overall_result ? 'Edit' : 'Fill'}
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {openTask && (
        <TaskFormModal
          task={openTask}
          onClose={() => setOpenTask(null)}
          onSaved={() => { setOpenTask(null); onRefresh?.() }}
        />
      )}
    </motion.div>
  )
}

function TaskFormModal({ task, onClose, onSaved }) {
  const toast = useToast()
  // Requested technologies come straight from the task payload now — no
  // extra work-items API call (which contractors can't access anyway).
  const techs = task.requested_technologies || []
  const [rows, setRows] = useState(() => {
    const initial = {}
    for (const tech of techs) {
      const existing = task.technologies?.find((x) => x.technology === tech)
      initial[tech] = {
        result: existing?.result || '', // blank = force an explicit choice
        comment: existing?.comment || '',
      }
    }
    return initial
  })
  const [busy, setBusy] = useState(false)

  function setField(tech, field, value) {
    setRows((r) => ({ ...r, [tech]: { ...r[tech], [field]: value } }))
  }

  async function save() {
    setBusy(true)
    try {
      const technology_results = techs.map((tech) => {
        const row = rows[tech]
        const isNot = row.result === 'NotNormal'
        return {
          technology: tech,
          result: row.result,
          comment: isNot ? row.comment : null,
        }
      })
      await api.post(`/hc/tasks/${task.id}/result`, { technology_results })
      toast.success('Result saved', 'Health check submitted for this site.')
      onSaved()
    } catch (err) {
      toast.error('Save failed', err.response?.data?.detail || 'Please check the entries.')
    } finally {
      setBusy(false)
    }
  }

  // Valid = every technology has a Normal/NotNormal chosen, and any NotNormal
  // has a comment.
  const valid = techs.length > 0 && techs.every((t) => {
    const r = rows[t]
    if (!r || !r.result) return false
    if (r.result === 'NotNormal') return r.comment.trim().length > 0
    return true
  })

  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,50,0.45)', display: 'grid', placeItems: 'center', zIndex: 200 }} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 16, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        className="card card-pad"
        style={{ width: 540, maxHeight: '88vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <h3 style={{ fontSize: 16 }}>
          Health check · {task.site_code || `Site #${task.work_item_id}`}
        </h3>
        <div className="row" style={{ gap: 10, marginTop: 4, marginBottom: 14 }}>
          {task.site_type && <span className="pill pill-dim">{task.site_type}</span>}
          {task.province && <span className="text-data dim" style={{ fontSize: 12.5 }}>{task.province}</span>}
        </div>

        {/* Tutorial */}
        <div style={{ background: 'var(--signal-glow)', borderRadius: 'var(--radius-sm)', padding: '11px 13px', marginBottom: 16, display: 'flex', gap: 9 }}>
          <Info size={16} style={{ color: 'var(--signal-strong)', flexShrink: 0, marginTop: 1 }} />
          <div style={{ fontSize: 12.5, lineHeight: 1.6, color: 'var(--text-muted)' }}>
            For each technology below, pick <b>Normal</b> if the site is fine for that
            technology. Pick <b>Not Normal</b> if there's a problem — then write a short
            <b> comment</b> explaining it. When all technologies are Normal the site
            becomes <b>Ready</b>; if any is Not Normal it becomes <b>Not Ready</b>. A
            coordinator will review and categorise any problems afterwards.
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
          {techs.map((tech) => (
            <div key={tech} style={{ border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: 12 }}>
              <div className="row between">
                <span style={{ fontWeight: 600, fontSize: 15 }}>{tech}</span>
                <div className="row" style={{ gap: 6 }}>
                  <ToggleBtn active={rows[tech]?.result === 'Normal'} onClick={() => setField(tech, 'result', 'Normal')} color="var(--green)">Normal</ToggleBtn>
                  <ToggleBtn active={rows[tech]?.result === 'NotNormal'} onClick={() => setField(tech, 'result', 'NotNormal')} color="var(--red)">Not Normal</ToggleBtn>
                </div>
              </div>
              {rows[tech]?.result === 'NotNormal' && (
                <div style={{ marginTop: 10, display: 'flex', flexDirection: 'column', gap: 8 }}>
                  <div>
                    <label style={{ fontSize: 12, color: 'var(--text-dim)', display: 'block', marginBottom: 3 }}>Comment</label>
                    <input className="input" placeholder="Describe the problem…" value={rows[tech].comment} onChange={(e) => setField(tech, 'comment', e.target.value)} />
                  </div>
                </div>
              )}
              {!rows[tech]?.result && (
                <div className="row" style={{ gap: 5, marginTop: 8, color: 'var(--text-dim)', fontSize: 11.5 }}>
                  <HelpCircle size={13} /> Choose Normal or Not Normal
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="row mt-16" style={{ gap: 8 }}>
          <button className="btn btn-primary" disabled={!valid || busy} onClick={save}>
            {busy ? <div className="spinner" /> : 'Submit result'}
          </button>
          <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
        </div>
        {!valid && techs.length > 0 && (
          <p className="dim" style={{ fontSize: 11.5, marginTop: 8 }}>
            Set every technology (and add a comment for any "Not Normal") to submit.
          </p>
        )}
      </motion.div>
    </div>
  )
}

function ToggleBtn({ active, onClick, color, children }) {
  return (
    <button
      className="btn btn-sm"
      onClick={onClick}
      style={{
        background: active ? color : 'var(--surface-2)',
        color: active ? '#fff' : 'var(--text-muted)',
        border: active ? 'none' : '1px solid var(--border)',
      }}
    >
      {children}
    </button>
  )
}
