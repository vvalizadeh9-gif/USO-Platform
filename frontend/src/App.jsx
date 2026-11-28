import { lazy, Suspense, useState } from 'react'
import { Navigate, Route, Routes, useLocation, useParams } from 'react-router-dom'
import AppShell from './shell/AppShell'
import { HomeDataProvider } from './shell/HomeData'
import { useAuth } from './context/AuthContext'
import { Loading } from './components/ui'
import { loginPathFor } from './lib/returnTo'
import { AREA, FEATURE as F, meets } from './lib/access'
import { HOME_ROLES, canOpenMonthlyPlan, homeFor } from './lib/roles'
import NoAccess from './components/NoAccess'
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
const ExplorerList = lazy(() => import('./pages/explorer/ExplorerList'))
const SiteRecord = lazy(() => import('./pages/explorer/SiteRecord'))
const Home = lazy(() => import('./pages/Home'))
const FilingPage = lazy(() => import('./pages/filing/FilingPage'))
const AcceptanceBaskets = lazy(() => import('./pages/reports/AcceptanceBaskets'))
const ValidationPage = lazy(() => import('./pages/validation/ValidationPage'))
const MonthlyPlan = lazy(() => import('./pages/monthlyplan/MonthlyPlan'))
const AcceptanceDashboard = lazy(() => import('./pages/reports/AcceptanceDashboard'))
const RolesPerformance = lazy(() => import('./pages/reports/rolesPerformance/RolesPerformance.jsx'))
const LifecycleGaps = lazy(() => import('./pages/reports/LifecycleGaps.jsx'))
const MojriImport = lazy(() => import('./pages/mojri/MojriImport'))
const Submissions = lazy(() => import('./pages/submissions/Submissions'))
const SubmissionBatch = lazy(() => import('./pages/submissions/BatchPage'))
const KpiMapping = lazy(() => import('./pages/reports/KpiMapping'))
const Admin = lazy(() => import('./pages/Admin'))
const SlaPoliciesPage = lazy(() => import('./pages/admin/SlaPoliciesPage'))
const ProvinceAssignmentsPage = lazy(() => import('./pages/admin/ProvinceAssignmentsPage'))
const SignInSettingsPage = lazy(() => import('./pages/admin/SignInSettingsPage'))
const ChangePassword = lazy(() => import('./pages/ChangePassword'))

// UEP-22: Filing is the acceptance cases inbox at /filing. My Work's old
// addresses land there, keeping the authority; a validation bookmark
// (tab=filled) still lands on ICT validation.
function MyWorkRedirect() {
  const { search } = useLocation()
  const params = new URLSearchParams(search)
  if (params.get('tab') === 'filled') return <Navigate to="/validation/ict" replace />
  const authority = (params.get('authority') || '').toUpperCase()
  return <Navigate to={authority === 'CRA' ? '/filing?authority=CRA' : '/filing'} replace />
}

const VALIDATION_AUTHORITIES = { ict: 'ICT', cra: 'CRA' }

/** /validation/ict or /validation/cra; anything else lands on ICT. Keyed by
 * authority, so switching pages starts the page over. */
function ValidationRoute() {
  const { authority } = useParams()
  const name = VALIDATION_AUTHORITIES[String(authority || '').toLowerCase()]
  if (!name || authority !== authority.toLowerCase()) return <Navigate to="/validation/ict" replace />
  return <ValidationPage key={name} authority={name} />
}

// The one screen an account on an administrator-issued password may use. The
// server refuses every other endpoint with a 403, so routing here is the
// interface agreeing with the server rather than deciding anything itself.
const CHANGE_PASSWORD_PATH = '/change-password'

// The Admin page's views, each its own feature (UEP-25). Anyone with one of
// them may open /admin; the page shows only the views they have.
const ADMIN_PAGE = {
  any: [F.ADMIN_OVERVIEW, F.USERS, F.ACCESS, F.CPM_IMPORT, [F.CPM_CHANGE_REQUESTS, 'edit'],
    F.PROBLEM_CATEGORIES, F.MOJRI_UPLOAD, F.SYSTEM_HEALTH, F.AUDIT_LOG, F.DATA_IMPORT],
}

// Someone without a route's feature sees the standard no-access screen rather
// than being bounced to "/": a silent redirect reads as a broken link. `need`
// names the feature (lib/access.js `meets`): 'explorer', ['hc_work', 'edit'],
// { any: [...] } or a function of the user. Read from GET /me/access, so a
// tick in Admin › Access opens or closes the page without a deploy.
function Protected({ children, need }) {
  const { user, loading, mustChangePassword } = useAuth()
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

  if (need && !meets(user, need)) return <NoAccess />
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

// Home is each role's own start page, not an area to refuse: the launcher
// offers it to everyone, and a role without UEP Home (Viewer, Admin) is taken
// to its own start page instead.
function HomeRoute() {
  const { user } = useAuth()
  const roleName = user?.role?.name
  if (!HOME_ROLES.includes(roleName)) return <Navigate to={homeFor(user)} replace />
  return <Home />
}

// After a successful sign-in the page shows its "Opening Home" curtain and
// navigates itself (at most 900 ms later); until then this route must not
// redirect on the user appearing, or the curtain would never be seen.
function LoginRoute() {
  const { user } = useAuth()
  const [arriving, setArriving] = useState(false)
  if (user && !arriving) return <Navigate to="/" replace />
  return <Login onArriving={setArriving} />
}

// Old sign-in links (UEP-26): help now lives in a panel inside the card, and
// the legal pages are gone until their texts exist.
const HELP_REDIRECTS = ['/forgot-password', '/request-access']
const SIGN_IN_REDIRECTS = ['/privacy', '/terms', '/help']

export default function App() {
  const { user } = useAuth()

  return (
    <Suspense fallback={<Loading />}>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        {HELP_REDIRECTS.map((path) => (
          <Route key={path} path={path} element={<Navigate to="/login?help=1" replace />} />
        ))}
        {SIGN_IN_REDIRECTS.map((path) => (
          <Route key={path} path={path} element={<Navigate to="/login" replace />} />
        ))}
        {/* Reachable by anyone signed in, including an account that can reach
            nothing else -- see Protected above and app/core/deps.py. In the
            sign-in frame, outside the app shell (UEP-26). */}
        <Route path={CHANGE_PASSWORD_PATH} element={<Protected><ChangePassword /></Protected>} />
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
              board's roles and Regional Managers (each on their own variant,
              see pages/Home.jsx); the rest land elsewhere. */}
          <Route path="/home" element={<HomeRoute />} />
          {/* Where each role lands: see homeFor in lib/roles.js. */}
          <Route path="/" element={<Navigate to={homeFor(user)} replace />} />
          <Route path="/reports/drive-test" element={<Protected need={AREA.INSIGHTS_DASHBOARDS}><DriveTestProject /></Protected>} />
          <Route path="/reports/acceptance" element={<Protected need={AREA.INSIGHTS_DASHBOARDS}><AcceptanceDashboard /></Protected>} />
          <Route path="/insights/acceptance-baskets" element={<Protected need={AREA.ACCEPTANCE_BASKETS}><AcceptanceBaskets /></Protected>} />
          {/* Roles Performance. Admin is refused every KPI endpoint, so the
              route is closed to it here as well -- otherwise the page loads
              and then fills with permission errors, which reads as a fault
              rather than as a rule. /reports/kpi (and any old bookmark to it)
              lands on the role's own first tab; /reports/kpi/mapping below is
              a static path and wins over :tab. */}
          <Route
            path="/reports/kpi"
            element={
              <Protected need={AREA.ROLES_PERFORMANCE}>
                <RolesPerformance />
              </Protected>
            }
          />
          <Route
            path="/reports/kpi/:tab"
            element={
              <Protected need={AREA.ROLES_PERFORMANCE}>
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
              <Protected need={AREA.LIFECYCLE_GAPS}>
                <LifecycleGaps />
              </Protected>
            }
          />
          {/* The name the page goes by in the design documents. */}
          <Route path="/reports/lifecycle-gaps" element={<Navigate to="/reports/gaps" replace />} />
          <Route
            path="/reports/kpi/mapping"
            element={
              <Protected need={F.KPI_MAPPING}>
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
          <Route path="/drive-test" element={<Protected need={{ any: [[F.DT_ASSIGNMENT, 'edit'], [F.DT_REVIEW, 'edit'], [F.HC_WORK, 'edit']] }}><DriveTest /></Protected>} />
          {/* The dashboard's drill-through: the sites behind any figure on it.
              A deeper path than /drive-test, which is exact and does not
              swallow it. */}
          <Route path="/drive-test/sites" element={<Protected need={AREA.INSIGHTS_DASHBOARDS}><DriveTestSiteList /></Protected>} />
          <Route path="/health-check" element={<Protected need={[F.HC_WORK, 'edit']}><HealthCheck /></Protected>} />
          <Route path="/my-health-check" element={<Protected need={F.CONTRACTOR_WORK}><MyHealthCheck /></Protected>} />
          <Route path="/my-drive-tests" element={<Protected need={F.CONTRACTOR_WORK}><MyDriveTests /></Protected>} />
          <Route
            path="/my-fix-queue"
            element={
              <Protected need={F.FIX_QUEUE}>
                <MyFixQueue />
              </Protected>
            }
          />
          <Route path="/explorer" element={<Protected need={AREA.EXPLORER}><ExplorerList /></Protected>} />
          <Route path="/explorer/sites/:workItemId" element={<Protected need={AREA.EXPLORER}><SiteRecord /></Protected>} />
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
          <Route path="/filing" element={<Protected need={AREA.ACCEPTANCE_CASES}><FilingPage /></Protected>} />
          <Route path="/my-work/*" element={<MyWorkRedirect />} />
          {/* ICT and CRA validation (UEP-16): the PM's and coordinators'. */}
          <Route
            path="/validation/:authority"
            element={
              <Protected need={F.VALIDATION}>
                <ValidationRoute />
              </Protected>
            }
          />
          <Route path="/validation" element={<Navigate to="/validation/ict" replace />} />
          {/* Admin is not offered the monthly plan queue (URL-only API access),
              so this shows them no access: setting a contractor's monthly
              target is an operational act and Admin is a systems role. */}
          <Route
            path="/monthly-plan"
            element={
              <Protected need={canOpenMonthlyPlan}>
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
              <Protected need={[F.MOJRI_UPLOAD, 'edit']}>
                <MojriImport />
              </Protected>
            }
          />
          {/* UEP-21: PM, Coordinator and Viewer; the server scopes and gates acting. */}
          <Route path="/submissions" element={<Protected need={AREA.SUBMISSIONS}><Submissions /></Protected>} />
          <Route path="/submissions/batches/:number" element={<Protected need={AREA.SUBMISSIONS}><SubmissionBatch /></Protected>} />
          <Route path="/acceptance" element={<Navigate to="/filing" replace />} />
          <Route path="/my-acceptance" element={<Navigate to="/filing" replace />} />
          <Route path="/admin" element={<Protected need={ADMIN_PAGE}><Admin /></Protected>} />
          <Route path="/admin/sla" element={<Protected need={F.SLA_POLICIES}><SlaPoliciesPage /></Protected>} />
          <Route path="/admin/provinces" element={<Protected need={F.PROVINCE_ASSIGNMENTS}><ProvinceAssignmentsPage /></Protected>} />
          <Route path="/admin/sign-in-page" element={<Protected need={F.SIGNIN_SETTINGS}><SignInSettingsPage /></Protected>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
