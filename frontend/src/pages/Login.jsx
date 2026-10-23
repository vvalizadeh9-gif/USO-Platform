// The UEP sign-in page. Design: docs/design-system.md and the UEP-01 spec.
//
// Left half: the form. Right half: the brand statement on deep cobalt, with
// signal waves spreading from the bottom-right corner. Below 960px the brand
// half is hidden and the form stands alone.
import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import api from '../api/client'
import Icon from '../components/Icon'
import { useAuth } from '../context/AuthContext'
import { toLatinDigits } from '../lib/persianDigits'
import { forgetUsername, readRememberedUsername, rememberUsername } from '../lib/rememberedUsername'
import { sessionExpiredFrom } from '../lib/returnTo'
import { SIGN_IN_MESSAGES, mapSignInError, validateCredentials } from '../lib/signInErrors'
import { AUTH_LINKS, AuthFooter, AuthLogo } from './auth/AuthFrame'

// Failed sign-ins in this tab after which the security check is shown. The
// server decides for itself when it is required (and says so with a 400), so
// this only saves the person a round trip; it is not the control.
const CAPTCHA_AFTER_FAILURES = 2

const BRAND_WORDS = ['USO', 'Enterprise', 'Platform']

/** The entrance stagger: each step is one --uep-signin-stagger-step later. */
const step = (i) => ({ '--uep-i': i })

export default function Login() {
  return (
    <div className="uep-signin">
      <div className="uep-signin-side">
        <a className="uep-signin-skip" href="#login-username">
          Skip to sign-in form
        </a>
        <AuthLogo className="uep-enter" style={step(0)} />
        <main className="uep-signin-center">
          <SignInForm />
        </main>
        <AuthFooter className="uep-enter" style={step(5)} />
      </div>
      <BrandPanel />
    </div>
  )
}

function BrandPanel() {
  return (
    <aside className="uep-signin-brand" aria-label="USO Enterprise Platform">
      <div className="uep-signin-waves" aria-hidden="true">
        {[0, 1, 2, 3].map((i) => (
          <span key={i} className="uep-signin-wave" style={{ '--uep-wave': i }} />
        ))}
      </div>
      <p className="uep-signin-statement">
        {BRAND_WORDS.map((word, i) => (
          <span key={word} className="uep-signin-word-mask">
            <span className="uep-signin-word" style={{ '--uep-word': i }}>
              {word}
            </span>
          </span>
        ))}
      </p>
      <span className="uep-signin-rule" aria-hidden="true" />
    </aside>
  )
}

function SignInForm() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const sessionExpired = sessionExpiredFrom(location.search)

  // Read once: the box starts ticked exactly when a name was remembered.
  const [remembered] = useState(readRememberedUsername)
  const [username, setUsername] = useState(remembered)
  const [rememberMe, setRememberMe] = useState(Boolean(remembered))
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [failures, setFailures] = useState(0)
  const [captchaShown, setCaptchaShown] = useState(false)
  const [captcha, setCaptcha] = useState(null)
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  // The one message under the password field: empty fields, wrong
  // credentials, a lockout.
  const [formError, setFormError] = useState('')
  const [captchaError, setCaptchaError] = useState('')
  const [invalid, setInvalid] = useState({ username: false, password: false })
  // Bumped on every refusal (with a fresh object), so focus moves each time.
  const [focusTarget, setFocusTarget] = useState(null)

  const usernameRef = useRef(null)
  const passwordRef = useRef(null)
  const captchaRef = useRef(null)

  useEffect(() => {
    const refs = { username: usernameRef, password: passwordRef, captcha: captchaRef }
    if (focusTarget) refs[focusTarget.field]?.current?.focus()
  }, [focusTarget])

  async function refreshCaptcha() {
    setCaptcha(null)
    setCaptchaAnswer('')
    try {
      const { data } = await api.get('/auth/captcha')
      setCaptcha(data)
    } catch {
      // Left on "Loading"; the next submit asks again.
    }
  }

  function showCaptcha() {
    setCaptchaShown(true)
    refreshCaptcha()
  }

  // Any change to a field clears what was said about the last attempt.
  function clearMessages() {
    setFormError('')
    setInvalid({ username: false, password: false })
  }

  function handleCapsLock(e) {
    if (typeof e.getModifierState === 'function') setCapsLockOn(e.getModifierState('CapsLock'))
  }

  function refuse(message, field) {
    setFormError(message)
    setFocusTarget({ field })
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return

    const problem = validateCredentials({ username, password })
    if (problem) {
      setInvalid(problem.missing)
      refuse(problem.message, problem.missing.username ? 'username' : 'password')
      return
    }
    // Persian and Arabic-Indic keyboards type their own digits; the server
    // parses the answer as an integer.
    const answer = toLatinDigits(captchaAnswer).trim()
    if (captchaShown && !/^-?\d+$/.test(answer)) {
      setCaptchaError(SIGN_IN_MESSAGES.captchaNotANumber)
      setFocusTarget({ field: 'captcha' })
      return
    }
    if (captchaShown && !captcha) {
      refreshCaptcha()
      return
    }

    setBusy(true)
    setCaptchaError('')
    try {
      await login(username.trim(), password, captchaShown ? captcha.token : undefined, answer)
      if (rememberMe) rememberUsername(username.trim())
      else forgetUsername()
      // Every sign-in lands on the landing page ("/" resolves to the role's home).
      navigate('/', { replace: true })
    } catch (err) {
      setPassword('')
      const refusal = mapSignInError(err, { captchaShown })
      if (refusal.kind === 'captcha') {
        showCaptcha()
        setCaptchaError(refusal.message)
        setFocusTarget({ field: 'captcha' })
        return
      }
      if (captchaShown) refreshCaptcha()
      if (refusal.countsAsFailure) {
        const next = failures + 1
        setFailures(next)
        if (!captchaShown && next >= CAPTCHA_AFTER_FAILURES) showCaptcha()
        setInvalid({ username: false, password: true })
      }
      refuse(refusal.message, 'password')
    } finally {
      setBusy(false)
    }
  }

  const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined

  return (
    <div className="uep-signin-column">
      <div className="uep-enter" style={step(1)}>
        <h1 className="uep-signin-title">Sign in</h1>
        <p className="uep-signin-subtitle">Enter your UEP username and password.</p>
      </div>

      {sessionExpired && (
        <p className="uep-signin-notice" role="status">
          {SIGN_IN_MESSAGES.sessionExpired}
        </p>
      )}

      <form onSubmit={onSubmit} noValidate aria-busy={busy}>
        <div className="uep-signin-field uep-enter" style={step(2)}>
          <label htmlFor="login-username" className="uep-signin-label">
            Username
          </label>
          <div className="uep-signin-input-wrap">
            <Icon name="user" size={18} className="uep-signin-input-icon" />
            <input
              id="login-username"
              ref={usernameRef}
              className="uep-signin-input"
              value={username}
              onChange={(e) => {
                setUsername(e.target.value)
                clearMessages()
              }}
              placeholder="v.valizadeh"
              // Always left to right: a Farsi keyboard must not flip a Latin
              // username around the caret.
              dir="ltr"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              // With a remembered name the next thing to type is the password.
              autoFocus={!remembered}
              aria-invalid={invalid.username || undefined}
              aria-describedby={describedBy(formError && 'login-form-error')}
            />
          </div>
        </div>

        <div className="uep-signin-field uep-enter" style={step(3)}>
          <div className="uep-signin-label-row">
            <label htmlFor="login-password" className="uep-signin-label">
              Password
            </label>
            <Link to={AUTH_LINKS.forgotPassword} className="uep-signin-link uep-signin-forgot">
              Forgot password?
            </Link>
          </div>
          <div className="uep-signin-input-wrap">
            <Icon name="password" size={18} className="uep-signin-input-icon" />
            <input
              id="login-password"
              ref={passwordRef}
              className="uep-signin-input uep-signin-input-reveal"
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => {
                setPassword(e.target.value)
                clearMessages()
              }}
              onKeyDown={handleCapsLock}
              onKeyUp={handleCapsLock}
              dir="ltr"
              autoComplete="current-password"
              autoFocus={Boolean(remembered)}
              aria-invalid={invalid.password || undefined}
              aria-describedby={describedBy(formError && 'login-form-error', capsLockOn && 'login-capslock')}
            />
            <button
              type="button"
              className="uep-signin-reveal"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-controls="login-password"
            >
              <Icon name={showPassword ? 'view--off' : 'view'} size={18} />
            </button>
          </div>
          {/* Always in the document, so it exists before it has anything to
              say -- a region inserted with its message is often not read. */}
          <p id="login-form-error" role="alert" className="uep-signin-error">
            {formError}
          </p>
          <p id="login-capslock" role="status" className="uep-signin-hint">
            {capsLockOn && (
              <>
                <Icon name="warning--alt" size={16} />
                Caps Lock is on
              </>
            )}
          </p>
        </div>

        {captchaShown && (
          <div className="uep-signin-field">
            <label htmlFor="login-captcha" className="uep-signin-label">
              Security check
            </label>
            <div className="uep-signin-captcha-row">
              <span className="uep-signin-captcha-sum" id="login-captcha-question" dir="ltr">
                {captcha ? `${captcha.num1} + ${captcha.num2} =` : 'Loading…'}
              </span>
              <input
                id="login-captcha"
                ref={captchaRef}
                className="uep-signin-input uep-signin-input-plain"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                value={captchaAnswer}
                onChange={(e) => {
                  setCaptchaAnswer(e.target.value)
                  setCaptchaError('')
                }}
                disabled={!captcha}
                aria-invalid={captchaError ? true : undefined}
                aria-describedby={describedBy('login-captcha-question', captchaError && 'login-captcha-error')}
              />
              <button
                type="button"
                className="uep-signin-icon-btn"
                onClick={refreshCaptcha}
                disabled={busy}
                aria-label="New question"
              >
                <Icon name="renew" size={18} />
              </button>
            </div>
            {captchaError && (
              <p id="login-captcha-error" className="uep-signin-error">
                {captchaError}
              </p>
            )}
          </div>
        )}

        <div className="uep-enter" style={step(4)}>
          <label className="uep-signin-check">
            <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
            Remember my username
          </label>
          <button type="submit" className="uep-signin-submit" aria-disabled={busy || undefined}>
            Sign in
            {busy ? (
              <span className="uep-signin-spinner" aria-hidden="true" />
            ) : (
              <Icon name="login" size={18} className="uep-signin-submit-icon" />
            )}
          </button>
          <p className="sr-only" aria-live="polite">
            {busy ? 'Signing in…' : ''}
          </p>
        </div>
      </form>

      <p className="uep-signin-access uep-enter" style={step(5)}>
        Need access?{' '}
        <Link to={AUTH_LINKS.requestAccess} className="uep-signin-link">
          Contact your UEP administrator
        </Link>
      </p>
    </div>
  )
}
