import { AlertCircle, AlertTriangle, ArrowLeft, CheckCircle2, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from '../api/client'
import BrandMark from '../components/BrandMark'
import { useAuth } from '../context/AuthContext'
import { toLatinDigits } from '../lib/persianDigits'
import { forgetUsername, readRememberedUsername, rememberUsername } from '../lib/rememberedUsername'
import { returnPathFrom } from '../lib/returnTo'

// TODO: the privacy notice and accessibility statement are not published yet.
// Point these at them once they are.
const PRIVACY_NOTICE_URL = '#'
const ACCESSIBILITY_STATEMENT_URL = '#'

// Failed sign-ins in this tab after which the security check is shown. The
// server decides for itself when it is required (and says so with a 400), so
// this only saves the person a round trip; it is not the control.
const CAPTCHA_AFTER_FAILURES = 2

// The order focus looks for the first field with a problem in.
const FIELD_ORDER = ['login-username', 'login-password', 'login-captcha']

export default function Login() {
  // 'signin' | 'forgot' | 'sent'
  const [view, setView] = useState('signin')
  const headingRef = useRef(null)
  const usernameRef = useRef(null)
  const firstRender = useRef(true)

  // Every view change moves focus, so a screen reader hears where it landed
  // instead of silence: to the new view's heading, or back to the username
  // when returning to the form.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false
      return
    }
    if (view === 'signin') usernameRef.current?.focus()
    else headingRef.current?.focus()
  }, [view])

  return (
    <div className="signin">
      {/* Brand colour, the product's name and nothing else -- the way
          Microsoft and Okta do it. Decoration here competes with the form. */}
      <header className="signin-panel">
        <span className="signin-panel-brand">UEP</span>
        {/* A paragraph, not a heading: the page's h1 is the form's. */}
        <p className="signin-panel-title">USO Enterprise Platform</p>
      </header>

      <div className="signin-column">
        {/* Only while its target exists: on the help views there is no
            username field to skip to, and a dead skip link fails WCAG. */}
        {view === 'signin' && (
          <a
            className="signin-skip"
            href="#login-username"
            onClick={(e) => {
              e.preventDefault()
              usernameRef.current?.focus()
            }}
          >
            Skip to sign-in form
          </a>
        )}

        <main className="signin-main">
          <div className="signin-mobile-brand">
            <BrandMark size={34} />
            <div>
              <b>UEP</b>
              <small>USO Enterprise Platform</small>
            </div>
          </div>

          <div className="signin-body">
            {view === 'signin' && (
              <SignInForm usernameRef={usernameRef} onForgot={() => setView('forgot')} />
            )}
            {view === 'forgot' && (
              <ForgotPassword
                headingRef={headingRef}
                onBack={() => setView('signin')}
                onSent={() => setView('sent')}
              />
            )}
            {view === 'sent' && <RequestSent headingRef={headingRef} onBack={() => setView('signin')} />}
          </div>
        </main>

        <footer className="signin-footer">
          <nav aria-label="Legal">
            <ul className="signin-legal">
              <li>
                <a href={PRIVACY_NOTICE_URL}>Privacy</a>
              </li>
              <li>
                <a href={ACCESSIBILITY_STATEMENT_URL}>Accessibility</a>
              </li>
            </ul>
          </nav>
        </footer>
      </div>
    </div>
  )
}

function SignInForm({ usernameRef, onForgot }) {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
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
  // Field errors, keyed by input id, shown under their own field.
  const [errors, setErrors] = useState({})
  // A problem that belongs to no one field: wrong credentials, a lockout.
  const [formError, setFormError] = useState('')
  // The field to focus after a refusal. Bumped on every refusal (with a fresh
  // object), so focus moves each time, not only the first.
  const [focusTarget, setFocusTarget] = useState(null)
  const passwordRef = useRef(null)
  const captchaInputRef = useRef(null)

  const fieldRefs = {
    'login-username': usernameRef,
    'login-password': passwordRef,
    'login-captcha': captchaInputRef,
  }

  useEffect(() => {
    if (focusTarget) fieldRefs[focusTarget.id]?.current?.focus()
    // fieldRefs holds refs, which are stable; only a new target should move focus.
    // eslint-disable-next-line react-hooks/exhaustive-deps
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

  function handlePasswordKeyEvent(e) {
    if (typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'))
    }
  }

  // Show what is wrong and put the person on the first field to fix: a field
  // with its own problem, else the password, which a refusal has just cleared.
  function refuse(nextErrors, nextFormError = '') {
    setErrors(nextErrors)
    setFormError(nextFormError)
    const first = FIELD_ORDER.find((id) => nextErrors[id]) || 'login-password'
    setFocusTarget({ id: first })
  }

  function rememberChoice() {
    if (rememberMe) rememberUsername(username.trim())
    else forgetUsername()
  }

  async function onSubmit(e) {
    e.preventDefault()
    if (busy) return

    // Persian and Arabic-Indic keyboards type their own digits; the server
    // parses the answer as an integer.
    const answer = toLatinDigits(captchaAnswer).trim()
    const found = {}
    if (!username.trim()) found['login-username'] = 'Enter your username'
    if (!password) found['login-password'] = 'Enter your password'
    if (captchaShown && !/^-?\d+$/.test(answer)) found['login-captcha'] = 'Enter the answer as a number'
    if (Object.keys(found).length) {
      refuse(found)
      return
    }
    if (captchaShown && !captcha) {
      refreshCaptcha()
      return
    }

    setBusy(true)
    try {
      await login(username, password, captchaShown ? captcha.token : undefined, answer)
      rememberChoice()
      // Back to the page that sent them here, if one did.
      navigate(returnPathFrom(location.search) ?? '/', { replace: true })
    } catch (err) {
      const status = err.response?.status
      setPassword('')
      if (status === 400) {
        // The server wants the security check, or the answer was wrong.
        const wasShown = captchaShown
        showCaptcha()
        refuse({
          'login-captcha': wasShown
            ? 'The answer is not right. Try the new question'
            : 'Answer the security check to sign in',
        })
      } else if (status === 401) {
        const next = failures + 1
        setFailures(next)
        if (captchaShown || next >= CAPTCHA_AFTER_FAILURES) showCaptcha()
        // One message for an unknown username and a wrong password alike, as
        // the server does: anything more specific tells a stranger which
        // usernames are real.
        refuse({}, 'The username or password is incorrect')
      } else if (status === 429 || status === 403) {
        // A lockout, or an account an administrator has suspended. The server's
        // own sentence says which and for how long.
        if (captchaShown) refreshCaptcha()
        refuse({}, err.response?.data?.detail || 'You cannot sign in right now')
      } else {
        if (captchaShown) refreshCaptcha()
        refuse({}, 'The platform could not be reached. Check your connection and try again')
      }
    } finally {
      setBusy(false)
    }
  }

  const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined
  const fieldError = (id) =>
    errors[id] && (
      <p className="signin-error" id={`${id}-error`}>
        <span className="sr-only">Error: </span>
        {errors[id]}
      </p>
    )

  return (
    <>
      {/* Below 900px the brand row above the form already shows the mark. */}
      <span className="signin-form-mark">
        <BrandMark size={44} />
      </span>
      <h1 className="signin-heading">Sign in to UEP</h1>

      <form onSubmit={onSubmit} noValidate aria-busy={busy}>
        <div className="signin-field">
          <label htmlFor="login-username">Username</label>
          <input
            id="login-username"
            ref={usernameRef}
            className={`signin-input${errors['login-username'] ? ' signin-input-invalid' : ''}`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            // Always left to right: switching to a Farsi keyboard must not flip
            // a Latin username around the caret.
            dir="ltr"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            // With a remembered name the next thing to type is the password.
            autoFocus={!remembered}
            aria-invalid={errors['login-username'] ? true : undefined}
            aria-describedby={describedBy(errors['login-username'] && 'login-username-error')}
          />
          {fieldError('login-username')}
        </div>

        <div className="signin-field">
          <div className="signin-label-row">
            <label htmlFor="login-password">Password</label>
            {/* The one way to get help, and WCAG 3.3.8's way in that does not
                depend on solving the security check: an administrator. */}
            <button type="button" className="signin-text-btn" onClick={onForgot}>
              Can&rsquo;t sign in?
            </button>
          </div>
          <div className="signin-password">
            <input
              id="login-password"
              ref={passwordRef}
              className={`signin-input${errors['login-password'] || formError ? ' signin-input-invalid' : ''}`}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handlePasswordKeyEvent}
              onKeyUp={handlePasswordKeyEvent}
              dir="ltr"
              autoComplete="current-password"
              autoFocus={Boolean(remembered)}
              aria-invalid={errors['login-password'] || formError ? true : undefined}
              aria-describedby={describedBy(
                errors['login-password'] && 'login-password-error',
                formError && 'login-form-error',
                'login-capslock',
              )}
            />
            <button
              type="button"
              className="signin-reveal"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              aria-controls="login-password"
            >
              {showPassword ? 'Hide' : 'Show'}
            </button>
          </div>
          {fieldError('login-password')}
          {/* Both regions are always in the document, so they exist before
              they have anything to say -- one inserted with its message is
              often not announced. */}
          <div id="login-form-error" role="alert" className="signin-form-error">
            {formError && (
              <>
                <AlertCircle size={16} aria-hidden="true" />
                {formError}
              </>
            )}
          </div>
          <div id="login-capslock" role="status" className="signin-capslock">
            {capsLockOn && (
              <>
                <AlertTriangle size={16} aria-hidden="true" />
                Caps Lock is on
              </>
            )}
          </div>
        </div>

        {captchaShown && (
          <div className="signin-field">
            <label htmlFor="login-captcha">Security check</label>
            <div className="signin-captcha-row">
              <span className="signin-captcha-sum" id="login-captcha-question" dir="ltr">
                {captcha ? `${captcha.num1} + ${captcha.num2} =` : 'Loading…'}
              </span>
              <input
                id="login-captcha"
                ref={captchaInputRef}
                className={`signin-input${errors['login-captcha'] ? ' signin-input-invalid' : ''}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                dir="ltr"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
                disabled={!captcha}
                aria-invalid={errors['login-captcha'] ? true : undefined}
                aria-describedby={describedBy('login-captcha-question', errors['login-captcha'] && 'login-captcha-error')}
              />
              <button
                type="button"
                className="signin-icon-btn"
                onClick={refreshCaptcha}
                disabled={busy}
                aria-label="New question"
              >
                <RefreshCw size={18} aria-hidden="true" />
              </button>
            </div>
            {fieldError('login-captcha')}
          </div>
        )}

        <label className="signin-check">
          <input type="checkbox" checked={rememberMe} onChange={(e) => setRememberMe(e.target.checked)} />
          Remember my username
        </label>

        <button type="submit" className="signin-submit" aria-disabled={busy || undefined}>
          {busy ? (
            <>
              <span className="signin-spinner" aria-hidden="true" />
              Signing in…
            </>
          ) : (
            'Sign in'
          )}
        </button>
        <p className="sr-only" aria-live="polite">
          {busy ? 'Signing in…' : ''}
        </p>
      </form>
    </>
  )
}

// "I cannot get in."
//
// The platform's only outgoing mail is the Action Center's daily digest, sent
// by a scheduled job to signed-in users' own addresses. Password resets stay
// out of band on purpose: a reset link would need a token table and an
// unauthenticated endpoint that mints credentials — the largest new attack
// surface in the system, for a few dozen internal users who all know their
// administrator. So this posts a message, and an administrator issues a
// temporary password. The same request is how a locked-out person, or one
// who cannot complete the security check, asks to be let back in.
//
// The confirmation is deliberately non-committal about whether the account
// exists, and the server answers identically either way: this form is
// reachable by anyone who can load the page, and an honest "no such user"
// would make it a way to find out who works here.
function ForgotPassword({ headingRef, onBack, onSent }) {
  const [identifier, setIdentifier] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const inputRef = useRef(null)

  async function submit(e) {
    e.preventDefault()
    if (busy) return
    if (!identifier.trim()) {
      setError('Enter your username or email address')
      inputRef.current?.focus()
      return
    }
    setBusy(true)
    try {
      await api.post('/auth/password-reset-request', { identifier: identifier.trim() })
    } catch {
      // Nothing here depends on the answer, and reporting a failure would say
      // more about the account than the success case does.
    } finally {
      setBusy(false)
      onSent()
    }
  }

  return (
    <>
      <button type="button" className="signin-back" onClick={onBack}>
        <ArrowLeft size={16} aria-hidden="true" /> Back to sign in
      </button>
      <h1 className="signin-heading" tabIndex={-1} ref={headingRef}>
        Ask an administrator for help
      </h1>
      <p className="signin-sub">
        They will check who you are and give you a temporary password. Nothing is sent by email.
      </p>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <div className="signin-field">
          <label htmlFor="forgot-identifier">Username or email address</label>
          <input
            id="forgot-identifier"
            ref={inputRef}
            className={`signin-input${error ? ' signin-input-invalid' : ''}`}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            dir="ltr"
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'forgot-identifier-error' : undefined}
          />
          {error && (
            <p className="signin-error" id="forgot-identifier-error">
              <span className="sr-only">Error: </span>
              {error}
            </p>
          )}
        </div>
        <button type="submit" className="signin-submit" aria-disabled={busy || undefined}>
          {busy ? (
            <>
              <span className="signin-spinner" aria-hidden="true" />
              Sending…
            </>
          ) : (
            'Send request'
          )}
        </button>
        <p className="sr-only" aria-live="polite">
          {busy ? 'Sending…' : ''}
        </p>
      </form>
    </>
  )
}

function RequestSent({ headingRef, onBack }) {
  return (
    <>
      <CheckCircle2 className="signin-success-icon" size={40} aria-hidden="true" />
      <h1 className="signin-heading" tabIndex={-1} ref={headingRef}>
        Request sent
      </h1>
      <p className="signin-sub">
        If that account exists, an administrator has been notified and will be in touch. They will give you a
        temporary password, and you will be asked to choose your own when you sign in.
      </p>
      <button type="button" className="signin-secondary" onClick={onBack}>
        Back to sign in
      </button>
    </>
  )
}
