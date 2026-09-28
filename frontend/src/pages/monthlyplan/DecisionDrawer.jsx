import { X } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { Loading, StatusPill } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import Revisions from './Revisions'
import { REASON_LABEL } from './streams'

/** The statuses a PM decides: a first submission, or a revision request. */
const DECIDABLE = ['Submitted', 'RevisionRequested']

/**
 * One contractor's plan for one stream and month, in a right-side panel.
 *
 * Reads the month's queue for the stream (GET /pip/queue, the PM's own
 * read) and picks the contractor's row, so it shows the same number in force,
 * pending number and revision reason the queue always has. Approve and
 * Return are the queue's own calls (POST /pip/{id}/approve, /return with a
 * required comment), offered only when `canDecide` and only on a plan that
 * is waiting on the PM. Everyone else reads it.
 *
 * The version history underneath is the existing Revisions panel, for the
 * same stream.
 */
export default function DecisionDrawer({ target, canDecide, onClose, onDecided }) {
  const toast = useToast()
  const [row, setRow] = useState(null)
  const [label, setLabel] = useState('')
  const [failed, setFailed] = useState(false)
  const [comment, setComment] = useState('')
  const [busy, setBusy] = useState(false)
  const streamName = target.stream === 'ACCEPTANCE' ? 'Acceptance' : 'DT'

  const load = useCallback(() => {
    setFailed(false)
    api
      .get('/pip/queue', { params: { year: target.year, month: target.month, stream: target.stream } })
      .then((r) => {
        setLabel(r.data.label)
        setRow(r.data.rows.find((x) => x.contractor_id === target.contractorId) || { contractor_id: target.contractorId, contractor_name: target.name })
      })
      .catch(() => setFailed(true))
  }, [target])

  useEffect(() => {
    setRow(null)
    setComment('')
    load()
  }, [load])

  useEffect(() => {
    const onKey = (e) => e.key === 'Escape' && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  async function decide(action) {
    if (!row?.plan_id) return
    setBusy(true)
    try {
      if (action === 'approve') {
        await api.post(`/pip/${row.plan_id}/approve`)
        toast.success(`${row.contractor_name} approved`, `${row.committed_count} is their ${streamName} PIP for ${label}.`)
      } else {
        await api.post(`/pip/${row.plan_id}/return`, { comment })
        toast.success(`Sent back to ${row.contractor_name}`, 'They see your comment on their own plan.')
      }
      setComment('')
      load()
      onDecided?.()
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  const waiting = row && DECIDABLE.includes(row.status) && row.plan_id
  const revision = row?.status === 'RevisionRequested'

  return (
    <>
      <div className="mp-drawer-scrim" onClick={onClose} aria-hidden="true" />
      <aside className="mp-drawer" role="dialog" aria-label="Plan decision">
        <div className="mp-drawer-head">
          <div>
            <div className="mp-drawer-title">{row?.contractor_name || target.name}</div>
            <div className="dim" style={{ fontSize: 12.5 }}>
              {streamName} · {label || `${target.year}/${target.month}`}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <div className="mp-drawer-body">
          {failed ? (
            <div className="empty">Could not load this plan.</div>
          ) : !row ? (
            <Loading label="Loading the plan" />
          ) : (
            <>
              <div className="mp-drawer-figs">
                <div>
                  <div className="mp-kpi-label">In force</div>
                  <div className="mp-kpi-value tnum">{row.in_force_count ?? '—'}</div>
                </div>
                {row.status && row.status !== 'Approved' && (
                  <div>
                    <div className="mp-kpi-label">{revision ? 'Revision requested' : 'Handed in'}</div>
                    <div className="mp-kpi-value tnum">{row.committed_count ?? '—'}</div>
                  </div>
                )}
                <div style={{ alignSelf: 'center' }}>
                  <StatusPill status={row.status || 'Not submitted'} />
                  {row.is_late && <span className="pill pill-amber" style={{ marginInlineStart: 6 }}>Late</span>}
                </div>
              </div>

              {revision && (
                <div className="mp-drawer-note">
                  <b>Reason:</b> {REASON_LABEL[row.revision_reason] || row.revision_reason || '—'}
                  {row.revision_comment && <div className="mp-drawer-quote">{row.revision_comment}</div>}
                </div>
              )}
              {row.return_comment && !waiting && (
                <div className="mp-drawer-note">
                  <b>Returned:</b> <span className="mp-drawer-quote">{row.return_comment}</span>
                </div>
              )}

              {waiting && canDecide && (
                <div className="mp-drawer-decide">
                  <label className="field" style={{ margin: 0 }}>
                    <span>Comment — required to return; the contractor reads it</span>
                    <textarea
                      className="input"
                      rows={3}
                      value={comment}
                      disabled={busy}
                      maxLength={1000}
                      onChange={(e) => setComment(e.target.value)}
                    />
                  </label>
                  <div className="row" style={{ gap: 8, justifyContent: 'flex-end' }}>
                    <button type="button" className="btn btn-sm" disabled={busy || !comment.trim()} onClick={() => decide('return')}>
                      Return
                    </button>
                    <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={() => decide('approve')}>
                      Approve {row.committed_count}
                    </button>
                  </div>
                </div>
              )}
              {waiting && !canDecide && (
                <div className="dim" style={{ fontSize: 12.5, marginTop: 12 }}>Waiting on the PM’s decision.</div>
              )}

              <Revisions
                period={{ year: target.year, month: target.month, contractorId: target.contractorId }}
                stream={target.stream}
                isContractor={false}
                onClose={onClose}
              />
            </>
          )}
        </div>
      </aside>
    </>
  )
}
