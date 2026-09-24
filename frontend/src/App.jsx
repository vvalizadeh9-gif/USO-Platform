import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes, useLocation } from 'react-router-dom'
import Layout from './components/Layout'
import { useAuth } from './context/AuthContext'
import { Loading } from './components/ui'
import { CATEGORY_OWNER_ROLES, KPI_ROLES, MONTHLY_PLAN_ROLES } from './lib/roles'
import Login from './pages/Login'

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
const WorkItems = lazy(() => import('./pages/WorkItems'))
const WorkItemDetail = lazy(() => import('./pages/WorkItemDetail'))
const ActionCenter = lazy(() => import('./pages/ActionCenter'))
const MyWork = lazy(() => import('./pages/mywork/MyWork'))
const MonthlyPlan = lazy(() => import('./pages/monthlyplan/MonthlyPlan'))
const AcceptanceDashboard = lazy(() => import('./pages/reports/AcceptanceDashboard'))
const KpiPerformance = lazy(() => import('./pages/reports/KpiPerformance'))
const GapRoad = lazy(() => import('./pages/reports/GapRoad'))
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
  if (!user) return <Navigate to="/login" replace />

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

// Where "/" lands for each kind of user. Everyone who does the work lands on
// the Action Center: it is the one screen that answers "what needs me now"
// for every role, counted from live state, and it links on to whichever
// queue holds the work. Admin is the exception -- they manage the platform
// from the Admin Console and have no operational queue of their own.
function homeFor(isAdmin) {
  if (isAdmin) return '/admin'
  return '/action-center'
}

export default function App() {
  const { user, isAdmin } = useAuth()

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={user ? <Navigate to="/" replace /> : <Login />} />
        <Route
          element={
            <Protected>
              <Layout />
            </Protected>
          }
        >
          <Route path="/" element={<Navigate to={homeFor(isAdmin)} replace />} />
          <Route path="/reports/drive-test" element={<DriveTestProject />} />
          <Route path="/reports/acceptance" element={<AcceptanceDashboard />} />
          {/* Admin is refused every KPI endpoint, so the route is closed to it
              here as well -- otherwise the page loads and then fills with
              permission errors, which reads as a fault rather than as a rule.
              The four roles below are the ones the server serves. */}
          <Route
            path="/reports/kpi"
            element={
              <Protected allowedRoles={KPI_ROLES}>
                <KpiPerformance />
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
                <GapRoad />
              </Protected>
            }
          />
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
          <Route path="/work-items" element={<WorkItems />} />
          <Route path="/work-items/:id" element={<WorkItemDetail />} />
          <Route path="/action-center" element={<ActionCenter />} />
          <Route path="/notifications" element={<Navigate to="/action-center" replace />} />
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
