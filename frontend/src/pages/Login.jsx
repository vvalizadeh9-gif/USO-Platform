import { AlertTriangle, ArrowLeft, CheckCircle2, LifeBuoy } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import BrandMark from '../components/BrandMark'
import { useAuth } from '../context/AuthContext'
import { toLatinDigits } from '../lib/persianDigits'

const SUPPORT_EMAIL = 'vahid.val@mtnirancell.ir'
const UNLOCK_MAILTO = `mailto:${SUPPORT_EMAIL}?subject=${encodeURIComponent('Please unlock my UEP account')}`
// TODO: the privacy notice and accessibility statement are not published yet.
// Point these at them once they are.
const PRIVACY_NOTICE_URL = '#'
const ACCESSIBILITY_STATEMENT_URL = '#'

// Failed sign-ins in this tab after which the security check is shown. The
// server decides for itself when it is required (and says so with a 400), so
// this only saves the person a round trip; it is not the control.
const CAPTCHA_AFTER_FAILURES = 2

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
      <header className="signin-panel">
        <div className="signin-rings" aria-hidden="true">
          <span />
          <span />
          <span />
          <span />
        </div>
        <div className="signin-panel-brand">
          <BrandMark size={40} />
          <span>UEP</span>
        </div>
        <div className="signin-panel-copy">
          {/* A paragraph, not a heading: the page's h1 is the form's. */}
          <p className="signin-panel-title">USO Enterprise Platform</p>
          <p className="signin-panel-lede">
            One platform for the entire Universal Service Obligation project.
          </p>
        </div>
      </header>

      <div className="signin-column">
        <a
          className="signin-skip"
          href="#login-username"
          onClick={(e) => {
            // The input may not be in the document (another view is showing);
            // then the link has nowhere to go and does nothing.
            e.preventDefault()
            usernameRef.current?.focus()
          }}
        >
          Skip to sign-in form
        </a>

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
          <p className="signin-support">
            <LifeBuoy size={16} aria-hidden="true" />
            <span>
              Trouble signing in? Contact <a href={`mailto:${SUPPORT_EMAIL}`}>{SUPPORT_EMAIL}</a>
            </span>
          </p>
          <nav aria-label="Legal">
            <ul className="signin-legal">
              <li>
                <a href={PRIVACY_NOTICE_URL}>Privacy notice</a>
              </li>
              <li>
                <a href={ACCESSIBILITY_STATEMENT_URL}>Accessibility statement</a>
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
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [failures, setFailures] = useState(0)
  const [captchaShown, setCaptchaShown] = useState(false)
  const [captcha, setCaptcha] = useState(null)
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  // Field errors, keyed by input id, shown inline and listed in the summary.
  const [errors, setErrors] = useState({})
  // An error that belongs to no one field: wrong credentials, a lockout.
  const [formError, setFormError] = useState(null)
  // Bumped on every refused submit, so the summary takes focus each time, not
  // only the first.
  const [attempt, setAttempt] = useState(0)
  const summaryRef = useRef(null)
  const passwordRef = useRef(null)
  const captchaInputRef = useRef(null)

  useEffect(() => {
    if (attempt > 0) summaryRef.current?.focus()
  }, [attempt])

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

  function refuse(nextErrors, nextFormError = null) {
    setErrors(nextErrors)
    setFormError(nextFormError)
    setAttempt((n) => n + 1)
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
      navigate('/')
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
        refuse({}, { text: 'The username or password is incorrect', target: 'login-username' })
      } else if (status === 429 || status === 403) {
        // A lockout, or an account an administrator has suspended. The server's
        // own sentence says which and for how long.
        if (captchaShown) refreshCaptcha()
        refuse({}, { text: err.response?.data?.detail || 'You cannot sign in right now' })
      } else {
        if (captchaShown) refreshCaptcha()
        refuse({}, { text: 'The platform could not be reached. Check your connection and try again' })
      }
    } finally {
      setBusy(false)
    }
  }

  const fieldRefs = {
    'login-username': usernameRef,
    'login-password': passwordRef,
    'login-captcha': captchaInputRef,
  }
  const summaryItems = [
    ...(formError ? [{ id: formError.target, text: formError.text }] : []),
    ...Object.entries(errors).map(([id, text]) => ({ id, text })),
  ]

  const describedBy = (...ids) => ids.filter(Boolean).join(' ') || undefined

  return (
    <>
      <h1 className="signin-heading">Sign in</h1>
      <p className="signin-sub">Use the account your administrator gave you.</p>

      {summaryItems.length > 0 && (
        <div className="signin-summary" role="alert" tabIndex={-1} ref={summaryRef} aria-labelledby="login-summary-title">
          <h2 id="login-summary-title">There is a problem</h2>
          <ul>
            {summaryItems.map((item) => (
              <li key={item.text}>
                {item.id ? (
                  <button type="button" onClick={() => fieldRefs[item.id].current?.focus()}>
                    {item.text}
                  </button>
                ) : (
                  item.text
                )}
              </li>
            ))}
          </ul>
        </div>
      )}

      <form onSubmit={onSubmit} noValidate aria-busy={busy}>
        <div className="signin-field">
          <label htmlFor="login-username">Username</label>
          {errors['login-username'] && (
            <p className="signin-error" id="login-username-error">
              <span className="sr-only">Error: </span>
              {errors['login-username']}
            </p>
          )}
          <input
            id="login-username"
            ref={usernameRef}
            className={`signin-input${errors['login-username'] ? ' signin-input-invalid' : ''}`}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            autoFocus
            aria-invalid={errors['login-username'] ? true : undefined}
            aria-describedby={describedBy(errors['login-username'] && 'login-username-error')}
          />
        </div>

        <div className="signin-field">
          <label htmlFor="login-password">Password</label>
          {errors['login-password'] && (
            <p className="signin-error" id="login-password-error">
              <span className="sr-only">Error: </span>
              {errors['login-password']}
            </p>
          )}
          <div className="signin-password">
            <input
              id="login-password"
              ref={passwordRef}
              className={`signin-input${errors['login-password'] ? ' signin-input-invalid' : ''}`}
              type={showPassword ? 'text' : 'password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              onKeyDown={handlePasswordKeyEvent}
              onKeyUp={handlePasswordKeyEvent}
              autoComplete="current-password"
              aria-invalid={errors['login-password'] ? true : undefined}
              aria-describedby={describedBy(errors['login-password'] && 'login-password-error', 'login-capslock')}
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
          {/* Always in the document, so the live region exists before it has
              anything to say -- one inserted with its message is often not
              announced. */}
          <div id="login-capslock" role="status" className="signin-capslock">
            {capsLockOn && (
              <>
                <AlertTriangle size={16} aria-hidden="true" />
                Caps Lock is on
              </>
            )}
          </div>
          <button type="button" className="signin-text-btn" onClick={onForgot}>
            Forgot your password?
          </button>
        </div>

        {captchaShown && (
          <div className="signin-captcha">
            <label htmlFor="login-captcha">
              {captcha ? `Security check: what is ${captcha.num1} + ${captcha.num2}?` : 'Loading the security check…'}
            </label>
            <p className="signin-hint" id="login-captcha-hint">Shown after repeated failed attempts.</p>
            {errors['login-captcha'] && (
              <p className="signin-error" id="login-captcha-error">
                <span className="sr-only">Error: </span>
                {errors['login-captcha']}
              </p>
            )}
            <div className="signin-captcha-row">
              <input
                id="login-captcha"
                ref={captchaInputRef}
                className={`signin-input signin-input-short${errors['login-captcha'] ? ' signin-input-invalid' : ''}`}
                type="text"
                inputMode="numeric"
                autoComplete="off"
                value={captchaAnswer}
                onChange={(e) => setCaptchaAnswer(e.target.value)}
                disabled={!captcha}
                aria-invalid={errors['login-captcha'] ? true : undefined}
                aria-describedby={describedBy('login-captcha-hint', errors['login-captcha'] && 'login-captcha-error')}
              />
              <button type="button" className="signin-text-btn" onClick={refreshCaptcha} disabled={busy}>
                New question
              </button>
            </div>
            {/* WCAG 3.3.8: a way in that does not depend on solving a puzzle. */}
            <p className="signin-captcha-alt">
              Can&rsquo;t complete this check? <a href={UNLOCK_MAILTO}>Ask an administrator to unlock your account</a>
            </p>
          </div>
        )}

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
// temporary password.
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
      // more about the account than the success case does. The administrator
      // is reachable by the address in the footer either way.
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
        Ask for a password reset
      </h1>
      <p className="signin-sub">
        An administrator will check who you are and give you a temporary password. Nothing is sent by email.
      </p>
      <form onSubmit={submit} noValidate aria-busy={busy}>
        <div className="signin-field">
          <label htmlFor="forgot-identifier">Username or email address</label>
          {error && (
            <p className="signin-error" id="forgot-identifier-error">
              <span className="sr-only">Error: </span>
              {error}
            </p>
          )}
          <input
            id="forgot-identifier"
            ref={inputRef}
            className={`signin-input${error ? ' signin-input-invalid' : ''}`}
            value={identifier}
            onChange={(e) => setIdentifier(e.target.value)}
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? 'forgot-identifier-error' : undefined}
          />
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
        If that account exists, an administrator has been notified and will be in touch to reset the password. They
        will give you a temporary one, and you will be asked to choose your own when you sign in.
      </p>
      <button type="button" className="signin-secondary" onClick={onBack}>
        Back to sign in
      </button>
    </>
  )
}
