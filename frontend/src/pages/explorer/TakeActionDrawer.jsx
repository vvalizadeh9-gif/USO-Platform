import { CheckCircle2, XCircle } from '../../components/carbon'
import { useEffect, useState } from 'react'
import api from '../../api/client'
import DriveTestSubmitForm from '../../components/DriveTestSubmitForm'
import ReturnToCoordinatorForm from '../../components/ReturnToCoordinatorForm'
import { ConfirmDialog, Drawer } from '../../components/ui'
import { useToast } from '../../context/ToastContext'

/**
 * Take action (UEP-11 §B3): the workflow forms the old work-item page held --
 * assign, submit the drive test, return to coordinator, review the drive test
 * -- moved here unchanged, in a side drawer. The pipeline pages are where this
 * work is normally done; the drawer keeps every form reachable from the site,
 * and is the only place a PM submits a drive test on a contractor's behalf.
 *
 * `actions` (explorerModel.workflowActions) decides which forms show; the
 * server re-checks every one of them.
 */
export default function TakeActionDrawer({ open, onClose, workItemId, workflow, actions, onDone }) {
  const toast = useToast()
  const [contractors, setContractors] = useState([])

  useEffect(() => {
    if (!open || !actions.assign) return
    api.get('/reference/contractors').then((r) => setContractors(r.data)).catch(() => {})
  }, [open, actions.assign])

  // Returns the response body: the drive-test submission needs the new
  // drive_test_id back so it can attach the report to it.
  async function act(fn, okMsg) {
    try {
      const res = await fn()
      toast.success(okMsg)
      onDone()
      return res?.data
    } catch (err) {
      toast.error('Action failed', err.response?.data?.detail || 'Please try again.')
      return undefined
    }
  }

  return (
    <Drawer open={open} onClose={onClose} title="Take action">
      <div className="ex-drawer-forms">
        {actions.assign && (
          <AssignAction
            contractors={contractors}
            onSubmit={(payload) =>
              act(() => api.post(`/work-items/${workItemId}/assignment`, payload), 'Contractor assigned')
            }
          />
        )}

        {actions.submitDt && (
          <DriveTestSubmitForm
            onSubmit={(payload) =>
              act(() => api.post(`/work-items/${workItemId}/drive-test`, payload), 'Drive test submitted for review')
            }
            footer={actions.returnToCoordinator && (
              <ReturnToCoordinatorForm onSubmit={(payload) =>
                act(() => api.post(`/work-items/${workItemId}/return-to-coordinator`, payload), 'Site returned to coordinator')
              } />
            )}
          />
        )}

        {actions.review && (
          <CoordinatorReviewAction
            submissionDate={workflow.dt_submission_date}
            onDecide={(payload) =>
              act(
                () => api.post(`/drive-tests/${workflow.active_drive_test_id}/coordinator-review`, payload),
                payload.decision === 'Approved' ? 'Drive test approved' : 'Drive test rejected',
              )
            }
          />
        )}
      </div>
    </Drawer>
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
        <label htmlFor="ex-assign-contractor">Contractor</label>
        <select id="ex-assign-contractor" className="input" value={contractorId} onChange={(e) => setContractorId(e.target.value)}>
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
      <div className="row" style={{ gap: 8, marginBottom: 4, color: 'var(--uep-status-pending-ink)' }}>
        <CheckCircle2 size={17} />
        <h3 style={{ fontSize: 15 }}>Drive test awaiting your validation</h3>
      </div>
      <p className="muted" style={{ fontSize: 13, marginBottom: 16, maxWidth: '60ch' }}>
        Carried out on <b className="tnum">{submissionDate || '—'}</b>. Approving is the
        final step: the site is marked DT Done and counted on the dashboard.
      </p>

      <div className="field" style={{ maxWidth: 480 }}>
        <label htmlFor="ex-review-comment">Comment (required when rejecting)</label>
        <textarea
          id="ex-review-comment"
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
          style={{ padding: '11px 22px', color: 'var(--uep-status-danger-ink)', borderColor: 'var(--uep-status-danger-ink)' }}
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
