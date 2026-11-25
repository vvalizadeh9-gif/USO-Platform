import { AnimatePresence, motion } from 'framer-motion'
import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../../api/client'
import Icon from '../../../components/Icon'
import PageFrame from '../../../components/PageFrame'
import PageHeader from '../../../components/PageHeader'
import { useAuth } from '../../../context/AuthContext'
import { FEATURE, can } from '../../../lib/access'
import { detailMessage } from '../../../lib/apiError'
import HistoryPanel from './HistoryPanel'
import RoleView from './RoleView'
import UserView from './UserView'
import ViewAsDialog from './ViewAsDialog'
import useLeaveGuard, { LEAVE_MESSAGE } from './useLeaveGuard'
import '../../../styles/access.css'

const VIEWS = [
  { key: 'role', label: 'By role' },
  { key: 'user', label: 'By user' },
  { key: 'history', label: 'History' },
]

/**
 * Admin › Access (UEP-25). Roles are ready-made sets of features; a person
 * can have single-feature exceptions on top; the data area is set in Users
 * and never widened here. Admin edits; PM and Viewer read (controls disabled,
 * no Save). One screen: lists scroll inside their panels, never the page.
 */
export default function AccessTab() {
  const { user, refreshAccess } = useAuth()
  const editable = can(user, FEATURE.ACCESS, 'edit')
  const isAdminPreview = editable
  const rootRef = useRef(null)

  const [view, setView] = useState('role')
  const [features, setFeatures] = useState(null)
  const [roles, setRoles] = useState(null)
  const [error, setError] = useState(null)
  const [dirty, setDirty] = useState(false)
  const [viewAs, setViewAs] = useState(null)

  const load = useCallback(async () => {
    setError(null)
    try {
      const [f, r] = await Promise.all([api.get('/admin/access/features'), api.get('/admin/access/roles')])
      setFeatures(f.data)
      setRoles(r.data)
    } catch (err) {
      setError(detailMessage(err, 'Check your connection and try again.'))
    }
  }, [])
  useEffect(() => { load() }, [load])

  useLeaveGuard(dirty, rootRef)

  function switchView(next) {
    if (next === view) return
    // eslint-disable-next-line no-alert -- a plain "are you sure", as on leaving
    if (dirty && !window.confirm(LEAVE_MESSAGE)) return
    setDirty(false)
    setView(next)
  }

  // A change to one's own role or exceptions shows in one's own menus at once.
  const afterChange = useCallback(() => { refreshAccess?.() }, [refreshAccess])

  const header = (
    <PageHeader
      title={<><span className="ac-title-tile" aria-hidden="true"><Icon name="locked" size={20} /></span>Access</>}
      count={!editable ? <span className="ac-readonly">Read only</span> : null}
      actions={(
        <div className="ac-switch" role="tablist" aria-label="Access views">
          {VIEWS.map((v) => (
            <button
              key={v.key}
              type="button"
              role="tab"
              aria-selected={view === v.key}
              className="ac-switch-opt"
              onClick={() => switchView(v.key)}
            >
              {v.label}
            </button>
          ))}
        </div>
      )}
    />
  )

  return (
    <PageFrame bar={header} className="ac-page">
      <div ref={rootRef} className="ac-root">
        {error && (
          <div className="ac-error" role="alert">
            <span>Access could not be loaded. {error}</span>
            <button type="button" className="btn" onClick={load}>Try again</button>
          </div>
        )}
        {!error && (
          <AnimatePresence mode="wait">
            <motion.div
              key={view}
              className="ac-view"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              transition={{ duration: 0.16 }}
            >
              {view === 'role' && (
                <RoleView
                  features={features}
                  roles={roles}
                  editable={editable}
                  onDirty={setDirty}
                  onRolesChanged={(next) => { setRoles(next); afterChange() }}
                  onViewAs={isAdminPreview ? setViewAs : null}
                />
              )}
              {view === 'user' && (
                <UserView
                  features={features}
                  editable={editable}
                  onChanged={afterChange}
                  onViewAs={isAdminPreview ? setViewAs : null}
                />
              )}
              {view === 'history' && <HistoryPanel features={features} />}
            </motion.div>
          </AnimatePresence>
        )}
      </div>
      <AnimatePresence>
        {viewAs && <ViewAsDialog target={viewAs} onClose={() => setViewAs(null)} />}
      </AnimatePresence>
    </PageFrame>
  )
}
