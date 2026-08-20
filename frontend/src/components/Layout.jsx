import { motion } from 'framer-motion'
import {
  ListChecks,
  Radio,
  Activity,
  BadgeCheck,
  Settings,
  LogOut,
  Menu,
  ClipboardList,
  ClipboardCheck,
  Wrench,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import { NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { CATEGORY_OWNER_ROLES } from '../lib/roles'
import api from '../api/client'

// hideRoles hides an item for the given roles, on top of any `roles`
// inclusion list — used here to keep these four operational screens out of
// Admin's sidebar (Admin manages the platform from the Admin Console, not
// the day-to-day work queues) while everyone else keeps seeing them.
const NAV = [
  { to: '/work-items', label: 'Work Items', icon: ListChecks, end: true, hideRoles: ['Admin'] },
  { to: '/drive-test', label: 'Drive Test Project', icon: Activity, hideRoles: ['Admin'] },
  { to: '/health-check', label: 'Health Check', icon: ClipboardList, roles: ['Admin', 'PM', 'Coordinator'], hideRoles: ['Admin'] },
  { to: '/my-health-check', label: 'My Health Check', icon: ClipboardCheck, roles: ['Contractor'] },
  // Category owners get exactly one screen: the sites waiting on their team.
  { to: '/my-fix-queue', label: 'My Fix Queue', icon: Wrench, roles: CATEGORY_OWNER_ROLES },
  { to: '/action-center', label: 'Action Center', icon: Radio, key: 'action' },
  { to: '/acceptance', label: 'Acceptance', icon: BadgeCheck, hideRoles: ['Admin', 'Contractor'] },
  { to: '/my-acceptance', label: 'My Acceptance', icon: BadgeCheck, roles: ['Contractor'] },
]

export default function Layout() {
  const { user, logout, isAdmin } = useAuth()
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
  }, [])

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

        <div className="sidebar-footer">
          <div className="user-chip">
            <div className="user-avatar">{initials}</div>
            <div className="who">
              <b>{user?.full_name}</b>
              <small>{user?.role?.name}</small>
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
            navigation) and keep the duration short so pages feel instant. */}
        <motion.div
          key={location.pathname}
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
