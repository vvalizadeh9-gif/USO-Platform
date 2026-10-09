import { motion } from 'framer-motion'
import { LogOut, Menu, Settings } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom'
import { useAuth } from '../context/AuthContext'
import AccountMenu from './AccountMenu'
import { initialsOf } from '../lib/initials'
import BrandMark from './BrandMark'
import { DATA_CHANGED_EVENT } from '../lib/dataChanged'
import { NAV_SECTIONS, navItemVisible } from '../lib/nav'
import { hasActionCenter } from '../lib/roles'
import { PAGE_MODE, PageModeContext } from './pageMode'
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

// Nav icons are neutral; only Month-end keeps a tint, its amber. Cobalt is
// the selected item's alone (design-system-cobalt.md, "Cobalt means selected
// or action"). Colour only -- which items a section holds is NAV_SECTIONS'
// business.
const SECTION_TONE = {
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



export default function Layout() {
  const { user, logout, isAdmin, mustChangePassword } = useAuth()
  const location = useLocation()
  const [open, setOpen] = useState(false)
  // Whether the page on screen fills the main column or scrolls inside it
  // (see pageMode.js). The page sets it; the shell only applies it.
  const [pageMode, setPageMode] = useState(PAGE_MODE.scroll)
  const pageModeValue = useMemo(() => ({ setMode: setPageMode }), [])
  const [actionCount, setActionCount] = useState(0)
  // hc: assignable HC Pool + HC Review + Re-routes (D2) -- these wait on a
  //     PM/Coordinator. The pool's own figure is every on-air site whose
  //     drive test is not Done, which is a programme quantity rather than a
  //     to-do list; the sidebar asks "how much is waiting on me", so it takes
  //     the slice that can actually be assigned right now.
  // dt: DT Assignment + DT Review (D3) -- In Progress waits on the contractor.
  // mydt: a contractor's own To do count (D4). My Health Check has no count
  // endpoint of its own today, so it carries no badge (see D4).
  // mywork: My Work's first tab -- "Your move" for a contractor, "To check"
  //     for a coordinator or PM -- read from the list endpoint with limit=0,
  //     the same select its tabs are counted from.
  const [badges, setBadges] = useState({ action: 0, hc: 0, dt: 0, mydt: 0, mywork: 0 })
  const roleName = user?.role?.name

  useEffect(() => {
    setOpen(false)
  }, [location.pathname])

  // The HC/DT/contractor counts are read straight from the same endpoints
  // their own tab badges use (see D2-D4), so a sidebar number can never
  // disagree with the tabs it summarises.
  const loadQueueBadges = useCallback(() => {
    if (roleName && roleName !== 'Admin') {
      api
        .get('/acceptance/my-work', { params: { limit: 0 } })
        .then((r) => setBadges((b) => ({ ...b, mywork: r.data?.tabs?.[0]?.count ?? 0 })))
        .catch(() => {})
    }
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
      // The board's pending total: the same figure the Action Center's header
      // shows, and the same per-user read (the server shares it for a few
      // seconds), so the badge and the page cannot disagree. Roles without an
      // Action Center are not asked -- the server would answer 403.
      if (hasActionCenter(roleName)) {
        api
          .get('/action-center/board')
          .then((r) => {
            if (active) setActionCount(r.data?.totals?.pending ?? 0)
          })
          .catch(() => {})
      }
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
  }, [mustChangePassword, loadQueueBadges, roleName])

  const initials = initialsOf(user?.full_name)

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

      <main className={`main main-${pageMode}`}>
        <button
          className="btn btn-ghost btn-sm"
          style={{ display: 'none' }}
          onClick={() => setOpen((o) => !o)}
        >
          <Menu size={18} />
        </button>
        {/* The page's own box, and the only thing under the shell that can
            scroll: the browser page never does (the layout contract in
            ARCHITECTURE.md). A scrolling page scrolls here; a fill page
            (PageFrame) takes this box's height and scrolls inside its cards.

            A quick opacity fade on the incoming page. Opacity only: a
            transform here would give fixed-position drawers inside the page
            a new containing block for the length of the animation. No
            mode="wait", which held the new page back until the old one had
            finished animating out.

            Keyed on the page, not the URL. Keying on the full pathname
            remounts the whole page whenever any part of the URL changes --
            which silently threw away My Work's queue, filter and half-typed
            form every time it selected a village. */}
        <PageModeContext.Provider value={pageModeValue}>
          <motion.div
            key={pageKey(location.pathname)}
            className="page-outlet"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            transition={{ duration: 0.12 }}
          >
            <Outlet />
          </motion.div>
        </PageModeContext.Provider>
      </main>
    </div>
  )
}
