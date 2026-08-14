import { motion } from 'framer-motion'
import { ArrowLeft, CheckCircle2, CornerUpLeft, Radio, XCircle } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { ConfirmDialog, Loading, PageHead, StatusPill } from '../components/ui'

const TECHS = ['2G', '3G', '4G']

export default function WorkItemDetail() {
  const { id } = useParams()
  const navigate = useNavigate()
  const toast = useToast()
  const { user } = useAuth()
  const [wi, setWi] = useState(null)
  const [contractors, setContractors] = useState([])
  const role = user?.role?.name

  async function load() {
    const { data } = await api.get(`/work-items/${id}`)
    setWi(data)
  }

  useEffect(() => {
    load().catch(() => setWi(false))
    api.get('/reference/contractors').then((r) => setContractors(r.data)).catch(() => {})
  }, [id])

  if (wi === false) return <div className="card"><div className="empty">Work item not found or not visible to you.</div></div>
  if (!wi) return <Loading label="Loading work item" />

  const can = (roles) => roles.includes(role)

  async function action(fn, okMsg) {
    try {
      await fn()
      toast.success(okMsg)
      await load()
    } catch (err) {
      toast.error('Action failed', err.response?.data?.detail || 'Please try again.')
    }
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm mb-16" onClick={() => navigate('/work-items')}>
        <ArrowLeft size={16} /> Back to work items
      </button>

      <PageHead
        eyebrow={`Work Item #${wi.id}`}
        title={`${wi.site_type}`}
        subtitle={wi.project_name || 'No project name'}
        actions={<StatusPill status={wi.current_stage} />}
      />

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        {/* Details */}
        <motion.div className="card card-pad" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>Details</h3>
          <DetailRow label="Requested Technology" value={wi.requested_technology} />
          <DetailRow label="Deployed Technology" value={wi.deployed_technology} />
          <DetailRow label="Project Manager" value={wi.pm_name} />
          <DetailRow label="Power Status" value={wi.power_status} />
          <DetailRow label="Villages (target)" value={wi.villages.length} />
        </motion.div>

        {/* Workflow actions */}
        <motion.div className="card card-pad" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>Workflow actions</h3>

          {can(['Admin', 'PM']) && (
            <AssignAction contractors={contractors} onSubmit={(payload) =>
              action(() => api.post(`/work-items/${id}/assignment`, payload), 'Contractor assigned')
            } />
          )}

          {can(['Admin', 'PM', 'Contractor']) && wi.current_stage === 'Assigned' && (
            <DriveTestSubmitAction onSubmit={(payload) =>
              action(() => api.post(`/work-items/${id}/drive-test`, payload), 'Drive test submitted to coordinator')
            } />
          )}

          {can(['Contractor']) && wi.current_stage === 'Assigned' && (
            <ReturnToCoordinatorAction onSubmit={(payload) =>
              action(() => api.post(`/work-items/${id}/return-to-coordinator`, payload), 'Site returned to coordinator')
            } />
          )}

          {can(['Admin', 'Coordinator']) && wi.current_stage === 'DT Submitted' && wi.active_drive_test_id && (
            <CoordinatorReviewAction
              submissionDate={wi.dt_submission_date}
              onDecide={(payload) =>
                action(
                  () => api.post(`/drive-tests/${wi.active_drive_test_id}/coordinator-review`, payload),
                  payload.decision === 'Approved' ? 'Drive test approved' : 'Drive test rejected'
                )
              }
            />
          )}

          {!can(['Admin', 'PM']) &&
            !(can(['Contractor']) && wi.current_stage === 'Assigned') &&
            !(can(['Coordinator']) && wi.current_stage === 'DT Submitted') && (
              <p className="dim" style={{ fontSize: 13 }}>
                No actions available at the current stage ({wi.current_stage}).
              </p>
            )}
        </motion.div>
      </div>

      {/* Villages & acceptance */}
      <motion.div className="card mt-24" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.12 }}>
        <div className="card-pad"><h3 style={{ fontSize: 15 }}>Villages & acceptance</h3></div>
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0 }}>
          <table>
            <thead>
              <tr>
                <th>Village</th>
                <th>Code</th>
                {TECHS.map((t) => <th key={t}>{t} ICT / CRA</th>)}
              </tr>
            </thead>
            <tbody>
              {wi.villages.map((v) => (
                <tr key={v.id}>
                  <td style={{ fontWeight: 500 }}>{v.village_name || '—'}</td>
                  <td className="dim tnum">{v.village_code || '—'}</td>
                  {TECHS.map((t) => {
                    const acc = v.acceptances.find((a) => a.technology === t)
                    return (
                      <td key={t}>
                        <div className="row" style={{ gap: 6 }}>
                          <StatusPill status={acc?.ict_status || 'Pending'} />
                          <StatusPill status={acc?.cra_status || 'Pending'} />
                        </div>
                      </td>
                    )
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </motion.div>
    </>
  )
}

function DetailRow({ label, value }) {
  return (
    <div className="row between" style={{ padding: '8px 0', borderBottom: '1px solid var(--border-soft)' }}>
      <span className="muted" style={{ fontSize: 13 }}>{label}</span>
      <span style={{ fontWeight: 500 }}>{value || '—'}</span>
    </div>
  )
}

function AssignAction({ contractors, onSubmit }) {
  const [contractorId, setContractorId] = useState('')
  const [type, setType] = useState('first')
  return (
    <div className="mb-16">
      <div className="field">
        <label>Assignment type</label>
        <select className="input" value={type} onChange={(e) => setType(e.target.value)}>
          <option value="first">First (initial)</option>
          <option value="official">Official</option>
        </select>
      </div>
      <div className="field">
        <label>Contractor</label>
        <select className="input" value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
          <option value="">Select…</option>
          {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <button
        className="btn"
        style={{ width: '100%', justifyContent: 'center' }}
        disabled={!contractorId}
        onClick={() => onSubmit({ assignment_type: type, contractor_id: Number(contractorId) })}
      >
        Assign contractor
      </button>
    </div>
  )
}

// Contractor records the drive test date and submits — nothing more is
// required. The coordinator picks it up for approval; approving is what
// marks the site DT-Done on the Drive Test dashboard.
function DriveTestSubmitAction({ onSubmit }) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [busy, setBusy] = useState(false)

  const submit = async () => {
    setBusy(true)
    await onSubmit({ execution_date: date })
    setBusy(false)
  }

  // Most drive tests are logged the day of, or the day after. Two chips cover
  // the overwhelming majority of entries; the field itself stays available
  // for anything older, so nobody has to fight a calendar for the common case.
  const shift = (days) => {
    const d = new Date()
    d.setDate(d.getDate() - days)
    return d.toISOString().slice(0, 10)
  }
  const quick = [
    { label: 'Today', value: today },
    { label: 'Yesterday', value: shift(1) },
  ]

  return (
    <div
      className="mb-16"
      style={{ padding: 16, borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', border: '1px solid var(--border-soft)' }}
    >
      <div className="row" style={{ gap: 6, marginBottom: 12, color: 'var(--signal)' }}>
        <Radio size={15} />
        <b style={{ fontSize: 13.5 }}>Submit Drive Test</b>
      </div>

      <div className="row" style={{ gap: 6, marginBottom: 10 }}>
        {quick.map((q) => (
          <button
            key={q.label}
            className={`btn btn-sm ${date === q.value ? 'btn-primary' : ''}`}
            onClick={() => setDate(q.value)}
          >
            {q.label}
          </button>
        ))}
      </div>

      <div className="field">
        <label>Drive test date</label>
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          max={today}
          style={{ fontFamily: 'var(--font-mono, inherit)', fontVariantNumeric: 'tabular-nums' }}
        />
      </div>

      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!date || busy} onClick={submit}>
        {busy ? 'Submitting…' : 'Submit to coordinator'}
      </button>
    </div>
  )
}

// The coordinator's decision point. Approving is terminal — it moves the site
// to its final stage AND writes dt_status='Done' through to the work item,
// which is what makes the Drive Test dashboard's DT Done KPI move. Rejecting
// sends it back to the contractor with a comment.
function CoordinatorReviewAction({ submissionDate, onDecide }) {
  const [comment, setComment] = useState('')
  const [pending, setPending] = useState(null) // 'Approved' | 'Rejected' | null
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    await onDecide({ decision: pending, comment: comment || null })
    setBusy(false)
    setPending(null)
    setComment('')
  }

  return (
    <div
      className="mb-16"
      style={{ padding: 16, borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', border: '1px solid var(--border-soft)' }}
    >
      <div className="row" style={{ gap: 6, marginBottom: 10, color: 'var(--amber)' }}>
        <CheckCircle2 size={15} />
        <b style={{ fontSize: 13.5 }}>Drive test awaiting your validation</b>
      </div>

      <div className="row between" style={{ padding: '8px 0', marginBottom: 8 }}>
        <span className="muted" style={{ fontSize: 13 }}>Submitted for</span>
        <span className="tnum" style={{ fontWeight: 500 }}>{submissionDate || '—'}</span>
      </div>

      <div className="field">
        <label>Comment (required when rejecting)</label>
        <textarea
          className="input"
          rows={2}
          value={comment}
          onChange={(e) => setComment(e.target.value)}
          placeholder="Optional note for the contractor"
        />
      </div>

      <div className="row" style={{ gap: 8 }}>
        <button
          className="btn btn-primary"
          style={{ flex: 1, justifyContent: 'center' }}
          onClick={() => setPending('Approved')}
        >
          <CheckCircle2 size={15} /> Approve
        </button>
        <button
          className="btn"
          style={{ flex: 1, justifyContent: 'center', color: 'var(--red)', borderColor: 'var(--red)' }}
          disabled={comment.trim().length < 3}
          onClick={() => setPending('Rejected')}
        >
          <XCircle size={15} /> Reject
        </button>
      </div>

      <ConfirmDialog
        open={pending !== null}
        title={pending === 'Approved' ? 'Approve this drive test?' : 'Reject this drive test?'}
        message={
          pending === 'Approved'
            ? 'This completes the drive test for this site. It will be marked DT Done and counted on the Drive Test dashboard. This is the final step — there is no further approval.'
            : 'The contractor will be notified and can resubmit. The site returns to their queue.'
        }
        confirmLabel={pending === 'Approved' ? 'Yes, approve' : 'Yes, reject'}
        danger={pending === 'Rejected'}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setPending(null)}
      />
    </div>
  )
}

// The small fraction of assignments a contractor genuinely can't proceed
// with (road blocked, site down, access denied...). Hands the site back to
// the coordinator/PM queue with a required reason, instead of forcing a
// pointless drive-test submission.
function ReturnToCoordinatorAction({ onSubmit }) {
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    await onSubmit({ reason })
    setBusy(false)
    setConfirming(false)
    setReason('')
  }

  return (
    <div style={{ padding: 14, borderRadius: 'var(--radius-sm)', border: '1px dashed var(--border)' }}>
      <div className="row" style={{ gap: 6, marginBottom: 10, color: 'var(--text-muted)' }}>
        <CornerUpLeft size={15} />
        <b style={{ fontSize: 13.5 }}>Can't proceed with this site?</b>
      </div>
      <div className="field">
        <label>Reason (road blocked, site down, access denied…)</label>
        <textarea
          className="input"
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Describe why this site can't be drive-tested right now"
        />
      </div>
      <button
        className="btn"
        style={{ width: '100%', justifyContent: 'center' }}
        disabled={reason.trim().length < 3}
        onClick={() => setConfirming(true)}
      >
        Return to coordinator
      </button>

      <ConfirmDialog
        open={confirming}
        title="Return this site to the coordinator?"
        message="The coordinator and PM will be notified with your reason, and this site leaves your queue until it's reassigned."
        confirmLabel="Yes, return it"
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setConfirming(false)}
      />
    </div>
  )
}
