import { useEffect, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client'
import Icon from '../components/Icon'
import { useToast } from '../context/ToastContext'
import { EmptyState, Loading, Modal, PageHead } from '../components/ui'
import { formatNumber } from '../lib/numbers'
import { typeLabel } from './explorer/listModel'
import '../styles/my-health-check.css'

const hoursLeft = (due) => (due ? (new Date(due).getTime() - Date.now()) / 3600000 : null)

/** Yellow "Due in 23 h" while open (red "Late 2 h" past it); green "Completed". */
function StatusPill({ assignment }) {
  if (assignment.status === 'Completed') return <span className="mhc-pill is-green">Completed</span>
  const left = hoursLeft(assignment.due_at)
  if (left == null) return <span className="mhc-pill is-yellow">{assignment.status}</span>
  const text = (h) => (h >= 24 ? `${Math.floor(h / 24)} d` : `${Math.max(1, Math.ceil(h))} h`)
  return left < 0
    ? <span className="mhc-pill is-red">Late {text(-left)}</span>
    : <span className="mhc-pill is-yellow">Due in {text(left)}</span>
}

/**
 * A contractor's own health checks (UEP-31 §6): their assignments on the
 * left, the open one's sites on the right. A result is sent once per site and
 * then locked.
 */
export default function MyHealthCheck() {
  const [assignments, setAssignments] = useState(null)
  const [activeId, setActiveId] = useState(null)
  // Deep-linked from Action Center: ?assignment=<id>&task=<id> opens the
  // assignment and that site's form.
  const [searchParams] = useSearchParams()
  const deepLinkAssignmentId = searchParams.get('assignment')
  const deepLinkTaskId = searchParams.get('task')
  const [autoOpenedTask, setAutoOpenedTask] = useState(false)

  function load() {
    api.get('/hc/my/assignments').then((r) => setAssignments(r.data)).catch(() => setAssignments([]))
  }
  useEffect(load, [])

  useEffect(() => {
    if (!assignments?.length || activeId != null) return
    const linked = assignments.find((a) => String(a.id) === String(deepLinkAssignmentId))
    setActiveId((linked || assignments.find((a) => a.status !== 'Completed') || assignments[0]).id)
  }, [assignments, deepLinkAssignmentId, activeId])

  if (!assignments) return <Loading label="Loading your assignments" />
  const active = assignments.find((a) => a.id === activeId) || null

  return (
    <>
      <PageHead title="Health check" />
      {assignments.length === 0 ? (
        <div className="card card-pad"><EmptyState title="No assignments yet" /></div>
      ) : (
        <div className="mhc-layout">
          <div className="mhc-cards">
            {assignments.map((a) => (
              <AssignmentCard key={a.id} assignment={a} active={a.id === activeId} onOpen={() => setActiveId(a.id)} />
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
  const sent = assignment.tasks.filter((t) => t.overall_result).length
  return (
    <button type="button" className="mhc-card" aria-pressed={active} onClick={onOpen}>
      <span className="mhc-card-head">
        {assignment.code}
        <StatusPill assignment={assignment} />
      </span>
      <span className="mhc-card-sent">{formatNumber(sent)} of {formatNumber(total)} {total === 1 ? 'site' : 'sites'} sent</span>
      <span className="mhc-bar" aria-hidden="true"><i style={{ width: `${total ? (sent / total) * 100 : 0}%` }} /></span>
    </button>
  )
}

function Result({ value }) {
  if (value === 'Ready') return <span className="mhc-result is-ready"><i aria-hidden="true" />Ready</span>
  if (value === 'NotReady') return <span className="mhc-result is-not-ready"><i aria-hidden="true" />Not ready</span>
  return <span className="mhc-result is-pending"><i aria-hidden="true" />Pending</span>
}

function AssignmentDetail({ assignment, onRefresh, autoOpenTaskId, onAutoOpened }) {
  const toast = useToast()
  const fileRef = useRef(null)
  const [openTask, setOpenTask] = useState(null)
  const tasks = assignment.tasks

  useEffect(() => {
    if (!autoOpenTaskId) return
    const task = tasks.find((t) => String(t.id) === String(autoOpenTaskId))
    if (task && !task.overall_result) setOpenTask(task)
    onAutoOpened?.()
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
      toast.success('Bulk upload applied', `${formatNumber(data.sites_applied)} sites updated.`)
      onRefresh?.()
    } catch (err) {
      toast.error('Upload failed', err.response?.data?.detail || 'Check the file and try again.')
    }
  }

  return (
    <section className="mhc-detail" aria-label={`Sites in ${assignment.code}`}>
      <header className="mhc-detail-head">
        <h2>{assignment.code}</h2>
        <button type="button" className="btn btn-sm" onClick={downloadTemplate}><Icon name="download" size={16} /> Template</button>
        <button type="button" className="btn btn-sm" onClick={() => fileRef.current?.click()}><Icon name="upload" size={16} /> Bulk upload</button>
        <input ref={fileRef} type="file" accept=".xlsx,.xls" hidden aria-label="Bulk upload file" onChange={(e) => uploadTemplate(e.target.files[0])} />
      </header>
      <div className="mhc-scroll">
        <table className="mhc-table">
          <thead>
            <tr>
              <th scope="col">Site ID</th>
              <th scope="col">Site type</th>
              <th scope="col">Province</th>
              <th scope="col">Technologies</th>
              <th scope="col">Result</th>
              <th scope="col"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {tasks.map((t) => (
              <tr key={t.id}>
                <td className="mhc-site">{t.site_code || `#${t.work_item_id}`}</td>
                <td>{typeLabel(t.site_type) || '—'}</td>
                <td><bdi dir="rtl" lang="fa" className="mhc-fa">{t.province || '—'}</bdi></td>
                <td>
                  <span className="mhc-techs">
                    {(t.requested_technologies || []).map((x) => <span key={x} className="mhc-tech">{x}</span>)}
                  </span>
                </td>
                <td><Result value={t.overall_result} /></td>
                <td>
                  {t.overall_result ? (
                    <span className="mhc-locked"><Icon name="locked" size={16} /> Locked</span>
                  ) : (
                    <button type="button" className="btn btn-sm" onClick={() => setOpenTask(t)}>Fill</button>
                  )}
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
    </section>
  )
}

function TaskFormModal({ task, onClose, onSaved }) {
  const toast = useToast()
  const techs = task.requested_technologies || []
  const [rows, setRows] = useState(() => Object.fromEntries(techs.map((t) => [t, { result: '', comment: '' }])))
  const [busy, setBusy] = useState(false)

  const setField = (tech, field, value) => setRows((r) => ({ ...r, [tech]: { ...r[tech], [field]: value } }))

  async function save() {
    setBusy(true)
    try {
      const technology_results = techs.map((tech) => ({
        technology: tech,
        result: rows[tech].result,
        comment: rows[tech].result === 'NotNormal' ? rows[tech].comment : null,
      }))
      await api.post(`/hc/tasks/${task.id}/result`, { technology_results })
      toast.success('Result sent', `${task.site_code || 'The site'} is locked.`)
      onSaved()
    } catch (err) {
      toast.error('Could not send', err.response?.data?.detail || 'Please check the entries.')
    } finally {
      setBusy(false)
    }
  }

  // Every technology answered; a Not normal one needs a comment.
  const valid = techs.length > 0 && techs.every((t) => {
    const r = rows[t]
    return r.result === 'Normal' || (r.result === 'NotNormal' && r.comment.trim().length > 0)
  })

  return (
    <Modal
      open
      size="sm"
      onClose={onClose}
      title={task.site_code || `Site #${task.work_item_id}`}
      footer={
        <div className="mhc-modal-foot">
          <button type="button" className="btn btn-primary" disabled={!valid || busy} aria-busy={busy || undefined} onClick={save}>Send result</button>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Cancel</button>
          <span className="mhc-locked"><Icon name="locked" size={16} /> Locked after sending</span>
        </div>
      }
    >
      <p className="mhc-modal-sub">
        {[typeLabel(task.site_type), task.province].filter(Boolean).join(' · ')}
      </p>
      <div className="mhc-techrows">
        {techs.map((tech) => (
          <div key={tech} className="mhc-techrow">
            <div className="mhc-techrow-head">
              <b>{tech}</b>
              <span className="mhc-toggle" role="group" aria-label={`${tech} result`}>
                <button type="button" className="is-normal" aria-pressed={rows[tech].result === 'Normal'} onClick={() => setField(tech, 'result', 'Normal')}>Normal</button>
                <button type="button" className="is-not-normal" aria-pressed={rows[tech].result === 'NotNormal'} onClick={() => setField(tech, 'result', 'NotNormal')}>Not normal</button>
              </span>
            </div>
            {rows[tech].result === 'NotNormal' && (
              <input
                className="input"
                aria-label={`Problem on ${tech}`}
                required
                value={rows[tech].comment}
                onChange={(e) => setField(tech, 'comment', e.target.value)}
              />
            )}
          </div>
        ))}
      </div>
    </Modal>
  )
}
