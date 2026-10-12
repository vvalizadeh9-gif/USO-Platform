import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import Icon from '../components/Icon'
import { initialsOf } from '../lib/initials'
import AccountPopover from './AccountPopover'
import AppLauncher from './AppLauncher'
import { appRoute } from './appRegistry'

/** The single tenant/project today; a list once UEP is multi-tenant. */
export const TENANT = 'Rollout 1405'

/** "⌘ K" on Apple keyboards, "Ctrl K" elsewhere. */
const SHORTCUT = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform) ? '⌘ K' : 'Ctrl K'

function GlobalSearch({ apps }) {
  const navigate = useNavigate()
  const inputRef = useRef(null)
  const [q, setQ] = useState('')

  useEffect(() => {
    const onKey = (e) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault()
        inputRef.current?.focus()
      }
    }
    document.addEventListener('keydown', onKey)
    return () => document.removeEventListener('keydown', onKey)
  }, [])

  const onSubmit = (e) => {
    e.preventDefault()
    const term = q.trim()
    if (!term) return
    const app = apps.find((a) => a.name.toLowerCase().includes(term.toLowerCase()))
    navigate(app ? appRoute(app) : `/work-items?search=${encodeURIComponent(term)}`)
    setQ('')
    inputRef.current?.blur()
  }

  return (
    <form className="uep-search" role="search" onSubmit={onSubmit}>
      <Icon name="search" size={16} />
      <input
        ref={inputRef}
        type="search"
        value={q}
        onChange={(e) => setQ(e.target.value)}
        placeholder="Search sites, villages, people and apps"
        aria-label="Search sites, villages, people and apps"
      />
      <kbd aria-hidden="true">{SHORTCUT}</kbd>
    </form>
  )
}

/**
 * The slim header on every signed-in page: launcher, logo, breadcrumb,
 * tenant switcher, global search, notifications and the account menu.
 */
export default function AppHeader({ user, apps, crumbs, pending, onSignOut }) {
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
              {c.to ? <Link to={c.to}>{c.label}</Link> : <span aria-current="page">{c.label}</span>}
            </span>
          ))}
        </nav>
      )}
      <button type="button" className="uep-tenant" aria-label={`Project: ${TENANT}`}>
        {TENANT}
        <Icon name="chevron--down" size={16} />
      </button>
      <GlobalSearch apps={apps} />
      <Link to="/home" className="uep-icon-btn uep-notify" aria-label={`Notifications${pending ? `, ${pending} pending` : ''}`}>
        <Icon name="notification" size={20} />
        {pending > 0 && <span className="uep-notify-badge" data-testid="notify-badge">{pending > 99 ? '99+' : pending}</span>}
      </Link>
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
        <AccountPopover user={user} tenant={TENANT} onClose={close} onSignOut={onSignOut} openerRef={accountRef} />
      )}
    </header>
  )
}
