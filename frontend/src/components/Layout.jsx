import { motion } from 'framer-motion'
import { KeyRound, LogOut, Menu, Settings } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import { DRIVE_TEST_PROJECT, NAV, REPORTS, navItemVisible } from '../lib/nav'
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

/**
 * One labelled group of nav items.
 *
 * Renders nothing at all — heading included — when this user can see none of
 * them. A heading over an empty space is a claim that something is there, and
 * Admin and the category owners see most of these groups empty.
 */
function NavSection({ label, items, roleName, badges }) {
  const visible = items.filter((item) => navItemVisible(item, roleName))
  if (visible.length === 0) return null

  return (
    <>
      <div className="nav-section-label">{label}</div>
      {visible.map((item) => {
        const count = item.key ? badges[item.key] : undefined
        return (
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
          >
            <item.icon size={17} strokeWidth={2} />
            <span>{item.label}</span>
            {count > 0 && <span className="badge">{count}</span>}
          </NavLink>
        )
      })}
    </>
  )
}

// The navigation itself. Lifted out of the sidebar's JSX so that hiding it
// wholesale is one conditional rather than a fragment wrapped around eighty
// lines at the wrong indentation.
function SidebarNav({ user, isAdmin, badges }) {
  const roleName = user?.role?.name

  return (
    <>
      <NavSection
        label="Operations"
        items={NAV}
        roleName={roleName}
        badges={badges}
      />
      <NavSection label="Drive Test Project" items={DRIVE_TEST_PROJECT} roleName={roleName} badges={badges} />
      <NavSection label="Reports" items={REPORTS} roleName={roleName} badges={badges} />

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

  // On route change: the queue counts move whenever an action does (assign,
  // review, approve), and the next screen someone opens should already show
  // it caught up.
  useEffect(() => {
    if (mustChangePassword) return
    loadQueueBadges()
  }, [location.pathname, mustChangePassword, loadQueueBadges])

  // Load the pending-action count once on mount and refresh it on a light
  // interval — NOT on every navigation. Re-fetching on each route change
  // added a network round-trip to every click and made pages feel slow. The
  // HC/DT/contractor counts ride this same interval rather than a timer of
  // their own.
  useEffect(() => {
    // An account that must change its password is refused by every endpoint
    // but three, this one included. Polling it would produce a 403 every
    // minute and, through the client's interceptor, a page reload each time.
    if (mustChangePassword) return undefined

    let active = true
    const load = () => {
      api
        .get('/action-center/summary')
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
    load()
    const id = setInterval(load, 60000)
    return () => {
      active = false
      clearInterval(id)
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
          <SidebarNav user={user} isAdmin={isAdmin} badges={{ ...badges, action: actionCount }} />
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
