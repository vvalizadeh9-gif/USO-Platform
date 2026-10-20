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

// Every view besides CPM changes hits Admin-only endpoints (see backend
// app/api/admin.py); PM sees only CPM changes, which the backend allows for
// the PM role. The app rail (Admin app, or Data for PM) lists these views,
// so the page draws no tab bar of its own and its title is the rail label
// word for word (UEP-13 §3.6).
const TABS = [
  { key: 'overview', label: 'Overview', adminOnly: true },
  { key: 'import', label: 'CPM import', adminOnly: true },
  { key: 'history', label: 'Import history', adminOnly: true },
  { key: 'validate', label: 'CPM changes' },
  { key: 'users', label: 'Users & roles', adminOnly: true },
  { key: 'categories', label: 'Problem categories', adminOnly: true },
  // A download, and only a download: it reads villages we have already
  // approved and writes nothing, which is the only reason it may be Admin's.
  // The import that brings the filled file back is PM's alone.
  { key: 'mojri', label: 'Mojri template', adminOnly: true },
  { key: 'audit', label: 'Audit log', adminOnly: true },
]

export default function Admin() {
  const { isAdmin } = useAuth()
  const visibleTabs = isAdmin ? TABS : TABS.filter((t) => !t.adminOnly)

  // Deep-linked from Action Center: ?tab=validate&highlight=<change-request-id>
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') || (isAdmin ? 'overview' : 'validate'))
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
  useEffect(() => {
    refreshPending()
  }, [tab])

  // The Action SLA tab became Admin > SLA policies (UEP-15).
  if (linkedTab === 'action-sla') return <Navigate to="/admin/sla" replace />
  // The Province Assignments tab became Admin > Province assignments (UEP-17).
  if (linkedTab === 'provinces') return <Navigate to="/admin/provinces" replace />

  return (
    <>
      <PageHead
        title={current.label}
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
          {tab === 'overview' && isAdmin && <OverviewTab onNavigateTab={setTab} />}
          {tab === 'import' && isAdmin && <CpmImportTab />}
          {tab === 'history' && isAdmin && <ImportHistoryTab />}
          {tab === 'validate' && <ValidateCpmTab onDecided={refreshPending} highlightId={highlightId} />}
          {tab === 'users' && isAdmin && <UsersTab />}
          {tab === 'categories' && isAdmin && <ProblemCategoriesTab />}
          {tab === 'mojri' && isAdmin && <MojriTemplateTab />}
          {tab === 'audit' && isAdmin && <AuditLogTab />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}
