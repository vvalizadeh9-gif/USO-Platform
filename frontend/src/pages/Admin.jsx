import { AnimatePresence, motion } from 'framer-motion'
import { useEffect, useState } from 'react'
import { Navigate, useSearchParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { HeaderCount } from '../components/PageHeader'
import { PageHead } from '../components/ui'
import OverviewTab from './admin/OverviewTab'
import CpmImportTab from './admin/CpmImportTab'
import ImportHistoryTab from './admin/ImportHistoryTab'
import UsersTab from './admin/UsersTab'
import ValidateCpmTab from './admin/ValidateCpmTab'
import AuditLogTab from './admin/AuditLogTab'
import ProblemCategoriesTab from './admin/ProblemCategoriesTab'
import MojriTemplateTab from './admin/MojriTemplateTab'
import AccessTab from './admin/access/AccessTab'
import SystemHealthTab from './admin/health/SystemHealthTab'
import { FEATURE as F, meets } from '../lib/access'

// Each view is its own feature (UEP-25, Admin › Access), read from
// GET /me/access: the page shows the views this person has, and the server
// re-checks each endpoint. The app rail lists these views, so the page draws
// no tab bar of its own and its title is the rail label word for word
// (UEP-13 §3.6).
const TABS = [
  { key: 'overview', label: 'Overview', need: F.ADMIN_OVERVIEW },
  { key: 'import', label: 'CPM import', need: [F.CPM_IMPORT, 'edit'] },
  { key: 'history', label: 'Import history', need: F.CPM_IMPORT },
  { key: 'validate', label: 'CPM changes', need: [F.CPM_CHANGE_REQUESTS, 'edit'] },
  { key: 'users', label: 'Users & roles', need: F.USERS },
  { key: 'access', label: 'Access', need: F.ACCESS, fill: true },
  { key: 'categories', label: 'Problem categories', need: F.PROBLEM_CATEGORIES },
  // A download, and only a download: it reads villages we have already
  // approved and writes nothing. The import that brings the filled file back
  // is the Mojri upload feature at Edit.
  { key: 'mojri', label: 'Mojri template', need: F.MOJRI_UPLOAD },
  { key: 'health', label: 'System health', need: F.SYSTEM_HEALTH, fill: true },
  { key: 'audit', label: 'Audit log', need: F.AUDIT_LOG },
]

export default function Admin() {
  const { user } = useAuth()
  const visibleTabs = TABS.filter((t) => meets(user, t.need))

  // Deep-linked from Action Center: ?tab=validate&highlight=<change-request-id>
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') || visibleTabs[0]?.key)
  const highlightId = searchParams.get('highlight')
  // A link to another tab while already here (the rail, the header search).
  const linkedTab = searchParams.get('tab')
  useEffect(() => {
    if (linkedTab) setTab(linkedTab)
  }, [linkedTab])
  const [pendingCount, setPendingCount] = useState(0)
  const current = visibleTabs.find((t) => t.key === tab) ?? visibleTabs[0]

  function refreshPending() {
    api.get('/admin/cpm/change-requests/count')
      .then((r) => setPendingCount(r.data.pending || 0))
      .catch(() => {})
  }
  const canSeeChanges = meets(user, [F.CPM_CHANGE_REQUESTS, 'edit'])
  useEffect(() => {
    if (canSeeChanges) refreshPending()
  }, [tab, canSeeChanges])

  // The Action SLA tab became Admin > SLA policies (UEP-15).
  if (linkedTab === 'action-sla') return <Navigate to="/admin/sla" replace />
  // The Province Assignments tab became Admin > Province assignments (UEP-17).
  if (linkedTab === 'provinces') return <Navigate to="/admin/provinces" replace />

  const shows = (key) => tab === key && current?.key === key

  // Access and System health are one-screen pages (the page never scrolls;
  // their lists scroll inside their panels): each draws its own PageFrame.
  if (shows('access')) return <AccessTab />
  if (shows('health')) return <SystemHealthTab />

  return (
    <>
      <PageHead
        title={current?.label || 'Admin'}
        count={tab === 'validate' && pendingCount > 0 ? <HeaderCount waiting={pendingCount} /> : null}
      />

      <AnimatePresence mode="wait">
        <motion.div
          key={tab}
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -8 }}
          transition={{ duration: 0.2 }}
        >
          {shows('overview') && <OverviewTab onNavigateTab={setTab} />}
          {shows('import') && <CpmImportTab />}
          {shows('history') && <ImportHistoryTab />}
          {shows('validate') && <ValidateCpmTab onDecided={refreshPending} highlightId={highlightId} />}
          {shows('users') && <UsersTab />}
          {shows('categories') && <ProblemCategoriesTab />}
          {shows('mojri') && <MojriTemplateTab />}
          {shows('audit') && <AuditLogTab />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}
