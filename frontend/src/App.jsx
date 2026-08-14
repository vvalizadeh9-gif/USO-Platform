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
const Acceptance = lazy(() => import('./pages/Acceptance'))
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
          <Route path="/drive-test" element={<DriveTestProject />} />
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
          <Route path="/acceptance" element={<Acceptance />} />
          <Route path="/admin" element={<Protected allowedRoles={['Admin', 'PM']}><Admin /></Protected>} />
        </Route>
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </Suspense>
  )
}
