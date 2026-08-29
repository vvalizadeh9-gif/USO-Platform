import { motion } from 'framer-motion'
import { Check, Copy, KeyRound, X } from 'lucide-react'
import { useState } from 'react'
import api from '../../api/client'
import { detailMessage } from '../../lib/apiError'

// Resetting somebody else's password.
//
// The generated password is shown once and cannot be looked up again: what is
// stored is an Argon2id hash, and nothing turns that back into text. The
// dialog says so, because an administrator who closes it expecting to find the
// value somewhere later will instead have to reset the account a second time.
//
// Two modes. Generating is the default and the better path — a password an
// administrator invents for someone else tends to be a pattern they reuse for
// everyone else. Typing one is offered for the case where it has to be read
// down a phone line and needs to be sayable.
export default function PasswordResetDialog({ user, onClose, onError }) {
  const [mode, setMode] = useState('generate')
  const [chosen, setChosen] = useState('')
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const [issued, setIssued] = useState(null)
  const [copied, setCopied] = useState(false)

  async function submit() {
    setBusy(true)
    try {
      const body = { reason: reason.trim() || null }
      if (mode === 'choose') body.password = chosen
      const { data } = await api.post(`/admin/users/${user.id}/reset-password`, body)
      setIssued(data)
    } catch (err) {
      onError(detailMessage(err, 'Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(issued.temporary_password)
      setCopied(true)
      setTimeout(() => setCopied(false), 2000)
    } catch {
      // Clipboard access is refused in some browsers and over plain HTTP. The
      // password is on screen and selectable, so this is a convenience that
      // can fail quietly rather than an error worth interrupting anyone for.
    }
  }

  return (
    <div
      style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,50,0.45)', display: 'grid', placeItems: 'center', zIndex: 200 }}
      onClick={issued ? undefined : onClose}
    >
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="card card-pad"
        style={{ width: 500 }}
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="reset-dialog-title"
      >
        <div className="row between" style={{ marginBottom: 12 }}>
          <div className="row" style={{ gap: 8 }}>
            <KeyRound size={18} />
            <h3 id="reset-dialog-title" style={{ fontSize: 16 }}>
              {issued ? 'Password reset' : 'Reset password'}
            </h3>
          </div>
          {!issued && (
            <button className="btn btn-sm btn-ghost" onClick={onClose} aria-label="Close">
              <X size={15} />
            </button>
          )}
        </div>

        {issued ? (
          <>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 12 }}>
              Give this to <b>{user.full_name}</b>. They will be asked to
              choose their own password the first time they sign in with it,
              and cannot use the platform until they have.
            </p>

            <div
              className="row between"
              style={{
                background: 'var(--surface-2)',
                border: '1px solid var(--border)',
                borderRadius: 'var(--radius-sm)',
                padding: '12px 14px',
                marginBottom: 12,
              }}
            >
              <code
                className="tnum"
                style={{ fontSize: 17, letterSpacing: 0.5, userSelect: 'all' }}
              >
                {issued.temporary_password}
              </code>
              <button className="btn btn-sm" onClick={copy}>
                {copied ? <><Check size={14} /> Copied</> : <><Copy size={14} /> Copy</>}
              </button>
            </div>

            <div className="form-banner form-banner-error" role="alert" style={{ marginBottom: 14 }}>
              This is the only time it will be shown. What is stored is a hash,
              so nobody — including you — can look it up again. If it is lost,
              reset the account once more.
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-primary" onClick={onClose}>
                I have passed it on
              </button>
            </div>
          </>
        ) : (
          <>
            <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 14 }}>
              This signs <b>{user.full_name}</b> ({user.username}) out
              everywhere and replaces their password. Their existing one stops
              working immediately.
            </p>

            <div className="field">
              <label>How</label>
              <label className="row" style={{ gap: 8, cursor: 'pointer', marginBottom: 6 }}>
                <input
                  type="radio"
                  name="reset-mode"
                  checked={mode === 'generate'}
                  onChange={() => setMode('generate')}
                />
                <span>Generate one for me <span className="dim">(recommended)</span></span>
              </label>
              <label className="row" style={{ gap: 8, cursor: 'pointer' }}>
                <input
                  type="radio"
                  name="reset-mode"
                  checked={mode === 'choose'}
                  onChange={() => setMode('choose')}
                />
                <span>Let me type one</span>
              </label>
            </div>

            {mode === 'choose' && (
              <div className="field">
                <label htmlFor="reset-chosen">Temporary password</label>
                <input
                  id="reset-chosen"
                  className="input"
                  value={chosen}
                  onChange={(e) => setChosen(e.target.value)}
                  placeholder="At least 12 characters"
                  autoComplete="new-password"
                />
                <span className="dim" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
                  Held to the same rules as any other password, including that
                  it must not be built from their username.
                </span>
              </div>
            )}

            <div className="field">
              <label htmlFor="reset-reason">Reason (optional)</label>
              <input
                id="reset-reason"
                className="input"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="e.g. forgot password, phoned the help desk"
              />
            </div>

            <div className="row" style={{ gap: 8 }}>
              <button
                className="btn btn-primary"
                disabled={busy || (mode === 'choose' && chosen.length < 12)}
                onClick={submit}
              >
                {busy ? <div className="spinner" /> : <><KeyRound size={15} /> Reset password</>}
              </button>
              <button className="btn btn-ghost" onClick={onClose}>Cancel</button>
            </div>
          </>
        )}
      </motion.div>
    </div>
  )
}
