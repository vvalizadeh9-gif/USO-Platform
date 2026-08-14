import { motion } from 'framer-motion'
import { Eye, EyeOff, LifeBuoy, RefreshCw } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'

const SUPPORT_EMAIL = 'vahid.val@mtnirancell.ir'

export default function Login() {
  const { login } = useAuth()
  const navigate = useNavigate()
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [showPassword, setShowPassword] = useState(false)
  const [capsLockOn, setCapsLockOn] = useState(false)
  const [captcha, setCaptcha] = useState(null)
  const [captchaAnswer, setCaptchaAnswer] = useState('')
  const [busy, setBusy] = useState(false)
  const [formError, setFormError] = useState('')
  const [captchaError, setCaptchaError] = useState('')
  const captchaInputRef = useRef(null)

  useEffect(() => {
    refreshCaptcha()
  }, [])

  async function refreshCaptcha() {
    setCaptchaAnswer('')
    setCaptchaError('')
    const { data } = await api.get('/auth/captcha')
    setCaptcha(data)
  }

  function handlePasswordKeyEvent(e) {
    if (typeof e.getModifierState === 'function') {
      setCapsLockOn(e.getModifierState('CapsLock'))
    }
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
    } catch (err) {
      if (err.response?.status === 400) {
        setCaptchaError('Captcha answer is incorrect. Try again.')
      } else {
        setFormError('Check your username and password and try again.')
      }
      refreshCaptcha()
    } finally {
      setBusy(false)
    }
  }

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
              <label htmlFor="login-captcha">
                {captcha ? `What is ${captcha.num1} + ${captcha.num2}?` : 'Loading captcha…'}
              </label>
              <button
                type="button"
                className="input-action-btn"
                onClick={refreshCaptcha}
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
              aria-describedby={captchaError ? 'login-captcha-error' : undefined}
              ref={captchaInputRef}
            />
            {captchaError && (
              <div className="field-error" id="login-captcha-error" role="alert">
                {captchaError}
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
