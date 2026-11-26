// Changing your own password, in the sign-in frame (UEP-26).
//
// One screen serving two situations. Normally it is something a person chose
// to do, from the account menu. But after an administrator resets an account
// it is the *only* screen that account can use -- so it says why, and offers
// no way back to a platform that would only refuse.
//
// The current password is required in both cases, including the forced one.
// Somebody working off a temporary password was given it, so they can type it;
// requiring it is what stops an unattended browser being turned into a
// permanent account by whoever walks past next.
import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import Icon from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { detailMessage } from '../lib/apiError'
import AuthFrame from './auth/AuthFrame'
import FieldMessage from './auth/FieldMessage'
import {
  CHANGE_PASSWORD_MESSAGES,
  MIN_PASSWORD_LENGTH as MIN_LENGTH,
  passwordProblem,
} from './auth/signInModel'

function Rule({ met, children }) {
  return (
    <li className={met ? 'is-met' : undefined}>
      <span className="uep-signin-rule-dot" aria-hidden="true">
        <Icon name="checkmark" size={16} />
      </span>
      {children}
      <span className="sr-only">{met ? ' (done)' : ' (not yet)'}</span>
    </li>
  )
}

function PasswordField({ id, label, value, onChange, type, autoComplete, autoFocus, reveal }) {
  return (
    <div className="uep-signin-field">
      <label htmlFor={id} className="uep-signin-label">{label}</label>
      <div className="uep-signin-input-wrap">
        <Icon name="password" size={18} className="uep-signin-input-icon" />
        <input
          id={id}
          className={`uep-signin-input${reveal ? ' uep-signin-input-reveal' : ''}`}
          type={type}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoComplete={autoComplete}
          autoFocus={autoFocus}
          dir="ltr"
          aria-describedby="change-password-error"
        />
        {reveal}
      </div>
    </div>
  )
}

export default function ChangePassword() {
  const { user, refreshUser } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const forced = Boolean(user?.must_change_password)

  const [current, setCurrent] = useState('')
  const [next, setNext] = useState('')
  const [confirm, setConfirm] = useState('')
  const [show, setShow] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const longEnough = next.length >= MIN_LENGTH
  const matches = next.length > 0 && next === confirm
  const edit = (setter) => (value) => {
    setter(value)
    setError('')
  }

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    const problem = passwordProblem({ current, next, confirm, forced })
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    try {
      // Changing a password ends every session the account has, this one
      // included, so the server sets a fresh session cookie in its answer
      // rather than signing someone out for succeeding.
      await api.post('/auth/me/password', { current_password: current, new_password: next })
      await refreshUser()
      toast.success('Password changed', 'Any other device signed in to this account has been signed out.')
      navigate('/', { replace: true })
    } catch (err) {
      setError(detailMessage(err, CHANGE_PASSWORD_MESSAGES.failed))
    } finally {
      setBusy(false)
    }
  }

  const revealButton = (
    <button
      type="button"
      className="uep-signin-reveal"
      onClick={() => setShow((v) => !v)}
      aria-label={show ? 'Hide password' : 'Show password'}
      aria-pressed={show}
      aria-controls="new-password confirm-password"
    >
      <Icon name={show ? 'view--off' : 'view'} size={18} />
    </button>
  )

  return (
    <AuthFrame>
      <div className="uep-signin-step is-first">
        {!forced && (
          <button type="button" className="uep-signin-back" onClick={() => navigate('/')}>
            <Icon name="arrow--left" size={16} />
            Back
          </button>
        )}
        <h1 className="uep-signin-heading">Choose a new password</h1>
        {forced && <p className="uep-signin-lead">Your password was reset by an administrator.</p>}
        <form onSubmit={submit} noValidate aria-busy={busy}>
          <PasswordField
            id="current-password"
            label={forced ? 'Password you were given' : 'Current password'}
            value={current}
            onChange={edit(setCurrent)}
            type="password"
            autoComplete="current-password"
            autoFocus
          />
          <PasswordField
            id="new-password"
            label="New password"
            value={next}
            onChange={edit(setNext)}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
            reveal={revealButton}
          />
          <PasswordField
            id="confirm-password"
            label="Repeat new password"
            value={confirm}
            onChange={edit(setConfirm)}
            type={show ? 'text' : 'password'}
            autoComplete="new-password"
          />
          <ul className="uep-signin-rules" aria-label="Password rules">
            <Rule met={longEnough}>At least {MIN_LENGTH} characters</Rule>
            <Rule met={matches}>Both new passwords match</Rule>
          </ul>
          <FieldMessage id="change-password-error" message={error} />
          <button type="submit" className="uep-signin-submit" aria-disabled={busy || undefined} aria-busy={busy || undefined}>
            {busy ? 'Saving…' : 'Save and continue'}
            {busy ? (
              <span className="uep-signin-spinner" aria-hidden="true" />
            ) : (
              <Icon name="arrow--right" size={18} className="uep-signin-submit-icon" />
            )}
          </button>
        </form>
      </div>
    </AuthFrame>
  )
}
