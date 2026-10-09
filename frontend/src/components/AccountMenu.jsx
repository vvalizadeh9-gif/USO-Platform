import { ChevronsUpDown, KeyRound, LogOut, Mail } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { hasActionCenter, roleLabel } from '../lib/roles'

/**
 * The person signed in, and what they can change about their own account:
 * the password, the daily email digest (Action Center roles only -- nobody
 * else is sent one), and signing out. One button at the foot of the sidebar
 * rather than a section of its own, because neither is a place in the work --
 * they belong with the name, not among the screens.
 *
 * The menu closes on Escape, a click outside it, or a change of page, and focus goes back to the button whenever the menu takes
 * it away (Escape, or choosing an item).
 *
 * Two looks, one behaviour: `sidebar` is the chip at the foot of the sidebar
 * (the menu opens upwards); `avatar` is the round button in UEP Home's header
 * (the menu drops down from it).
 */
const MENU_ITEMS = '[role="menuitem"], [role="menuitemcheckbox"]'


export default function AccountMenu({ user, initials, logout, variant = 'sidebar' }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()
  const { refreshUser } = useAuth()
  const [digestSaving, setDigestSaving] = useState(false)
  const digestOn = user?.email_digest_enabled !== false

  // A checkbox item: it changes in place and leaves the menu open, so the new
  // state is visible where it was set.
  const toggleDigest = () => {
    setDigestSaving(true)
    api
      .put('/me/notifications', { email_digest: !digestOn })
      .then(() => refreshUser())
      .catch(() => {})
      .finally(() => setDigestSaving(false))
  }

  const close = useCallback((refocus) => {
    setOpen(false)
    if (refocus) buttonRef.current?.focus()
  }, [])

  // A new page is a choice made; the menu has done its job.
  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  useEffect(() => {
    if (!open) return undefined
    // Focus the first item, so the keyboard lands inside what just opened.
    menuRef.current?.querySelector(MENU_ITEMS)?.focus()
    const onPointer = (e) => {
      if (!wrapRef.current?.contains(e.target)) close(false)
    }
    document.addEventListener('mousedown', onPointer)
    document.addEventListener('touchstart', onPointer)
    return () => {
      document.removeEventListener('mousedown', onPointer)
      document.removeEventListener('touchstart', onPointer)
    }
  }, [open, close])

  const onMenuKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.preventDefault()
      close(true)
      return
    }
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const items = [...menuRef.current.querySelectorAll(MENU_ITEMS)]
      const i = items.indexOf(document.activeElement)
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(i + step + items.length) % items.length]?.focus()
    }
  }

  return (
    <div className={`account account--${variant}`} ref={wrapRef}>
      {open && (
        <div
          className="account-menu"
          role="menu"
          id="account-menu"
          aria-label="Account"
          ref={menuRef}
          onKeyDown={onMenuKeyDown}
        >
          <button
            type="button"
            role="menuitem"
            className="account-menu-item"
            onClick={() => {
              close(true)
              navigate('/change-password')
            }}
          >
            <KeyRound size={16} strokeWidth={1.75} />
            <span>Change password</span>
          </button>
          {hasActionCenter(user?.role?.name) && (
            <button
              type="button"
              role="menuitemcheckbox"
              aria-checked={digestOn}
              className="account-menu-item"
              disabled={digestSaving}
              onClick={toggleDigest}
            >
              <Mail size={16} strokeWidth={1.75} />
              <span>Daily email digest</span>
              <span className="account-menu-state">{digestOn ? 'On' : 'Off'}</span>
            </button>
          )}
          <div className="account-menu-divider" role="separator" />
          <button
            type="button"
            role="menuitem"
            className="account-menu-item danger"
            onClick={() => {
              close(true)
              logout()
            }}
          >
            <LogOut size={16} strokeWidth={1.75} />
            <span>Log out</span>
          </button>
        </div>
      )}
      {variant === 'avatar' ? (
        <button
          type="button"
          ref={buttonRef}
          className="account-avatar-button"
          aria-haspopup="menu"
          aria-expanded={open}
          aria-controls={open ? 'account-menu' : undefined}
          aria-label={`Account: ${user?.full_name || ''}`}
          title={user?.full_name}
          onClick={() => setOpen((o) => !o)}
          onKeyDown={(e) => {
            if (e.key === 'Escape' && open) close(true)
          }}
        >
          {initials}
        </button>
      ) : (
      <button
        type="button"
        ref={buttonRef}
        className="user-chip account-button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={open ? 'account-menu' : undefined}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && open) close(true)
        }}
      >
        <span className="user-avatar" aria-hidden="true">{initials}</span>
        <span className="who">
          {/* One line each, ellipsed when too long; the title carries the
              full text. */}
          <b title={user?.full_name}>{user?.full_name}</b>
          <small title={roleLabel(user?.role?.name)}>{roleLabel(user?.role?.name)}</small>
        </span>
        <ChevronsUpDown size={16} strokeWidth={1.75} className="account-chevron" aria-hidden="true" />
      </button>
      )}
    </div>
  )
}
