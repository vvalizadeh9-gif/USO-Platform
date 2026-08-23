import { lazy, Suspense } from 'react'
import { Navigate, Route, Routes } from 'react-router-dom'
import Layout from './components/Layout'
import { useAuth } from './context/AuthContext'
import { Loading } from './components/ui'
import { CATEGORY_OWNER_ROLES, isCategoryOwner } from './lib/roles'
import Login from './pages/Login'

// Route pages are code-split so the initial load only ships the shell +
// current page. Each page's JS (and its heavy deps like charts) is fetched on
// demand, making first paint and navigation noticeably faster.
const DriveTestProject = lazy(() => import('./pages/DriveTestProject'))
const HealthCheck = lazy(() => import('./pages/HealthCheck'))
const MyHealthCheck = lazy(() => import('./pages/MyHealthCheck'))
const MyFixQueue = lazy(() => import('./pages/MyFixQueue'))
const WorkItems = lazy(() => import('./pages/WorkItems'))
const WorkItemDetail = lazy(() => import('./pages/WorkItemDetail'))
const ActionCenter = lazy(() => import('./pages/ActionCenter'))
const MyWork = lazy(() => import('./pages/mywork/MyWork'))
const AcceptanceDashboard = lazy(() => import('./pages/reports/AcceptanceDashboard'))
const Admin = lazy(() => import('./pages/Admin'))

function Protected({ children, adminOnly, allowedRoles }) {
  const { user, loading, isAdmin } = useAuth()
  if (loading) return <Loading />
  if (!user) return <Navigate to="/login" replace />
  if (adminOnly && !isAdmin) return <Navigate to="/" replace />
  if (allowedRoles && !allowedRoles.includes(user?.role?.name)) return <Navigate to="/" replace />
  return children
}

// Where "/" lands for each kind of user. A category owner only ever works one
// screen, so sending them to Work Items (which they cannot act on) would be a
// dead end.
function homeFor(user, isAdmin) {
  if (isAdmin) return '/admin'
  if (isCategoryOwner(user?.role?.name)) return '/my-fix-queue'
  return '/work-items'
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
          <Route path="/" element={<Navigate to={homeFor(user, isAdmin)} replace />} />
          <Route path="/reports/drive-test" element={<DriveTestProject />} />
          <Route path="/reports/acceptance" element={<AcceptanceDashboard />} />
          {/* Both dashboards moved under Reports when the Acceptance page was
              split into a read surface and a work surface. The old paths still
              answer, because they are in people's bookmarks. */}
          <Route path="/drive-test" element={<Navigate to="/reports/drive-test" replace />} />
          <Route path="/health-check" element={<HealthCheck />} />
          <Route path="/my-health-check" element={<MyHealthCheck />} />
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
          <Route path="/acceptance" element={<Navigate to="/my-work" replace />} />
          <Route path="/my-acceptance" element={<Navigate to="/my-work" replace />} />
          <Route path="/admin" element={<Protected allowedRoles={['Admin', 'PM']}><Admin /></Protected>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
