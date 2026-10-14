import { motion } from 'framer-motion'
import { useEffect, useMemo, useRef, useState } from 'react'
import { Outlet, useLocation } from 'react-router-dom'
import { PAGE_MODE, PageModeContext } from '../components/pageMode'
import { useAuth } from '../context/AuthContext'
import AppHeader from './AppHeader'
import AppRail from './AppRail'
import { appRoute, appState, appsFor, locate } from './appRegistry'
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

/** "/ {App}" inside an app, "/ Sites / {ID}" on a site, nothing on Home. */
// eslint-disable-next-line react-refresh/only-export-components -- tested on its own
export function crumbsFor(pathname, app) {
  const site = pathname.match(/^\/work-items\/([^/]+)/)
  if (site) return [{ label: 'Sites', to: '/work-items' }, { label: decodeURIComponent(site[1]) }]
  if (pathname === '/home' || !app) return []
  return [{ label: app.name, to: appRoute(app), state: appState(app) }]
}

const LAST_APP_KEY = 'uep.lastApp'

function readLastApp() {
  try {
    return sessionStorage.getItem(LAST_APP_KEY)
  } catch {
    return null
  }
}

/**
 * Every signed-in page: the header, the current app's rail (when it has more
 * than one page) and the page. There is no global sidebar: the launcher is
 * the way between apps. See docs/design/navigation.md.
 */
export default function AppShell() {
  const { user, logout, mustChangePassword } = useAuth()
  const location = useLocation()
  const { counts } = useHomeData()
  const [pageMode, setPageMode] = useState(PAGE_MODE.scroll)
  const pageModeValue = useMemo(() => ({ setMode: setPageMode }), [])

  // While an administrator-issued password is outstanding every app answers
  // 403, so none is offered.
  const apps = useMemo(
    () => (mustChangePassword ? [] : appsFor(user?.role?.name)),
    [mustChangePassword, user?.role?.name],
  )
  const isHome = location.pathname === '/home'
  // A page shared by two apps (a dashboard in its own app and in Insights)
  // stays in the app the user opened: the link's state says which, else the
  // app last shown (kept for the tab, so a reload keeps it too).
  const lastApp = useRef(readLastApp())
  const preferAppId = location.state?.app ?? lastApp.current
  const { app, page } = locate(apps, location.pathname, location.search, preferAppId)
  useEffect(() => {
    if (!app) return
    lastApp.current = app.id
    try {
      sessionStorage.setItem(LAST_APP_KEY, app.id)
    } catch {
      // Storage blocked: the app is still kept for this page's lifetime.
    }
  }, [app])

  return (
    <div className="uep-shell">
      <AppHeader
        user={user}
        apps={apps}
        crumbs={crumbsFor(location.pathname, app)}
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
