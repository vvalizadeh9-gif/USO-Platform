// Step 2 of signing in: the password, for the username chosen on step 1
// (UEP-26). The account chip goes back ("Not you?"); a lockout replaces the
// error with a calm countdown.
import Icon from '../../components/Icon'
import { formatCountdown } from '../../lib/signInErrors'
import FieldMessage from './FieldMessage'
import LockoutBox from './LockoutBox'
import { usernameInitials } from './signInModel'

const stg = (k) => ({ '--k': k })

function submitLabel({ arrived, locked, remaining, busy }) {
  if (arrived) return 'Signed in'
  if (locked) return `Try again in ${formatCountdown(remaining)}`
  if (busy) return 'Signing in…'
  return 'Sign in'
}

/**
 * @param {{
 *   username: string, onNotYou: () => void,
 *   password: string, onPasswordChange: (v: string) => void,
 *   showPassword: boolean, onToggleShow: () => void,
 *   capsLockOn: boolean, onCapsKey: (e: import('react').KeyboardEvent) => void,
 *   error: string, lockout: { locked: boolean, remaining: number, total: number },
 *   busy: boolean, arrived: boolean,
 *   onSubmit: (e: import('react').FormEvent) => void, onForgot: () => void,
 *   inputRef: import('react').Ref<HTMLInputElement>, wrapRef: import('react').Ref<HTMLDivElement>,
 * }} props
 */
export default function PasswordStep({
  username, onNotYou, password, onPasswordChange, showPassword, onToggleShow, capsLockOn, onCapsKey,
  error, lockout, busy, arrived, onSubmit, onForgot, inputRef, wrapRef,
}) {
  const { locked, remaining, total } = lockout
  const blocked = busy || locked || arrived
  return (
    <form onSubmit={onSubmit} noValidate aria-busy={busy}>
      <button
        type="button"
        className="uep-signin-account uep-signin-stg"
        style={stg(0)}
        onClick={onNotYou}
        aria-label={`Signing in as ${username}. Not you? Change username`}
      >
        <span className="uep-signin-avatar" aria-hidden="true">{usernameInitials(username)}</span>
        <b dir="ltr">{username}</b>
        <span className="uep-signin-account-switch">Not you?</span>
      </button>

      {locked && <LockoutBox remaining={remaining} total={total} />}

      <div className="uep-signin-field uep-signin-stg" style={stg(1)}>
        <div className="uep-signin-label-row">
          <label htmlFor="login-password" className="uep-signin-label">Password</label>
          <button type="button" className="uep-signin-link" onClick={onForgot}>
            Forgot password?
          </button>
        </div>
        <div className="uep-signin-input-wrap" ref={wrapRef} onAnimationEnd={(e) => e.currentTarget.classList.remove('is-shaking')}>
          <Icon name="password" size={18} className="uep-signin-input-icon" />
          <input
            id="login-password"
            ref={inputRef}
            className="uep-signin-input uep-signin-input-reveal"
            type={showPassword ? 'text' : 'password'}
            value={password}
            onChange={(e) => onPasswordChange(e.target.value)}
            onKeyDown={onCapsKey}
            onKeyUp={onCapsKey}
            dir="ltr"
            autoComplete="current-password"
            disabled={locked}
            aria-invalid={error ? true : undefined}
            aria-describedby="login-password-error login-capslock"
          />
          <button
            type="button"
            className="uep-signin-reveal"
            onClick={onToggleShow}
            aria-label={showPassword ? 'Hide password' : 'Show password'}
            aria-controls="login-password"
          >
            <Icon name={showPassword ? 'view--off' : 'view'} size={18} />
          </button>
        </div>
        <FieldMessage id="login-capslock" tone="hint" message={capsLockOn ? 'Caps Lock is on' : ''} />
        <FieldMessage id="login-password-error" message={locked ? '' : error} />
      </div>

      <button
        type="submit"
        className={`uep-signin-submit uep-signin-stg${locked ? ' is-locked' : ''}`}
        style={stg(2)}
        aria-disabled={blocked || undefined}
        aria-busy={busy || undefined}
      >
        {submitLabel({ arrived, locked, remaining, busy })}
        {busy ? (
          <span className="uep-signin-spinner" aria-hidden="true" />
        ) : (
          <Icon name={arrived ? 'checkmark' : 'login'} size={18} className="uep-signin-submit-icon" />
        )}
      </button>
    </form>
  )
}
