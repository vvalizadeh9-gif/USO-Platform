import { motion } from 'framer-motion'
import {
  ListChecks,
  Radio,
  Activity,
  BadgeCheck,
  Settings,
  LogOut,
  Menu,
  KeyRound,
  ClipboardList,
  ClipboardCheck,
  Wrench,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { CATEGORY_OWNER_ROLES } from '../lib/roles'
import api from '../api/client'

// hideRoles hides an item for the given roles, on top of any `roles`
// inclusion list — used here to keep these four operational screens out of
// Admin's sidebar (Admin manages the platform from the Admin Console, not
// the day-to-day work queues) while everyone else keeps seeing them.
const NAV = [
  { to: '/work-items', label: 'Work Items', icon: ListChecks, end: true, hideRoles: ['Admin'] },
  { to: '/health-check', label: 'Health Check', icon: ClipboardList, roles: ['Admin', 'PM', 'Coordinator'], hideRoles: ['Admin'] },
  { to: '/my-health-check', label: 'My Health Check', icon: ClipboardCheck, roles: ['Contractor'] },
  // Category owners get exactly one screen: the sites waiting on their team.
  { to: '/my-fix-queue', label: 'My Fix Queue', icon: Wrench, roles: CATEGORY_OWNER_ROLES },
  { to: '/action-center', label: 'Action Center', icon: Radio, key: 'action' },
  { to: '/my-work', label: 'My Work', icon: BadgeCheck, hideRoles: ['Admin'] },
]

// Reporting is separated from the work itself, because they are read at
// different times by different people. Everything under here is read-only:
// nothing in Reports changes a record.
const REPORTS = [
  { to: '/reports/drive-test', label: 'DT Dashboard', icon: Activity },
  { to: '/reports/acceptance', label: 'Acceptance Dashboard', icon: BadgeCheck },
]

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

// The navigation itself. Lifted out of the sidebar's JSX so that hiding it
// wholesale is one conditional rather than a fragment wrapped around eighty
// lines at the wrong indentation.
function SidebarNav({ user, isAdmin, actionCount }) {
  return (
    <>
      <div className="nav-section-label">Operations</div>
      {NAV.filter((item) => {
        if (item.roles && !item.roles.includes(user?.role?.name)) return false
        if (item.hideRoles && item.hideRoles.includes(user?.role?.name)) return false
        return true
      }).map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          end={item.end}
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <item.icon size={17} strokeWidth={2} />
          <span>{item.label}</span>
          {item.key === 'action' && actionCount > 0 && (
            <span className="badge">{actionCount}</span>
          )}
        </NavLink>
      ))}

      <div className="nav-section-label">Reports</div>
      {REPORTS.map((item) => (
        <NavLink
          key={item.to}
          to={item.to}
          className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
        >
          <item.icon size={17} strokeWidth={2} />
          <span>{item.label}</span>
        </NavLink>
      ))}

      {isAdmin && (
        <>
          <div className="nav-section-label">Administration</div>
          <NavLink
            to="/admin"
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <Settings size={17} strokeWidth={2} />
            <span>Admin Console</span>
          </NavLink>
        </>
      )}

      <div className="nav-section-label">Your account</div>
      <NavLink
        to="/change-password"
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      >
        <KeyRound size={17} strokeWidth={2} />
        <span>Change password</span>
      </NavLink>
    </>
  )
}


export default function Layout() {
  const { user, logout, isAdmin, mustChangePassword } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const [actionCount, setActionCount] = useState(0)

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  // Load the pending-action count once on mount and refresh it on a light
  // interval — NOT on every navigation. Re-fetching on each route change
  // added a network round-trip to every click and made pages feel slow.
  useEffect(() => {
    // An account that must change its password is refused by every endpoint
    // but three, this one included. Polling it would produce a 403 every
    // minute and, through the client's interceptor, a page reload each time.
    if (mustChangePassword) return undefined

    let active = true
    const load = () =>
      api
        .get('/action-center')
        .then((r) => {
          if (active) setActionCount(r.data.length)
        })
        .catch(() => {})
    load()
    const id = setInterval(load, 60000)
    return () => {
      active = false
      clearInterval(id)
    }
  }, [mustChangePassword])

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
          <div className="brand-mark"><span>U</span></div>
          <div className="brand-text">
            <b>USO Platform</b>
            <small>Enterprise Operations</small>
          </div>
        </div>

        {/* Hidden while an administrator-issued password is outstanding: every
            one of these leads somewhere the server will refuse, so offering
            them is offering a way out of the one screen that works. */}
        {!mustChangePassword && (
          <SidebarNav user={user} isAdmin={isAdmin} actionCount={actionCount} />
        )}

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{initials}</div>
            <div className="who">
              <b>{user?.full_name}</b>
              {mustChangePassword ? (
                <Link to="/change-password" style={{ fontSize: 12 }}>
                  Set a new password
                </Link>
              ) : (
                <small>{user?.role?.name}</small>
              )}
            </div>
            <button className="logout-btn" onClick={logout} title="Sign out">
              <LogOut size={16} />
            </button>
          </div>
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
