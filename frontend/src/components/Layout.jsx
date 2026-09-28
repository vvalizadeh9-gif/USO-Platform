import { motion } from 'framer-motion'
import { ChevronsUpDown, KeyRound, LogOut, Menu, Settings } from 'lucide-react'
import { useCallback, useEffect, useRef, useState } from 'react'
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import BrandMark from './BrandMark'
import { DATA_CHANGED_EVENT } from '../lib/dataChanged'
import { NAV_SECTIONS, navItemVisible } from '../lib/nav'
import { roleLabel } from '../lib/roles'
import api from '../api/client'

/**
 * Which page a URL belongs to, for the transition animation.
 *
 * The first path segment, except under Reports, where the second segment is
 * what distinguishes one dashboard from the other. Anything a page keeps in
 * the URL below that — a selected village, a work item id — is that page's own
 * state and must not restart it.
 */
function pageKey(pathname) {
  const [, section, sub] = pathname.split('/')
  return section === 'reports' ? `reports/${sub}` : section
}

function NavItem({ item, count, children }) {
  return (
    <NavLink
      to={item.to}
      end={item.end}
      className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
    >
      {children}
      <span className="nav-label">{item.label}</span>
      {count > 0 && <span className="badge">{count}</span>}
    </NavLink>
  )
}

/**
 * The drive test lifecycle as a numbered rail: a circle per step, joined by a
 * line, in place of icons. Numbered from the steps this person can see, so a
 * contractor and a PM both read 1, 2, 3; with a single step there is nothing
 * to join, so no line.
 */
function StepRail({ steps, badges }) {
  return (
    <div className="nav-steps">
      {steps.length > 1 && <span className="nav-steps-line" aria-hidden="true" />}
      {steps.map((item, i) => (
        <NavItem key={item.to} item={item} count={item.key ? badges[item.key] : undefined}>
          <span className="step-num" aria-hidden="true">{i + 1}</span>
        </NavItem>
      ))}
    </div>
  )
}

// Each section tints its icons: Today in the accent, the three project
// sections in the supporting teal, Month-end in amber. Colour only -- which
// items a section holds is NAV_SECTIONS' business.
const SECTION_TONE = {
  Today: 'accent',
  'Drive Test': 'support',
  Acceptance: 'support',
  Performance: 'support',
  'Month-end': 'monthend',
}

/**
 * One labelled group of nav items.
 *
 * Renders nothing at all -- heading included -- when this user can see none of
 * them. A heading over an empty space is a claim that something is there, and
 * Admin and the category owners see several of these groups empty.
 */
function NavSection({ label, items, roleName, badges }) {
  const visible = items.filter((item) => navItemVisible(item, roleName))
  if (visible.length === 0) return null

  // Consecutive lifecycle steps are drawn together as one rail.
  const runs = []
  for (const item of visible) {
    const last = runs[runs.length - 1]
    if (item.step && last?.steps) last.steps.push(item)
    else runs.push(item.step ? { steps: [item] } : item)
  }

  const id = `nav-section-${label.toLowerCase().replace(/[^a-z]+/g, '-')}`
  return (
    <div className="nav-section" role="group" aria-labelledby={id} data-tone={SECTION_TONE[label]}>
      <div className="nav-section-label" id={id}>{label}</div>
      {runs.map((run) =>
        run.steps ? (
          <StepRail key={run.steps[0].to} steps={run.steps} badges={badges} />
        ) : (
          <NavItem key={run.to} item={run} count={run.key ? badges[run.key] : undefined}>
            <run.icon size={18} strokeWidth={1.75} aria-hidden="true" />
          </NavItem>
        ),
      )}
    </div>
  )
}

// The navigation itself. Lifted out of the sidebar's JSX so that hiding it
// wholesale is one conditional rather than a fragment wrapped around eighty
// lines at the wrong indentation.
function SidebarNav({ user, isAdmin, badges }) {
  const roleName = user?.role?.name

  return (
    <nav className="sidebar-nav" aria-label="Main">
      {NAV_SECTIONS.map((section) => (
        <NavSection
          key={section.label}
          label={section.label}
          items={section.items}
          roleName={roleName}
          badges={badges}
        />
      ))}

      {isAdmin && (
        <div
          className="nav-section"
          role="group"
          aria-labelledby="nav-section-administration"
          data-tone="tertiary"
        >
          <div className="nav-section-label" id="nav-section-administration">Administration</div>
          <NavLink
            to="/admin"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Settings size={18} strokeWidth={1.75} aria-hidden="true" />
            <span className="nav-label">Admin Console</span>
          </NavLink>
        </div>
      )}
    </nav>
  )
}

/**
 * The person signed in, and the two things they can do to their own session:
 * change the password and sign out. One button at the foot of the sidebar
 * rather than a section of its own, because neither is a place in the work --
 * they belong with the name, not among the screens.
 *
 * A menu that opens upwards: it closes on Escape, a click outside it, or a
 * change of page, and focus goes back to the button whenever the menu takes
 * it away (Escape, or choosing an item).
 */
function AccountMenu({ user, initials, logout }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const location = useLocation()
  const navigate = useNavigate()

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
    menuRef.current?.querySelector('[role="menuitem"]')?.focus()
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
      const items = [...menuRef.current.querySelectorAll('[role="menuitem"]')]
      const i = items.indexOf(document.activeElement)
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(i + step + items.length) % items.length]?.focus()
    }
  }

  return (
    <div className="account" ref={wrapRef}>
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
    </div>
  )
}


export default function Layout() {
  const { user, logout, isAdmin, mustChangePassword } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [actionCount, setActionCount] = useState(0)
  // hc: assignable HC Pool + HC Review + Re-routes (D2) -- these wait on a
  //     PM/Coordinator. The pool's own figure is every on-air site whose
  //     drive test is not Done, which is a programme quantity rather than a
  //     to-do list; the sidebar asks "how much is waiting on me", so it takes
  //     the slice that can actually be assigned right now.
  // dt: DT Assignment + DT Review (D3) -- In Progress waits on the contractor.
  // mydt: a contractor's own To do count (D4). My Health Check has no count
  // endpoint of its own today, so it carries no badge (see D4).
  const [badges, setBadges] = useState({ action: 0, hc: 0, dt: 0, mydt: 0 })
  const roleName = user?.role?.name

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  // The HC/DT/contractor counts are read straight from the same endpoints
  // their own tab badges use (see D2-D4), so a sidebar number can never
  // disagree with the tabs it summarises.
  const loadQueueBadges = useCallback(() => {
    if (roleName === 'PM' || roleName === 'Coordinator') {
      api
        .get('/hc/queues/counts')
        .then((r) => {
          const c = r.data
          setBadges((b) => ({
            ...b,
            hc: (c.pool_assignable ?? c.pool) + c.hc_review + c.reroutes,
            dt: c.dt_assignment + c.dt_review,
          }))
        })
        .catch(() => {})
    } else if (roleName === 'Contractor') {
      api
        .get('/drive-tests/my/counts')
        .then((r) => setBadges((b) => ({ ...b, mydt: r.data.todo })))
        .catch(() => {})
    }
  }, [roleName])

  // Load every badge once on mount, refresh on a light interval, and refresh
  // straight after any write -- NOT on every navigation. The counts move when
  // an action does (assign, review, approve), and every action is a write, so
  // DATA_CHANGED_EVENT is the moment they can have changed. Re-reading them on
  // each route change instead cost a server-side count on every click, which
  // was most of why pages took seconds to open.
  useEffect(() => {
    // An account that must change its password is refused by every endpoint
    // but three, this one included. Polling it would produce a 403 every
    // minute and, through the client's interceptor, a page reload each time.
    if (mustChangePassword) return undefined

    let active = true
    let pending = null
    const load = () => {
      api
        // Counters only: the badge reads nothing else, and the item feed
        // costs the server a walk over every work item in scope.
        .get('/action-center/summary', { params: { items: false } })
        .then((r) => {
          // The counters, and only the counters: the badge should say how many
          // pieces of work are waiting, and one queue holding thirty sites is
          // one thing to go and do, not thirty. Falling back to the item feed
          // when there are no counters would put a number on a screen that
          // now shows counters alone -- a badge reading 3 over a page saying
          // "you're all caught up".
          if (!active) return
          const counters = r.data.counters || []
          setActionCount(counters.reduce((n, c) => n + c.count, 0))
        })
        .catch(() => {})
      loadQueueBadges()
    }
    // A bulk action can write several times in a row; answer the burst once.
    const onDataChanged = () => {
      clearTimeout(pending)
      pending = setTimeout(load, 300)
    }
    load()
    const id = setInterval(load, 60000)
    window.addEventListener(DATA_CHANGED_EVENT, onDataChanged)
    return () => {
      active = false
      clearInterval(id)
      clearTimeout(pending)
      window.removeEventListener(DATA_CHANGED_EVENT, onDataChanged)
    }
  }, [mustChangePassword, loadQueueBadges])

  const initials = (user?.full_name || 'U')
    .split(' ')
    .map((s) => s[0])
    .slice(0, 2)
    .join('')
    .toUpperCase()

  return (
    <div className="app-shell">
      <aside className={`sidebar ${open ? 'open' : ''}`}>
        <div className="brand">
          <BrandMark />
          <div className="brand-text">
            <b>USO Platform</b>
            <small>Enterprise Operations</small>
          </div>
        </div>

        {/* Hidden while an administrator-issued password is outstanding: every
            one of these leads somewhere the server will refuse, so offering
            them is offering a way out of the one screen that works. */}
        {!mustChangePassword && (
          <SidebarNav user={user} isAdmin={isAdmin} badges={{ ...badges, action: actionCount }} />
        )}

        <div className="sidebar-footer">
          {/* While a new password is owed, the chip stays as it was: a link
              to the one screen that works, and a way out. A menu offering
              "Change password" there would only repeat the link. */}
          {mustChangePassword ? (
            <div className="user-chip">
              <div className="user-avatar">{initials}</div>
              <div className="who">
                <b>{user?.full_name}</b>
                <Link to="/change-password" style={{ fontSize: 12 }}>
                  Set a new password
                </Link>
              </div>
              <button className="logout-btn" onClick={logout} title="Sign out">
                <LogOut size={16} />
              </button>
            </div>
          ) : (
            <AccountMenu user={user} initials={initials} logout={logout} />
          )}
        </div>
      </aside>

      <main className="main">
        <button
          className="btn btn-ghost btn-sm"
          style={{ display: 'none' }}
          onClick={() => setOpen((o) => !o)}
        >
          <Menu size={18} />
        </button>
        {/* A quick fade/slide-in on the incoming page. We deliberately do NOT
            use mode="wait" (which held the new page back until the old one
            finished animating out, adding ~0.2s of dead time to every
            navigation) and keep the duration short so pages feel instant.

            Keyed on the page, not the URL. Keying on the full pathname
            remounts the whole page whenever any part of the URL changes —
            which silently threw away My Work's queue, filter and half-typed
            form every time it selected a village. */}
        <motion.div
          key={pageKey(location.pathname)}
          initial={{ opacity: 0, y: 6 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.12 }}
        >
          <Outlet />
        </motion.div>
      </main>
    </div>
  )
}
