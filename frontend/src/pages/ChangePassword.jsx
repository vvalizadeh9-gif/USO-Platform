import { motion } from 'framer-motion'
import { Eye, EyeOff, KeyRound, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { PageHead } from '../components/ui'
import { detailMessage } from '../lib/apiError'

const MIN_LENGTH = 12

// Changing your own password.
//
// One screen serving two situations. Normally it is something a person chose
// to do, reached from the sidebar. But after an administrator resets an
// account it is the *only* screen that account can use, and it is reached by
// being sent here — so it has to explain why, and it must not offer a way
// back to a platform that will only refuse.
//
// The current password is required in both cases, including the forced one.
// Somebody working off a temporary password was given it, so they can type it;
// requiring it is what stops an unattended browser being turned into a
// permanent account by whoever walks past next.
export default function ChangePassword() {
  const { user, refreshUser } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const forced = !!user?.must_change_password

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const mismatch = confirm.length > 0 && next !== confirm
  const tooShort = next.length > 0 && next.length < MIN_LENGTH
  const canSubmit = current && next.length >= MIN_LENGTH && next === confirm && !busy

  async function submit(e) {
    e.preventDefault()
    setError('')
    setBusy(true)
    try {
      const { data } = await api.post('/auth/me/password', {
        current_password: current,
        new_password: next,
      })
      // Changing a password ends every session the account has, this one
      // included, so the endpoint hands back a replacement token rather than
      // signing someone out for succeeding.
      if (data.access_token) {
        localStorage.setItem('uep_token', data.access_token)
      }
      await refreshUser()
      toast.success(
        'Password changed',
        'Any other device signed in to this account has been signed out.',
      )
      navigate('/')
    } catch (err) {
      setError(detailMessage(err, 'Could not change the password. Please try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <PageHead
        eyebrow="Your account"
        title={forced ? 'Choose a new password' : 'Change your password'}
        subtitle={
          forced
            ? 'Your password was reset by an administrator. Choose your own before continuing.'
            : 'Set a new password for your account.'
        }
      />

      <motion.div
        className="card card-pad"
        style={{ maxWidth: 520 }}
        initial={{ opacity: 0, y: 8 }}
        animate={{ opacity: 1, y: 0 }}
      >
        {forced && (
          <div className="form-banner form-banner-error" role="alert" style={{ marginBottom: 16 }}>
            The password you signed in with is one an administrator also knows.
            Until you replace it, this is the only screen your account can use.
          </div>
        )}

        {error && (
          <div className="form-banner form-banner-error" role="alert" style={{ marginBottom: 16 }}>
            {error}
          </div>
        )}

        <form onSubmit={submit} noValidate>
          <div className="field">
            <label htmlFor="current-password">
              {forced ? 'The password you were given' : 'Current password'}
            </label>
            <input
              id="current-password"
              className="input"
              type="password"
              value={current}
              onChange={(e) => setCurrent(e.target.value)}
              autoComplete="current-password"
              autoFocus
              required
            />
          </div>

          <div className="field">
            <label htmlFor="new-password">New password</label>
            <div className="input-with-action">
              <input
                id="new-password"
                className={`input${tooShort ? ' input-error' : ''}`}
                type={show ? 'text' : 'password'}
                value={next}
                onChange={(e) => setNext(e.target.value)}
                autoComplete="new-password"
                aria-describedby="new-password-help"
                required
              />
              <button
                type="button"
                className="input-action-btn"
                onClick={() => setShow((v) => !v)}
                aria-label={show ? 'Hide password' : 'Show password'}
                aria-pressed={show}
                tabIndex={-1}
              >
                {show ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            <span id="new-password-help" className="dim" style={{ fontSize: 12.5, marginTop: 6, display: 'block' }}>
              At least {MIN_LENGTH} characters. A phrase you will remember beats
              a short word with symbols in it — length is what makes a password
              hard to guess.
            </span>
            {tooShort && (
              <div className="field-error" role="alert">
                That is {next.length} character{next.length === 1 ? '' : 's'};
                {' '}{MIN_LENGTH} is the minimum.
              </div>
            )}
          </div>

          <div className="field">
            <label htmlFor="confirm-password">Repeat the new password</label>
            <input
              id="confirm-password"
              className={`input${mismatch ? ' input-error' : ''}`}
              type={show ? 'text' : 'password'}
              value={confirm}
              onChange={(e) => setConfirm(e.target.value)}
              autoComplete="new-password"
              aria-invalid={mismatch}
              required
            />
            {mismatch && (
              <div className="field-error" role="alert">
                The two passwords do not match.
              </div>
            )}
          </div>

          <div className="row" style={{ gap: 7, margin: '4px 0 16px', color: 'var(--text-muted)', fontSize: 12.5 }}>
            <ShieldCheck size={14} />
            <span>
              Every other device signed in to this account will be signed out.
            </span>
          </div>

          <button className="btn btn-primary" disabled={!canSubmit}>
            {busy ? <div className="spinner" /> : <><KeyRound size={15} /> Change password</>}
          </button>
        </form>
      </motion.div>
    </>
  )
}
