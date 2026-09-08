import { motion } from 'framer-motion'
import { ArrowLeft, CheckCircle2, ChevronDown, CornerUpLeft, Paperclip, Radio, XCircle } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { canReview } from '../lib/roles'
import { useToast } from '../context/ToastContext'
import { ConfirmDialog, Loading, PageHead, StatusPill } from '../components/ui'
import DateField from '../components/DateField'
import { daysBetween, todayIso } from '../lib/dates'

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

  const mayAssign = mayDecide
  const maySubmitDt = can(['PM', 'Contractor']) && wi.current_stage === 'Assigned'
  const mayReturn = can(['Contractor']) && wi.current_stage === 'Assigned'
  const mayReview = mayDecide && wi.current_stage === 'DT Submitted' && wi.active_drive_test_id
  const hasAction = mayAssign || maySubmitDt || mayReturn || mayReview

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

      {/* The action is why the page was opened, so it holds the wide column;
          the record is what you glance at while doing it. */}
      <div className="detail-grid">
        <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} style={{ display: 'grid', gap: 16 }}>
          {mayAssign && (
            <AssignAction contractors={contractors} onSubmit={(payload) =>
              action(() => api.post(`/work-items/${id}/assignment`, payload), 'Contractor assigned')
            } />
          )}

          {maySubmitDt && (
            <DriveTestSubmitAction
              onSubmit={(payload) =>
                action(
                  () => api.post(`/work-items/${id}/drive-test`, payload),
                  'Drive test submitted for review',
                )
              }
              footer={mayReturn && (
                <ReturnToCoordinatorAction onSubmit={(payload) =>
                  action(() => api.post(`/work-items/${id}/return-to-coordinator`, payload), 'Site returned to coordinator')
                } />
              )}
            />
          )}

          {mayReview && (
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

          {!hasAction && (
            <div className="card card-pad">
              <p className="dim" style={{ fontSize: 13 }}>
                No actions available at the current stage ({wi.current_stage}).
              </p>
            </div>
          )}
        </motion.div>

        {/* Details.
            A subcontractor is shown the assignment and nothing else: which
            site, where, since when, and how long it has been theirs. Project
            manager, power status and deployed technology are the operator's
            internal picture of the site, and a contractor reading them can
            only be misled about which of them is their business.

            Site code and province are not repeated here when the header above
            already says them -- two of the contractor's five rows used to be
            an echo of the heading directly above the card. */}
        <motion.div
          className="card card-pad detail-rail"
          initial={{ opacity: 0, y: 10 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.08 }}
        >
          <h3>Details</h3>
          {!isContractor && <RailRow label="Province" value={wi.province} />}
          <RailRow label="Site Type" value={wi.site_type} />
          {!isContractor && (
            <>
              <RailRow label="Requested Technology" value={wi.requested_technology} />
              <RailRow label="Deployed Technology" value={wi.deployed_technology} />
              <RailRow label="Project Manager" value={wi.pm_name} />
              <RailRow label="Power Status" value={wi.power_status} />
            </>
          )}
          <RailRow label="Assignment Date" value={fmtDate(wi.assignment_date)} mono />
          <RailRow label="Aging" value={<Aging days={wi.assigned_aging_days} />} />
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
//
// Day zero is spelled out. "0 days" is a figure the reader has to decode into
// "it arrived today", which is the one thing it never needs to warn about.
function Aging({ days }) {
  if (days == null) return null
  if (days === 0) return <span>Assigned today</span>
  const color = days >= 30 ? 'var(--red)' : days >= 14 ? 'var(--amber)' : undefined
  return (
    <span className="tnum" style={{ color }}>
      {days} {days === 1 ? 'day' : 'days'}
    </span>
  )
}

function RailRow({ label, value, mono }) {
  return (
    <div className="rail-row">
      <span className="k">{label}</span>
      <span className={`v ${mono ? 'tnum' : ''}`} dir="auto" style={{ unicodeBidi: 'isolate' }}>
        {value || '—'}
      </span>
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
    <div className="card card-pad">
      <h3 style={{ fontSize: 15, marginBottom: 4 }}>Assign for drive test</h3>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16, maxWidth: '60ch' }}>
        Only a site that passed its health check and was confirmed can be assigned.
      </p>
      <div className="field" style={{ maxWidth: 320 }}>
        <label>Contractor</label>
        <select className="input" value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
          <option value="">Select…</option>
          {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
        </select>
      </div>
      <button
        className="btn btn-primary"
        style={{ padding: '11px 22px' }}
        disabled={!contractorId}
        onClick={() =>
          onSubmit({ assignment_type: 'official', contractor_id: Number(contractorId) })
        }
      >
        Assign for drive test
      </button>
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
function DriveTestSubmitAction({ onSubmit, footer }) {
  const today = todayIso()
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

  const dayDelta = daysBetween(today, date)
  const unusualDate = dayDelta !== null && (dayDelta < 0 || dayDelta > 60)

  return (
    <div className="card card-pad">
      <div className="row" style={{ gap: 8, marginBottom: 4, color: 'var(--signal)' }}>
        <Radio size={17} />
        <h3 style={{ fontSize: 15 }}>Submit drive test</h3>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 18, maxWidth: '60ch' }}>
        Record when the drive test was carried out and attach the report. A PM or
        coordinator approves it — approval is what counts the site as DT Done.
      </p>

      <div className="field-pair">
        <div className="field">
          <label htmlFor="dt-date">Date the drive test was carried out</label>
          <DateField id="dt-date" value={date} onChange={setDate} />
          {unusualDate && (
            <small className="field-warning">
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
            <span className="dim" style={{ fontSize: 12.5 }}>
              {files.length > 0 ? files.map((f) => f.name).join(', ') : 'No files yet'}
            </span>
          </div>
          <small className="dim" style={{ fontSize: 12 }}>
            Optional, but the reviewer approves against this.
          </small>
        </div>
      </div>

      <button
        className="btn btn-primary"
        style={{ padding: '11px 22px', marginTop: 4 }}
        disabled={!date || busy}
        onClick={submit}
      >
        {busy ? 'Submitting…' : 'Submit for review'}
      </button>

      {footer && <div className="card-foot">{footer}</div>}
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
    <div className="card card-pad">
      <div className="row" style={{ gap: 8, marginBottom: 4, color: 'var(--amber)' }}>
        <CheckCircle2 size={17} />
        <h3 style={{ fontSize: 15 }}>Drive test awaiting your validation</h3>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16, maxWidth: '60ch' }}>
        Carried out on <b className="tnum">{submissionDate || '—'}</b>. Approving is the
        final step: the site is marked DT Done and counted on the dashboard.
      </p>

      <div className="field" style={{ maxWidth: 480 }}>
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
          style={{ padding: '11px 22px' }}
          onClick={() => setPending('Approved')}
        >
          <CheckCircle2 size={15} /> Approve
        </button>
        <button
          className="btn"
          style={{ padding: '11px 22px', color: 'var(--red)', borderColor: 'var(--red)' }}
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
//
// Collapsed by default. It is the rare path, and open it took as much of the
// panel as the drive test itself — the thing the contractor came here to do.
function ReturnToCoordinatorAction({ onSubmit }) {
  const [open, setOpen] = useState(false)
  const [reason, setReason] = useState('')
  const [confirming, setConfirming] = useState(false)
  const [busy, setBusy] = useState(false)

  const confirm = async () => {
    setBusy(true)
    await onSubmit({ reason })
    setBusy(false)
    setConfirming(false)
    setReason('')
    setOpen(false)
  }

  return (
    <div>
      <button className="disclosure" aria-expanded={open} onClick={() => setOpen((o) => !o)}>
        <CornerUpLeft size={15} />
        Can't proceed with this site?
        <ChevronDown
          size={14}
          style={{ opacity: 0.6, transform: open ? 'rotate(180deg)' : 'none', transition: 'transform 0.15s' }}
        />
      </button>

      {open && (
        <div style={{ marginTop: 12, maxWidth: 480 }}>
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
            disabled={reason.trim().length < 3}
            onClick={() => setConfirming(true)}
          >
            Return to coordinator
          </button>
        </div>
      )}

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
