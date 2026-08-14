import { AnimatePresence, motion } from 'framer-motion'
import { LayoutDashboard, UploadCloud, History, GitCompare, Users, ScrollText } from 'lucide-react'
import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { PageHead } from '../components/ui'
import OverviewTab from './admin/OverviewTab'
import CpmImportTab from './admin/CpmImportTab'
import ImportHistoryTab from './admin/ImportHistoryTab'
import UsersTab from './admin/UsersTab'
import ValidateCpmTab from './admin/ValidateCpmTab'
import AuditLogTab from './admin/AuditLogTab'

// Every tab besides Validate CPM hits Admin-only endpoints (see backend
// app/api/admin.py) — PM only ever sees Validate CPM, which the backend
// also allows for the PM role.
const TABS = [
  { key: 'overview', label: 'Overview', icon: LayoutDashboard, adminOnly: true },
  { key: 'import', label: 'CPM Import', icon: UploadCloud, adminOnly: true },
  { key: 'history', label: 'Import History', icon: History, adminOnly: true },
  { key: 'validate', label: 'Validate CPM', icon: GitCompare },
  { key: 'users', label: 'Users & Permissions', icon: Users, adminOnly: true },
  { key: 'audit', label: 'Audit Log', icon: ScrollText, adminOnly: true },
]

export default function Admin() {
  const { isAdmin } = useAuth()
  const visibleTabs = isAdmin ? TABS : TABS.filter((t) => !t.adminOnly)

  // Deep-linked from Action Center: ?tab=validate&highlight=<change-request-id>
  const [searchParams] = useSearchParams()
  const [tab, setTab] = useState(searchParams.get('tab') || (isAdmin ? 'overview' : 'validate'))
  const highlightId = searchParams.get('highlight')
  const [pendingCount, setPendingCount] = useState(0)

  function refreshPending() {
    api.get('/admin/cpm/change-requests/count')
      .then((r) => setPendingCount(r.data.pending || 0))
      .catch(() => {})
  }
  useEffect(() => {
    refreshPending()
  }, [tab])

  return (
    <>
      <PageHead
        eyebrow="Administration"
        title={isAdmin ? 'Admin Console' : 'CPM Validation'}
        subtitle={isAdmin ? 'Import master data, manage user access, and review CPM changes.' : 'Review pending CPM changes awaiting your decision.'}
      />

      <div className="tabs">
        {visibleTabs.map((t) => (
          <button key={t.key} className={`tab ${tab === t.key ? 'active' : ''}`} onClick={() => setTab(t.key)}>
            <span className="row" style={{ gap: 8 }}>
              <t.icon size={15} /> {t.label}
              {t.key === 'validate' && pendingCount > 0 && (
                <span
                  style={{
                    minWidth: 18,
                    height: 18,
                    padding: '0 5px',
                    borderRadius: 9,
                    background: 'var(--red)',
                    color: '#fff',
                    fontSize: 11,
                    fontWeight: 700,
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    lineHeight: 1,
                  }}
                >
                  {pendingCount > 99 ? '99+' : pendingCount}
                </span>
              )}
            </span>
          </button>
        ))}
      </div>

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
          {tab === 'audit' && isAdmin && <AuditLogTab />}
        </motion.div>
      </AnimatePresence>
    </>
  )
}
