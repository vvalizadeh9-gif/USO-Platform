import { motion } from 'framer-motion'
import { ArrowLeft, CheckCircle2, CornerUpLeft, Paperclip, Radio, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { canReview } from '../lib/roles'
import { useToast } from '../context/ToastContext'
import { ConfirmDialog, Loading, PageHead, StatusPill } from '../components/ui'

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
  const isContractor = role === 'Contractor'
  // PM and Coordinator are peers over this lifecycle. The three guards below
  // used to name three different sets -- assignment was ['Admin','PM'],
  // drive-test review was ['Admin','Coordinator'] -- and both included Admin,
  // whom the server refuses on either.
  const mayDecide = canReview(user)

  // Returns the response body: the drive-test submission needs the new
  // drive_test_id back so it can attach the report to it.
  async function action(fn, okMsg) {
    try {
      const res = await fn()
      toast.success(okMsg)
      await load()
      return res?.data
    } catch (err) {
      toast.error('Action failed', err.response?.data?.detail || 'Please try again.')
      return undefined
    }
  }

  return (
    <>
      <button className="btn btn-ghost btn-sm mb-16" onClick={() => navigate('/work-items')}>
        <ArrowLeft size={16} /> Back to work items
      </button>

      <PageHead
        eyebrow={`Work Item #${wi.id}`}
        title={wi.site_code || wi.site_type}
        subtitle={isContractor ? wi.province || '' : wi.project_name || 'No project name'}
        actions={<StatusPill status={wi.current_stage} />}
      />

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        {/* Details.
            A subcontractor is shown the assignment and nothing else: which
            site, where, since when, and how long it has been theirs. Project
            manager, power status and deployed technology are the operator's
            internal picture of the site, and a contractor reading them can
            only be misled about which of them is their business. */}
        <motion.div className="card card-pad" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>Details</h3>
          <DetailRow label="Site ID" value={wi.site_code} />
          <DetailRow label="Province" value={wi.province} />
          <DetailRow label="Site Type" value={wi.site_type} />
          {!isContractor && (
            <>
              <DetailRow label="Requested Technology" value={wi.requested_technology} />
              <DetailRow label="Deployed Technology" value={wi.deployed_technology} />
              <DetailRow label="Project Manager" value={wi.pm_name} />
              <DetailRow label="Power Status" value={wi.power_status} />
            </>
          )}
          <DetailRow label="Assignment Date" value={fmtDate(wi.assignment_date)} />
          <DetailRow
            label="Aging (from assigned date)"
            value={<Aging days={wi.assigned_aging_days} />}
          />
        </motion.div>

        {/* Workflow actions */}
        <motion.div className="card card-pad" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: 0.08 }}>
          <h3 style={{ fontSize: 15, marginBottom: 14 }}>Workflow actions</h3>

          {mayDecide && (
            <AssignAction contractors={contractors} onSubmit={(payload) =>
              action(() => api.post(`/work-items/${id}/assignment`, payload), 'Contractor assigned')
            } />
          )}

          {can(['PM', 'Contractor']) && wi.current_stage === 'Assigned' && (
            <DriveTestSubmitAction
              onSubmit={(payload) =>
                action(
                  () => api.post(`/work-items/${id}/drive-test`, payload),
                  'Drive test submitted for review',
                )
              }
            />
          )}

          {can(['Contractor']) && wi.current_stage === 'Assigned' && (
            <ReturnToCoordinatorAction onSubmit={(payload) =>
              action(() => api.post(`/work-items/${id}/return-to-coordinator`, payload), 'Site returned to coordinator')
            } />
          )}

          {mayDecide && wi.current_stage === 'DT Submitted' && wi.active_drive_test_id && (
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

          {!mayDecide &&
            !(can(['Contractor']) && wi.current_stage === 'Assigned') && (
              <p className="dim" style={{ fontSize: 13 }}>
                No actions available at the current stage ({wi.current_stage}).
              </p>
            )}
        </motion.div>
      </div>
    </>
  )
}

function fmtDate(value) {
  if (!value) return null
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

// How long this site has been with its contractor. Amber at two weeks, red at
// a month: the number exists to say when a site has gone quiet, and a plain
// figure leaves the reader to work that out for every row they ever read.
function Aging({ days }) {
  if (days == null) return null
  const color = days >= 30 ? 'var(--red)' : days >= 14 ? 'var(--amber)' : undefined
  return (
    <span className="tnum" style={{ color }}>
      {days} {days === 1 ? 'day' : 'days'}
    </span>
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

// Assigning here means one thing: the official drive test. The old
// "assignment type" dropdown offered "first" as well, which predates the
// hc_assignments table — initial health checks have had their own assignment
// flow for some time, and nothing in the app sends that value any more.
// Leaving it on screen meant offering a choice with one real answer.
function AssignAction({ contractors, onSubmit }) {
  const [contractorId, setContractorId] = useState('')
  return (
    <div className="mb-16">
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
        onClick={() =>
          onSubmit({ assignment_type: 'official', contractor_id: Number(contractorId) })
        }
      >
        Assign for drive test
      </button>
      <small className="dim" style={{ display: 'block', marginTop: 6 }}>
        Only a site that passed its health check and was confirmed can be
        assigned.
      </small>
    </div>
  )
}

// Contractor records when the drive test was actually executed and attaches
// the report. A PM or Coordinator picks it up for approval; approving is what
// marks the site DT Done on the dashboard.
//
// The date field is open. It used to be capped at today with Today/Yesterday
// chips, which assumed drive tests get logged the day they happen — the
// backend never had that restriction, so the rule only ever existed in this
// form. A date far from today gets a note rather than a second hard rule: the
// contractor is the one who knows when they drove the route.
function DriveTestSubmitAction({ onSubmit }) {
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [files, setFiles] = useState([])
  const [busy, setBusy] = useState(false)
  const fileRef = useRef(null)
  const toast = useToast()

  const submit = async () => {
    setBusy(true)
    try {
      const created = await onSubmit({ execution_date: date })
      const driveTestId = created?.drive_test_id
      if (driveTestId && files.length) {
        for (const file of files) {
          const form = new FormData()
          form.append('file', file)
          await api.post(`/drive-tests/${driveTestId}/evidence`, form, {
            headers: { 'Content-Type': 'multipart/form-data' },
          })
        }
      }
    } catch (err) {
      toast.error(
        'Report not attached',
        err.response?.data?.detail ||
          'The drive test was submitted, but the file did not upload. Open the site again to retry.',
      )
    } finally {
      setBusy(false)
      setFiles([])
    }
  }

  const dayDelta = Math.round(
    (new Date(today) - new Date(date)) / 86400000,
  )
  const unusualDate =
    Number.isFinite(dayDelta) && (dayDelta < 0 || dayDelta > 60)

  return (
    <div
      className="mb-16"
      style={{ padding: 16, borderRadius: 'var(--radius-sm)', background: 'var(--surface-2)', border: '1px solid var(--border-soft)' }}
    >
      <div className="row" style={{ gap: 6, marginBottom: 12, color: 'var(--signal)' }}>
        <Radio size={15} />
        <b style={{ fontSize: 13.5 }}>Submit Drive Test</b>
      </div>

      <div className="field">
        <label>Date the drive test was carried out</label>
        <input
          type="date"
          className="input"
          value={date}
          onChange={(e) => setDate(e.target.value)}
          style={{ fontFamily: 'var(--font-mono, inherit)', fontVariantNumeric: 'tabular-nums' }}
        />
        {unusualDate && (
          <small className="dim" style={{ display: 'block', marginTop: 5 }}>
            {dayDelta < 0
              ? 'That date is in the future — check it before submitting.'
              : `That is ${dayDelta} days ago. Fine if the drive test really was that long ago.`}
          </small>
        )}
      </div>

      <div className="field">
        <label>Report / measurement files</label>
        <div className="row wrap" style={{ gap: 8 }}>
          <button className="btn btn-sm" onClick={() => fileRef.current?.click()}>
            <Paperclip size={14} /> Attach file
          </button>
          <input
            ref={fileRef}
            type="file"
            hidden
            multiple
            onChange={(e) => setFiles([...e.target.files])}
          />
          {files.length > 0 && (
            <span className="dim" style={{ fontSize: 12.5 }}>
              {files.map((f) => f.name).join(', ')}
            </span>
          )}
        </div>
        <small className="dim" style={{ display: 'block', marginTop: 5 }}>
          Optional, but the reviewer approves against this — approval is what
          counts the site as DT Done.
        </small>
      </div>

      <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center' }} disabled={!date || busy} onClick={submit}>
        {busy ? 'Submitting…' : 'Submit for review'}
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
