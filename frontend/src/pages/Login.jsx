import { motion } from 'framer-motion'
import { Eye, EyeOff, LifeBuoy, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

const SUPPORT_EMAIL = 'vahid.val@mtnirancell.ir'

const CAPTCHA_DOWN_HINT =
  'The server did not send a security question. Use the refresh button to try again.'

/**
 * What a failed sign-in should say, and why it differs by status.
 *
 * 401 stays deliberately vague. Naming which of the two fields was wrong tells
 * a guesser which usernames exist, so "check your username and password" is the
 * right answer there and always will be.
 *
 * Everything else is the opposite. A lockout and a deactivated account are
 * facts the person needs in order to stop retrying, and the backend already
 * writes a good sentence for both (rate_limit.py computes the wait in minutes).
 * Collapsing those into the 401 wording left people hammering a wall.
 */
function signInError(err) {
  const status = err.response?.status
  const detail = err.response?.data?.detail
  // FastAPI sends a list of objects for validation errors, a string for ours.
  const message = typeof detail === 'string' ? detail : null

  if (!err.response) {
    return { form: 'Cannot reach the server. Check your connection and try again.' }
  }
  if (status === 400) {
    return { captcha: message || 'That answer was not correct. Try the new question.' }
  }
  if (status === 401) {
    return { form: 'Check your username and password and try again.' }
  }
  if (status === 403 || status === 429) {
    return { form: message || 'You cannot sign in right now.' }
  }
  return { form: 'Something went wrong signing in. Please try again.' }
}

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [captcha, setCaptcha] = useState(null)
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [captchaDown, setCaptchaDown] = useState(false)
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [captchaError, setCaptchaError] = useState('')
  const captchaInputRef = useRef(null)

  useEffect(() => {
    refreshCaptcha()
  }, [])

  /**
   * Fetch a new challenge. This deliberately does NOT touch `captchaError`.
   *
   * It used to clear it, and that silently ate the wrong-answer message: the
   * call runs synchronously up to its `await`, so the clear batched with the
   * caller's `setCaptchaError(...)` and won. Callers own that state now --
   * `onSubmit` sets it, the manual refresh button clears it. Putting the clear
   * back here looks like a tidy-up and re-breaks the message.
   */
  async function refreshCaptcha() {
    setCaptchaAnswer('')
    try {
      const { data } = await api.get('/auth/captcha')
      setCaptcha(data)
      setCaptchaDown(false)
    } catch {
      // Drop the old challenge with it: keeping a stale question on screen
      // under an "unavailable" label, with Sign in still enabled, is worse
      // than plainly disabling the field until a refresh succeeds.
      setCaptcha(null)
      setCaptchaDown(true)
    }
  }

  function handlePasswordKeyEvent(e) {
    if (typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'))
    }
  }

  function onManualRefresh() {
    setCaptchaError('')
    refreshCaptcha()
  }

  async function onSubmit(e) {
    e.preventDefault()
    setFormError('')
    setCaptchaError('')

    if (!/^-?\d+$/.test(captchaAnswer.trim())) {
      setCaptchaError('Enter the captcha answer as a number.')
      captchaInputRef.current?.focus()
      return
    }

    setBusy(true)
    try {
      await login(username, password, captcha.token, captchaAnswer.trim())
      navigate('/')
      // No `finally` on purpose: on success `busy` stays true through the
      // redirect so the button cannot be pressed a second time while the
      // navigation is in flight. Only the failure path re-enables it.
    } catch (err) {
      const { form, captcha: captchaMessage } = signInError(err)
      if (form) setFormError(form)
      if (captchaMessage) setCaptchaError(captchaMessage)
      setBusy(false)

      // Only a 400 (wrong answer) or a 401 (wrong credentials) means the
      // challenge is spent or the person is about to try again. A 429 is
      // raised before the captcha is even looked at, and a 403 means the
      // account is disabled so no retry will help; the token stays valid for
      // its full TTL either way, so refetching there is a wasted request.
      const status = err.response?.status
      if (status === 400 || status === 401) refreshCaptcha()
    }
  }

  const captchaDescribedBy =
    [captchaError && 'login-captcha-error', captchaDown && 'login-captcha-down']
      .filter(Boolean)
      .join(' ') || undefined

  let captchaLabel = 'Loading captcha…'
  if (captchaDown) captchaLabel = 'Security question unavailable'
  else if (captcha) captchaLabel = `What is ${captcha.num1} + ${captcha.num2}?`

  return (
    <div className="login-wrap">
      <motion.div
        className="login-card"
        initial={{ opacity: 0, y: 20, scale: 0.98 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        transition={{ duration: 0.4, ease: [0.16, 1, 0.3, 1] }}
      >
        <div className="brand">
          <div className="brand-mark"><span>U</span></div>
          <div className="brand-text">
            <b>USO Platform</b>
            <small>Enterprise Operations</small>
          </div>
        </div>

        <div style={{ textAlign: 'center', marginBottom: 24 }}>
          <h2 style={{ fontSize: 20 }}>Sign in to continue</h2>
          <p className="muted" style={{ marginTop: 4, fontSize: 13 }}>
            Enter your credentials to access the platform
          </p>
        </div>

        {formError && (
          <div className="form-banner form-banner-error" role="alert">
            {formError}
          </div>
        )}

        <form onSubmit={onSubmit} noValidate>
          <div className="field">
            <label htmlFor="login-username">Username</label>
            <input
              id="login-username"
              className="input"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="your.username"
              autoComplete="username"
              autoFocus
              required
            />
          </div>
          <div className="field">
            <label htmlFor="login-password">Password</label>
            <div className="input-with-action">
              <input
                id="login-password"
                className="input"
                type={showPassword ? 'text' : 'password'}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                onKeyDown={handlePasswordKeyEvent}
                onKeyUp={handlePasswordKeyEvent}
                placeholder="••••••••"
                autoComplete="current-password"
                required
              />
              <button
                type="button"
                className="input-action-btn"
                onClick={() => setShowPassword((v) => !v)}
                aria-label={showPassword ? 'Hide password' : 'Show password'}
                aria-pressed={showPassword}
                tabIndex={-1}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
            {capsLockOn && (
              <div className="field-warning" role="status">
                Caps Lock is on
              </div>
            )}
          </div>
          <div className="field">
            <div className="captcha-label-row">
              <label htmlFor="login-captcha">{captchaLabel}</label>
              <button
                type="button"
                className="input-action-btn"
                onClick={onManualRefresh}
                disabled={busy}
                aria-label="Get a new captcha question"
              >
                <RefreshCw size={14} />
              </button>
            </div>
            <input
              id="login-captcha"
              className={`input${captchaError ? ' input-error' : ''}`}
              type="text"
              inputMode="numeric"
              value={captchaAnswer}
              onChange={(e) => setCaptchaAnswer(e.target.value)}
              placeholder="Your answer"
              required
              disabled={!captcha}
              aria-invalid={!!captchaError}
              aria-describedby={captchaDescribedBy}
              ref={captchaInputRef}
            />
            {captchaError && (
              <div className="field-error" id="login-captcha-error" role="alert">
                {captchaError}
              </div>
            )}
            {captchaDown && (
              <div className="field-error" id="login-captcha-down" role="alert">
                {CAPTCHA_DOWN_HINT}
              </div>
            )}
          </div>
          <button className="btn btn-primary" style={{ width: '100%', justifyContent: 'center', marginTop: 6 }} disabled={busy || !captcha}>
            {busy ? <div className="spinner" /> : 'Sign in'}
          </button>
        </form>

        <div className="login-footer">
          <LifeBuoy size={13} />
          <span>
            Trouble signing in? Contact{' '}
            <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
          </span>
        </div>
      </motion.div>
    </div>
  )
}
