import { motion } from 'framer-motion'
import { ShieldOff, X } from 'lucide-react'
import { useState } from 'react'
import {
  ACTIVE, INACTIVE, STATUS_HELP, STATUS_VERB, SUSPENDED, USER_STATUSES,
} from '../../lib/userStatus'

// Moving one account between Active, Inactive and Suspended.
//
// A dialog rather than a dropdown in the row, for two reasons. The choice
// between Inactive and Suspended is one an administrator has to *make*, and
// the difference is not self-evident from the words alone — so each option
// carries the sentence that says when to pick it. And the reason box is what
// turns an audit entry from "Maryam suspended user #7" into something a
// reviewer a year from now can act on.
export default function UserStatusDialog({ user, onCancel, onConfirm }) {
  const [status, setStatus] = useState(
    // Default to the move the administrator most likely came here to make: an
    // active account is being taken offline, an offline one is coming back.
    user.status === ACTIVE ? SUSPENDED : ACTIVE,
  )
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)

  const leavingActive = status !== ACTIVE
  const options = USER_STATUSES.filter((s) => s !== user.status)

  async function submit() {
    setBusy(true)
    try {
      await onConfirm(status, reason.trim())
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,50,0.45)', display: 'grid', placeItems: 'center', zIndex: 200 }}
      onClick={onCancel}
    >
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="card card-pad"
        style={{
          width: 480,
          borderColor: leavingActive ? 'var(--red)' : 'var(--border)',
          borderWidth: leavingActive ? 1.5 : 1,
        }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="status-dialog-title"
      >
        <div className="row between" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8, color: leavingActive ? 'var(--red)' : 'var(--text)' }}>
            <ShieldOff size={18} />
            <h3 id="status-dialog-title" style={{ fontSize: 16, color: 'inherit' }}>
              Change account status
            </h3>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={onCancel} aria-label="Close">
            <X size={15} />
          </button>
        </div>

        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
          <b>{user.full_name}</b> ({user.username}) is currently{' '}
          <b>{user.status.toLowerCase()}</b>.
        </p>

        <div className="field">
          <label htmlFor="status-choice">New status</label>
          <select
            id="status-choice"
            className="input"
            value={status}
            onChange={(e) => setStatus(e.target.value)}
          >
            {options.map((s) => (
              <option key={s} value={s}>{STATUS_VERB[s]} — {s}</option>
            ))}
          </select>
          <span className="dim" style={{ fontSize: 12.5, marginTop: 6, display: 'block' }}>
            {STATUS_HELP[status]}
          </span>
        </div>

        <div className="field">
          <label htmlFor="status-reason">
            Reason {leavingActive ? '' : '(optional)'}
          </label>
          <input
            id="status-reason"
            className="input"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={
              status === SUSPENDED ? 'e.g. account compromised, pending review'
                : status === INACTIVE ? 'e.g. left the company in Mordad'
                  : 'e.g. returned from leave'
            }
          />
          <span className="dim" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
            This goes into the audit log beside your name. It is what someone
            reading it next year will have to go on.
          </span>
        </div>

        {leavingActive && (
          <p className="muted" style={{ fontSize: 12.5, lineHeight: 1.6, marginBottom: 14 }}>
            They will be signed out immediately and cannot sign in again until
            an administrator reactivates them. Their account is kept, not
            deleted — every health check they reviewed and every audit entry
            still shows their name.
          </p>
        )}

        <div className="row" style={{ gap: 8 }}>
          <button
            className="btn"
            style={leavingActive
              ? { background: 'var(--red)', color: '#fff', border: 'none' }
              : { background: 'var(--signal)', color: '#fff', border: 'none' }}
            disabled={busy}
            onClick={submit}
          >
            {busy ? <div className="spinner" /> : <>{STATUS_VERB[status]}</>}
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>Cancel</button>
        </div>
      </motion.div>
    </div>
  )
}
