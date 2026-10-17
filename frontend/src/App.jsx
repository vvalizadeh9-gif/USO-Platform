import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import AppShell from './shell/AppShell'
import { HomeDataProvider } from './shell/HomeData'
import { useAuth } from './context/AuthContext'
import { Loading } from './components/ui'
import { loginPathFor, returnPathFrom } from './lib/returnTo'
import { CATEGORY_OWNER_ROLES, HOME_ROLES, KPI_ROLES, MONTHLY_PLAN_ROLES, homeFor } from './lib/roles'
import Login from './pages/Login'
import AuthPlaceholder from './pages/auth/AuthPlaceholder'

// Route pages are code-split so the initial load only ships the shell +
// current page. Each page's JS (and its heavy deps like charts) is fetched on
// demand, making first paint and navigation noticeably faster.
const DriveTestProject = lazy(() => import('./pages/drivetest/DriveTestProject'))
const DriveTestSiteList = lazy(() => import('./pages/drivetest/SiteList'))
const DriveTest = lazy(() => import('./pages/DriveTest'))
const HealthCheck = lazy(() => import('./pages/HealthCheck'))
const MyHealthCheck = lazy(() => import('./pages/MyHealthCheck'))
const MyDriveTests = lazy(() => import('./pages/MyDriveTests'))
const MyFixQueue = lazy(() => import('./pages/MyFixQueue'))
const ExplorerList = lazy(() => import('./pages/explorer/ExplorerList'))
const SiteRecord = lazy(() => import('./pages/explorer/SiteRecord'))
const Home = lazy(() => import('./pages/Home'))
const MyWork = lazy(() => import('./pages/mywork/MyWork'))
const MonthlyPlan = lazy(() => import('./pages/monthlyplan/MonthlyPlan'))
const AcceptanceDashboard = lazy(() => import('./pages/reports/AcceptanceDashboard'))
const RolesPerformance = lazy(() => import('./pages/reports/rolesPerformance/RolesPerformance.jsx'))
const LifecycleGaps = lazy(() => import('./pages/reports/LifecycleGaps.jsx'))
const MojriImport = lazy(() => import('./pages/mojri/MojriImport'))
const KpiMapping = lazy(() => import('./pages/reports/KpiMapping'))
const Admin = lazy(() => import('./pages/Admin'))
const ChangePassword = lazy(() => import('./pages/ChangePassword'))

// The one screen an account on an administrator-issued password may use. The
// server refuses every other endpoint with a 403, so routing here is the
// interface agreeing with the server rather than deciding anything itself.
const CHANGE_PASSWORD_PATH = '/change-password'

function Protected({ children, adminOnly, allowedRoles }) {
  const { user, loading, isAdmin, mustChangePassword } = useAuth()
  const location = useLocation()

  if (loading) return <Loading />
  // The page travels with them, so signing in brings them back to it.
  if (!user) return <Navigate to={loginPathFor(location)} replace />

  // Decided by the path rather than by a prop, because most routes below are
  // not individually wrapped -- they sit inside the layout's guard. A prop
  // would only cover the handful that are, and every other screen would slip
  // through to a platform that answers 403 to everything it does.
  //
  // Checked before the role guards, so someone who owes a password change
  // lands on the screen that says so rather than on a "you do not have
  // permission" bounce that tells them nothing about what to do next.
  if (mustChangePassword && location.pathname !== CHANGE_PASSWORD_PATH) {
    return <Navigate to={CHANGE_PASSWORD_PATH} replace />
  }

  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  if (allowedRoles && !allowedRoles.includes(user?.role?.name)) return <Navigate to="/" replace />
  return children
}

// Signing in sets the user, which re-renders this route before the form's own
// redirect runs -- so the signed-in branch must honour ?next= itself, or
// everyone sent here from a page would land on Home instead of back on it.
// All sites became Explorer (UEP-11). Old links and bookmarks still land:
// the list keeps its query string, a site opens its record page.
function WorkItemsRedirect() {
  const { search } = useLocation()
  return <Navigate to={`/explorer${search}`} replace />
}

function WorkItemRedirect() {
  const { id } = useParams()
  return <Navigate to={`/explorer/sites/${encodeURIComponent(id)}`} replace />
}

function LoginRoute() {
  const { user } = useAuth()
  const location = useLocation()
  if (user) return <Navigate to={returnPathFrom(location.search) ?? '/'} replace />
  return <Login />
}

export default function App() {
  const { user } = useAuth()

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        {/* Linked from the sign-in page; designed later. Open to everyone. */}
        {['forgot-password', 'request-access', 'privacy', 'terms', 'help'].map((page) => (
          <Route key={page} path={`/${page}`} element={<AuthPlaceholder page={page} />} />
        ))}
        <Route
          element={
            <Protected>
              <HomeDataProvider>
                <AppShell />
              </HomeDataProvider>
            </Protected>
          }
        >
          {/* UEP Home: the landing page, inside the shell with no rail. The
              board's roles and Regional Managers; the rest land elsewhere. */}
          <Route
            path="/home"
            element={
              <Protected allowedRoles={HOME_ROLES}>
                <Home />
              </Protected>
            }
          />
          {/* Where each role lands: see homeFor in lib/roles.js. */}
          <Route path="/" element={<Navigate to={homeFor(user?.role?.name)} replace />} />
          <Route path="/reports/drive-test" element={<DriveTestProject />} />
          <Route path="/reports/acceptance" element={<AcceptanceDashboard />} />
          {/* Roles Performance. Admin is refused every KPI endpoint, so the
              route is closed to it here as well -- otherwise the page loads
              and then fills with permission errors, which reads as a fault
              rather than as a rule. /reports/kpi (and any old bookmark to it)
              lands on the role's own first tab; /reports/kpi/mapping below is
              a static path and wins over :tab. */}
          <Route
            path="/reports/kpi"
            element={
              <Protected allowedRoles={KPI_ROLES}>
                <RolesPerformance />
              </Protected>
            }
          />
          <Route
            path="/reports/kpi/:tab"
            element={
              <Protected allowedRoles={KPI_ROLES}>
                <RolesPerformance />
              </Protected>
            }
          />
          {/* Gap & Performance reads the same numbers under the same scope
              rule as KPI & Performance -- Admin is refused every endpoint
              behind it, and a non-PM is confined by the server to its own
              scope -- so it is closed to the same roles here. */}
          <Route
            path="/reports/gaps"
            element={
              <Protected allowedRoles={KPI_ROLES}>
                <LifecycleGaps />
              </Protected>
            }
          />
          {/* The name the page goes by in the design documents. */}
          <Route path="/reports/lifecycle-gaps" element={<Navigate to="/reports/gaps" replace />} />
          <Route
            path="/reports/kpi/mapping"
            element={
              <Protected allowedRoles={['PM']}>
                <KpiMapping />
              </Protected>
            }
          />
          {/* The Acceptance dashboard moved under Reports when that page was
              split into a read surface and a work surface; /acceptance below
              still answers, because it is in people's bookmarks.

              /drive-test is NOT a bookmark alias any more. It used to redirect
              to the dashboard; it is now the drive test work screen, which is
              what a person typing it is looking for. The dashboard keeps its
              own path under Reports and its sidebar item. */}
          <Route path="/drive-test" element={<DriveTest />} />
          {/* The dashboard's drill-through: the sites behind any figure on it.
              A deeper path than /drive-test, which is exact and does not
              swallow it. */}
          <Route path="/drive-test/sites" element={<DriveTestSiteList />} />
          <Route path="/health-check" element={<HealthCheck />} />
          <Route path="/my-health-check" element={<MyHealthCheck />} />
          <Route path="/my-drive-tests" element={<MyDriveTests />} />
          <Route
            path="/my-fix-queue"
            element={
              <Protected allowedRoles={CATEGORY_OWNER_ROLES}>
                <MyFixQueue />
              </Protected>
            }
          />
          <Route path="/explorer" element={<ExplorerList />} />
          <Route path="/explorer/sites/:workItemId" element={<SiteRecord />} />
          <Route path="/work-items" element={<WorkItemsRedirect />} />
          <Route path="/work-items/:id" element={<WorkItemRedirect />} />
          {/* The Action Center was removed (UEP-05): Home shows each user's
              pending work. Old bookmarks, with or without ?view=, land there. */}
          <Route path="/action-center" element={<Navigate to="/home" replace />} />
          <Route path="/notifications" element={<Navigate to="/home" replace />} />
          {/* The acceptance workspace. /my-work/v/:villageId makes one
              village linkable, so "look at this one" is a URL rather than a
              description of where to click.

              One splat route rather than two paths on purpose: two Route
              entries pointing at the same component are still two routes to
              React Router, so selecting a village unmounted the workspace and
              remounted it — silently resetting the chosen bucket and the
              search box on every click. */}
          <Route path="/my-work/*" element={<MyWork />} />
          {/* Admin is not in MONTHLY_PLAN_ROLES, so this bounces them home:
              setting a contractor's monthly target is an operational act and
              Admin is a systems role. See lib/roles and ARCHITECTURE.md. */}
          <Route
            path="/monthly-plan"
            element={
              <Protected allowedRoles={MONTHLY_PLAN_ROLES}>
                <MonthlyPlan />
              </Protected>
            }
          />
          {/* The Mojri reconciliation writes operational data, so it is PM's
              alone -- Admin is refused both import endpoints on the server and
              takes only the template, from the Admin Console. */}
          <Route
            path="/mojri-tracker"
            element={
              <Protected allowedRoles={['PM']}>
                <MojriImport />
              </Protected>
            }
          />
          <Route path="/acceptance" element={<Navigate to="/my-work" replace />} />
          <Route path="/my-acceptance" element={<Navigate to="/my-work" replace />} />
          <Route path="/admin" element={<Protected allowedRoles={['Admin', 'PM']}><Admin /></Protected>} />
          {/* Reachable by anyone, including an account that can reach nothing
              else — see Protected above and app/core/deps.py. */}
          <Route path={CHANGE_PASSWORD_PATH} element={<ChangePassword />} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
