import { useCallback, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../components/Icon'
import { initialsOf } from '../lib/initials'
import AccountPopover from './AccountPopover'
import AppLauncher from './AppLauncher'
import GlobalSearch from './GlobalSearch'

/**
 * The slim header on every signed-in page: launcher, logo, breadcrumb,
 * global search and the account menu.
 */
export default function AppHeader({ user, apps, crumbs, onSignOut }) {
  const [open, setOpen] = useState(null) // 'launcher' | 'account' | null
  const launcherRef = useRef(null)
  const accountRef = useRef(null)
  const close = useCallback(() => setOpen(null), [])

  return (
    <header className="uep-header">
      <button
        ref={launcherRef}
        type="button"
        className={`uep-icon-btn ${open === 'launcher' ? 'is-open' : ''}`.trim()}
        aria-label="App launcher"
        aria-expanded={open === 'launcher'}
        onClick={() => setOpen(open === 'launcher' ? null : 'launcher')}
      >
        <Icon name="switcher" size={20} />
      </button>
      <Link to="/home" className="uep-logo" aria-label="UEP Home">
        <span className="uep-logo-tile" aria-hidden="true">U</span>
        <span className="uep-logo-word">UEP</span>
      </Link>
      {crumbs.length > 0 && (
        <nav className="uep-crumbs" aria-label="Breadcrumb">
          {crumbs.map((c) => (
            <span key={c.label}>
              <span aria-hidden="true">/</span>
              {c.to ? <Link to={c.to} state={c.state}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <GlobalSearch apps={apps} />
      <button
        ref={accountRef}
        type="button"
        className="uep-avatar"
        aria-label="Account menu"
        aria-expanded={open === 'account'}
        onClick={() => setOpen(open === 'account' ? null : 'account')}
      >
        {initialsOf(user?.full_name)}
      </button>
      {open === 'launcher' && <AppLauncher apps={apps} onClose={close} openerRef={launcherRef} />}
      {open === 'account' && (
        <AccountPopover user={user} onClose={close} onSignOut={onSignOut} openerRef={accountRef} />
      )}
    </header>
  )
}
