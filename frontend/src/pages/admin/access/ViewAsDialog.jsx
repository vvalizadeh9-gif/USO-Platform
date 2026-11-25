import { useEffect, useState } from 'react'
import api from '../../../api/client'
import { Modal } from '../../../components/ui'
import { detailMessage } from '../../../lib/apiError'
import { formatNumber } from '../../../lib/numbers'
import { homeFor, roleLabel } from '../../../lib/roles'
import { appGroupsFor } from '../../../shell/appRegistry'
import AppTile from '../../../shell/AppTile'
import { accessFromGrants } from './accessModel'
import { SkeletonRows } from './RoleView'

/**
 * "View as this user" (Admin only): a read-only preview of the launcher and
 * Home a person would see -- their GET /me/access and Home summary, read by
 * the server for them. No impersonation, no session, nothing can be done
 * from here. For a role, the preview is the role's (unsaved) grants.
 */
export default function ViewAsDialog({ target, onClose }) {
  const [state, setState] = useState(target.kind === 'role' ? {
    who: roleLabel(target.role.name),
    user: { role: { name: target.role.name }, access: accessFromGrants(target.role, target.grants) },
    home: null,
  } : null)
  const [error, setError] = useState(null)

  useEffect(() => {
    if (target.kind !== 'user') return
    api.get(`/admin/access/users/${target.id}/preview`)
      .then(({ data }) => setState({
        who: data.user.full_name,
        user: { role: { name: data.user.role }, access: data.access },
        home: data.home,
      }))
      .catch((err) => setError(detailMessage(err, 'Try again.')))
  }, [target])

  const groups = state ? appGroupsFor(state.user) : []
  const tickets = (state?.home?.groups || []).flatMap((g) => g.tickets).filter((t) => t.count > 0)

  return (
    <Modal open size="lg" title={state ? `What ${state.who} sees` : 'View as'} onClose={onClose}
      footer={<button type="button" className="btn" onClick={onClose}>Close</button>}
    >
      {error && <p className="ac-field-error" role="alert">The preview could not be loaded. {error}</p>}
      {!error && !state && <SkeletonRows count={6} />}
      {state && (
        <div className="ac-preview" aria-label="Read-only preview">
          <p className="ac-dialog-line">Starts on {homeFor(state.user)}</p>
          <div className="ac-preview-cols">
            <section>
              <h3 className="ac-group-title">Launcher</h3>
              {groups.length === 0 && <p className="ac-empty">No apps</p>}
              {groups.map((g) => (
                <div key={g.id} className="ac-preview-group">
                  <span className="ac-preview-caption">{g.label}</span>
                  <ul>
                    {g.apps.map((app) => (
                      <li key={app.id} className="ac-preview-app">
                        <AppTile app={app} size={24} />
                        <span>{app.name}</span>
                        <span className="ac-list-meta">{app.pages.map((p) => p.label).join(' · ')}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
            </section>
            <section>
              <h3 className="ac-group-title">Home</h3>
              {target.kind === 'role' && <p className="ac-empty">Choose a person in By user to see their Home</p>}
              {target.kind === 'user' && !state.home && <p className="ac-empty">This person has no Home page</p>}
              {state.home && tickets.length === 0 && <p className="ac-empty">Nothing waiting</p>}
              {state.home && tickets.length > 0 && (
                <ul className="ac-preview-tickets">
                  {tickets.map((t) => (
                    <li key={t.queue_key}><span>{t.label}</span><b className="tnum">{formatNumber(t.count)}</b></li>
                  ))}
                </ul>
              )}
            </section>
          </div>
        </div>
      )}
    </Modal>
  )
}
