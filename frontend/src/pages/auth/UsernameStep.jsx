// Step 1 of signing in: the username (UEP-26). Continue never calls the
// server, so the page says the same thing for every username, real or not.
import Icon from '../../components/Icon'
import FieldMessage from './FieldMessage'

const stg = (k) => ({ '--k': k })

/**
 * @param {{
 *   username: string, onUsernameChange: (v: string) => void, error: string,
 *   rememberMe: boolean, onRememberChange: (v: boolean) => void,
 *   onContinue: (e: import('react').FormEvent) => void, onNeedAccess: () => void,
 *   inputRef: import('react').Ref<HTMLInputElement>, wrapRef: import('react').Ref<HTMLDivElement>,
 * }} props
 */
export default function UsernameStep({
  username, onUsernameChange, error, rememberMe, onRememberChange, onContinue, onNeedAccess, inputRef, wrapRef,
}) {
  return (
    <>
      <form onSubmit={onContinue} noValidate>
        <div className="uep-signin-field uep-signin-stg" style={stg(0)}>
          <label htmlFor="login-username" className="uep-signin-label">Username</label>
          <div className="uep-signin-input-wrap" ref={wrapRef} onAnimationEnd={(e) => e.currentTarget.classList.remove('is-shaking')}>
            <Icon name="user" size={18} className="uep-signin-input-icon" />
            <input
              id="login-username"
              ref={inputRef}
              className="uep-signin-input"
              value={username}
              onChange={(e) => onUsernameChange(e.target.value)}
              placeholder="name.surname"
              // Always left to right: a Farsi keyboard must not flip a Latin
              // username around the caret.
              dir="ltr"
              autoComplete="username"
              autoCapitalize="none"
              spellCheck={false}
              aria-invalid={error ? true : undefined}
              aria-describedby="login-username-error"
            />
          </div>
          <FieldMessage id="login-username-error" message={error} />
        </div>
        <label className="uep-signin-check uep-signin-stg" style={stg(1)}>
          <input type="checkbox" checked={rememberMe} onChange={(e) => onRememberChange(e.target.checked)} />
          Remember my username
        </label>
        <button type="submit" className="uep-signin-submit uep-signin-stg" style={stg(2)}>
          Continue
          <Icon name="arrow--right" size={18} className="uep-signin-submit-icon" />
        </button>
      </form>
      <div className="uep-signin-divider" />
      <p className="uep-signin-access uep-signin-stg" style={stg(3)}>
        Need access?{' '}
        <button type="button" className="uep-signin-link" onClick={onNeedAccess}>
          Ask your UEP administrator
        </button>
      </p>
    </>
  )
}
