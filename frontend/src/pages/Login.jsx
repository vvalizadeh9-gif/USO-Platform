// The UEP sign-in page (UEP-26). Layout and motion: src/styles/signin.css.
//
// One centred card on a deep cobalt band. Username first (Continue, which
// never calls the server), then the password. "Forgot password?" and "Need
// access?" open a help panel inside the card with the contact set by Admin.
// A lockout (429) shows a countdown from Retry-After instead of an error.
// Every sign-in lands on the landing page.
import { useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { reducedMotion } from '../lib/motionPreference'
import { forgetUsername, readRememberedUsername, rememberUsername } from '../lib/rememberedUsername'
import { sessionExpiredFrom } from '../lib/returnTo'
import { SIGN_IN_MESSAGES, mapSignInError, validatePassword, validateUsername } from '../lib/signInErrors'
import AuthFrame, { SignedInCurtain } from './auth/AuthFrame'
import HelpPanel from './auth/HelpPanel'
import PasswordStep from './auth/PasswordStep'
import SignInNotice from './auth/SignInNotice'
import { shake } from './auth/signInModel'
import UsernameStep from './auth/UsernameStep'
import { useLockout } from './auth/useLockout'
import { useSignInSettings } from './auth/useSignInSettings'

/** How long the "Opening Home" curtain shows before navigating (at most 900 ms). */
const ARRIVAL_MS = 900

const STEP = Object.freeze({ USERNAME: 'username', PASSWORD: 'password', HELP: 'help' })

function initialStep(remembered, search) {
  if (new URLSearchParams(search).get('help') === '1') return STEP.HELP
  return remembered ? STEP.PASSWORD : STEP.USERNAME
}

/**
 * @param {{ onArriving?: (arriving: boolean) => void }} props
 *   onArriving: told when a sign-in succeeded and the curtain is showing, so
 *   the route can hold off its own redirect until the page navigates.
 */
export default function Login({ onArriving = () => {} }) {
  const { login } = useAuth()
  const navigate = useNavigate()
  const location = useLocation()
  const settings = useSignInSettings()
  const sessionExpired = sessionExpiredFrom(location.search)

  // Read once: the box starts ticked exactly when a name was remembered.
  const [remembered] = useState(readRememberedUsername)
  const [step, setStep] = useState(() => initialStep(remembered, location.search))
  // Where the help panel's Back returns to.
  const [helpFrom, setHelpFrom] = useState(remembered ? STEP.PASSWORD : STEP.USERNAME)
  // 'first' on load (the staggered entrance), then the slide direction.
  const [entry, setEntry] = useState('first')
  const [username, setUsername] = useState(remembered)
  const [rememberMe, setRememberMe] = useState(Boolean(remembered))
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [usernameError, setUsernameError] = useState('')
  const [passwordError, setPasswordError] = useState('')
  const [busy, setBusy] = useState(false)
  const [arrived, setArrived] = useState(false)
  const lockout = useLockout()

  const usernameRef = useRef(null)
  const usernameWrapRef = useRef(null)
  const passwordRef = useRef(null)
  const passwordWrapRef = useRef(null)
  const helpBackRef = useRef(null)
  // Set when going back to step 1, so the name is selected for retyping.
  const selectUsername = useRef(false)
  // The pending "go to the landing page" after a sign-in. Cancelled if the
  // page goes away first, so a stale navigation never fires later.
  const arrivalTimer = useRef(null)
  useEffect(() => () => clearTimeout(arrivalTimer.current), [])

  // Focus follows the step. On load too: the first thing to type is focused.
  useEffect(() => {
    if (step === STEP.USERNAME) {
      usernameRef.current?.focus()
      if (selectUsername.current) usernameRef.current?.select()
      selectUsername.current = false
    } else if (step === STEP.PASSWORD) {
      passwordRef.current?.focus()
    } else {
      helpBackRef.current?.focus()
    }
  }, [step])

  // When a lockout ends, the field is usable again: put the caret back in it.
  useEffect(() => {
    if (!lockout.locked && step === STEP.PASSWORD && !busy) passwordRef.current?.focus()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lockout.locked])

  function go(next, direction) {
    setEntry(direction)
    setStep(next)
  }

  function openHelp() {
    setHelpFrom(step === STEP.HELP ? helpFrom : step)
    go(STEP.HELP, 'fwd')
  }

  function onContinue(e) {
    e.preventDefault()
    const problem = validateUsername(username)
    if (problem) {
      setUsernameError(problem)
      shake(usernameWrapRef.current)
      usernameRef.current?.focus()
      return
    }
    setUsername(username.trim())
    go(STEP.PASSWORD, 'fwd')
  }

  function onNotYou() {
    setPassword('')
    setPasswordError('')
    selectUsername.current = true
    go(STEP.USERNAME, 'bwd')
  }

  function handleCapsLock(e) {
    if (typeof e.getModifierState === 'function') setCapsLockOn(e.getModifierState('CapsLock'))
  }

  function refusePassword(message) {
    setPasswordError(message)
    shake(passwordWrapRef.current)
    passwordRef.current?.focus()
  }

  function arrive() {
    setArrived(true)
    const delay = reducedMotion() ? 0 : ARRIVAL_MS
    // Every sign-in lands on the landing page ("/" resolves to the role's home).
    arrivalTimer.current = setTimeout(() => navigate('/', { replace: true }), delay)
  }

  async function onSignIn(e) {
    e.preventDefault()
    if (busy || arrived || lockout.locked) return
    const problem = validatePassword(password)
    if (problem) {
      refusePassword(problem)
      return
    }
    setBusy(true)
    // Told before the request, so the route never redirects on the user
    // appearing before the curtain has had its moment.
    onArriving(true)
    try {
      await login(username, password)
      if (rememberMe) rememberUsername(username)
      else forgetUsername()
      setBusy(false)
      arrive()
    } catch (err) {
      onArriving(false)
      setBusy(false)
      setPassword('')
      const refusal = mapSignInError(err)
      if (refusal.kind === 'lockout') {
        setPasswordError('')
        lockout.start(refusal.retryAfter)
        return
      }
      refusePassword(refusal.message)
    }
  }

  const notices = step !== STEP.HELP && (settings.notice || sessionExpired) && (
    <>
      {settings.notice && <SignInNotice>{settings.notice.text}</SignInNotice>}
      {sessionExpired && <SignInNotice>{SIGN_IN_MESSAGES.sessionExpired}</SignInNotice>}
    </>
  )

  return (
    <AuthFrame overlay={arrived && !reducedMotion() ? <SignedInCurtain /> : null}>
      <div key={step} className={`uep-signin-step is-${entry}`}>
        {step === STEP.HELP ? (
          <HelpPanel ref={helpBackRef} support={settings.support} onBack={() => go(helpFrom, 'bwd')} />
        ) : (
          <>
            <h1 className="uep-signin-heading uep-signin-stg" style={{ '--k': -1 }}>Sign in</h1>
            {notices}
            {step === STEP.USERNAME ? (
              <UsernameStep
                username={username}
                onUsernameChange={(v) => {
                  setUsername(v)
                  setUsernameError('')
                }}
                error={usernameError}
                rememberMe={rememberMe}
                onRememberChange={setRememberMe}
                onContinue={onContinue}
                onNeedAccess={openHelp}
                inputRef={usernameRef}
                wrapRef={usernameWrapRef}
              />
            ) : (
              <PasswordStep
                username={username}
                onNotYou={onNotYou}
                password={password}
                onPasswordChange={(v) => {
                  setPassword(v)
                  setPasswordError('')
                }}
                showPassword={showPassword}
                onToggleShow={() => setShowPassword((v) => !v)}
                capsLockOn={capsLockOn}
                onCapsKey={handleCapsLock}
                error={passwordError}
                lockout={lockout}
                busy={busy}
                arrived={arrived}
                onSubmit={onSignIn}
                onForgot={openHelp}
                inputRef={passwordRef}
                wrapRef={passwordWrapRef}
              />
            )}
          </>
        )}
      </div>
    </AuthFrame>
  )
}
