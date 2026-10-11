import { motion } from 'framer-motion'
import { useMemo, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { PAGE_MODE, PageModeContext } from '../components/pageMode'
import { useAuth } from '../context/AuthContext'
import AppHeader from './AppHeader'
import AppRail from './AppRail'
import { appRoute, appsFor, locate } from './appRegistry'
import { useHomeData } from './HomeData'
import '../styles/shell.css'

/**
 * Which page a URL belongs to, for the transition animation: the first path
 * segment (the second under Reports). Anything deeper is the page's own state
 * and must not remount it.
 */
function pageKey(pathname) {
  const [, section, sub] = pathname.split('/')
  return section === 'reports' ? `reports/${sub}` : section
}

// eslint-disable-next-line react-refresh/only-export-components -- tested on its own
/** "/ {App}" inside an app, "/ Sites / {ID}" on a site, nothing on Home. */
export function crumbsFor(pathname, app) {
  const site = pathname.match(/^\/work-items\/([^/]+)/)
  if (site) return [{ label: 'Sites', to: '/work-items' }, { label: decodeURIComponent(site[1]) }]
  if (pathname === '/home' || !app) return []
  return [{ label: app.name, to: appRoute(app) }]
}

/**
 * Every signed-in page: the header, the current app's rail (when it has more
 * than one page) and the page. There is no global sidebar: the launcher is
 * the way between apps. See docs/design/navigation.md.
 */
export default function AppShell() {
  const { user, logout, mustChangePassword } = useAuth()
  const location = useLocation()
  const { data, counts } = useHomeData()
  const [pageMode, setPageMode] = useState(PAGE_MODE.scroll)
  const pageModeValue = useMemo(() => ({ setMode: setPageMode }), [])

  // While an administrator-issued password is outstanding every app answers
  // 403, so none is offered.
  const apps = useMemo(
    () => (mustChangePassword ? [] : appsFor(user?.role?.name)),
    [mustChangePassword, user?.role?.name],
  )
  const isHome = location.pathname === '/home'
  const { app, page } = locate(apps, location.pathname, location.search)

  return (
    <div className="uep-shell">
      <AppHeader
        user={user}
        apps={apps}
        crumbs={crumbsFor(location.pathname, app)}
        pending={data?.totals?.pending ?? 0}
        onSignOut={logout}
      />
      <div className="uep-shell-body">
        {!isHome && <AppRail app={app} activePage={page} counts={counts} />}
        <main className={`main main-${pageMode} uep-shell-main ${isHome ? 'is-home' : ''}`.trim()}>
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
    </div>
  )
}
