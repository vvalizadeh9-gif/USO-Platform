import { useEffect, useMemo, useState } from 'react'
import api from '../../../api/client'
import Icon from '../../../components/Icon'
import { ConfirmDialog, Modal } from '../../../components/ui'
import Select from '../../../components/Select'
import { useToast } from '../../../context/ToastContext'
import { detailMessage } from '../../../lib/apiError'
import { roleLabel } from '../../../lib/roles'
import AppTile from '../../../shell/AppTile'
import LevelControl from './LevelControl'
import {
  DATA_SCOPES, LANDINGS, diffGrants, grantsPayload, groupFeatures, saveSummary,
} from './accessModel'
import { LEAVE_MESSAGE } from './useLeaveGuard'

/** Skeleton rows while the catalogue loads. */
export function SkeletonRows({ count = 8 }) {
  return (
    <div className="ac-skel" aria-busy="true" aria-label="Loading">
      {Array.from({ length: count }, (_, i) => <span key={i} className="ac-skel-row" />)}
    </div>
  )
}

/** Features grouped by app, each with its level control. */
export function FeatureGroups({ features, levelOf, onChange, editable, marker }) {
  const groups = useMemo(() => groupFeatures(features), [features])
  return groups.map((group) => (
    <section key={group.app} className="ac-group" aria-label={group.app}>
      <h3 className="ac-group-title">
        {group.tile && <AppTile app={group.tile} size={24} />}
        {group.app}
      </h3>
      <ul className="ac-features">
        {group.features.map((f) => (
          <li key={f.key} className="ac-feature">
            <span className="ac-feature-label" title={f.description}>
              {f.label}
              {marker?.(f)}
            </span>
            <LevelControl
              feature={f}
              value={levelOf(f)}
              disabled={!editable}
              onChange={(level) => onChange(f, level)}
            />
          </li>
        ))}
      </ul>
    </section>
  ))
}

const scopeLabel = (value) => DATA_SCOPES.find((s) => s.value === value)?.label || value

export default function RoleView({ features, roles, editable, onDirty, onRolesChanged, onViewAs }) {
  const toast = useToast()
  const [selectedId, setSelectedId] = useState(null)
  const [draft, setDraft] = useState({})
  const [settings, setSettings] = useState(null)
  const [confirming, setConfirming] = useState(false)
  const [duplicating, setDuplicating] = useState(false)
  const [deleting, setDeleting] = useState(false)
  const [busy, setBusy] = useState(false)

  const role = roles?.find((r) => r.id === selectedId) || roles?.[0] || null
  useEffect(() => {
    if (role && selectedId === null) setSelectedId(role.id)
  }, [role, selectedId])
  useEffect(() => {
    setDraft({})
    setSettings(role ? { description: role.description || '', landing: role.landing, data_scope_type: role.data_scope_type } : null)
  }, [role?.id]) // eslint-disable-line react-hooks/exhaustive-deps

  const after = useMemo(() => ({ ...(role?.grants || {}), ...draft }), [role, draft])
  const changes = useMemo(() => diffGrants(role?.grants || {}, after), [role, after])
  const settingsChanged = Boolean(role && settings) && (
    (settings.description || '') !== (role.description || '')
    || settings.landing !== role.landing
    || settings.data_scope_type !== role.data_scope_type
  )
  const dirty = changes.length > 0 || settingsChanged
  useEffect(() => { onDirty(dirty) }, [dirty, onDirty])

  function pick(id) {
    if (id === role?.id) return
    if (dirty && !window.confirm(LEAVE_MESSAGE)) return
    setSelectedId(id)
  }

  async function save() {
    setBusy(true)
    try {
      const body = { grants: grantsPayload(changes) }
      if (settingsChanged) Object.assign(body, settings)
      const { data } = await api.put(`/admin/access/roles/${role.id}`, body)
      onRolesChanged(roles.map((r) => (r.id === role.id ? data.role : r)))
      setDraft({})
      setConfirming(false)
      toast.success('Access saved', `${role.name} changes apply everywhere within a minute.`)
    } catch (err) {
      setConfirming(false)
      toast.error('Could not save', detailMessage(err, 'Check the levels and try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function remove() {
    setBusy(true)
    try {
      await api.delete(`/admin/access/roles/${role.id}`)
      onRolesChanged(roles.filter((r) => r.id !== role.id))
      setSelectedId(null)
      setDeleting(false)
      toast.success('Role deleted', role.name)
    } catch (err) {
      setDeleting(false)
      toast.error('Could not delete the role', detailMessage(err, 'Try again.'))
    } finally {
      setBusy(false)
    }
  }

  if (!roles || !features) {
    return (
      <div className="ac-split">
        <aside className="ac-list card-fill"><SkeletonRows count={10} /></aside>
        <section className="ac-detail card-fill"><SkeletonRows /></section>
      </div>
    )
  }

  const canDelete = editable && role && !role.is_system && role.user_count === 0

  return (
    <div className="ac-split">
      <aside className="ac-list card-fill" aria-label="Roles">
        <ul className="ac-list-scroll">
          {roles.map((r) => (
            <li key={r.id}>
              <button
                type="button"
                className="ac-list-item"
                aria-current={r.id === role?.id ? 'true' : undefined}
                onClick={() => pick(r.id)}
              >
                <span className="ac-list-name">
                  {roleLabel(r.name)}
                  {r.id === role?.id && dirty && <span className="ac-dirty-dot" aria-label="Unsaved changes" />}
                </span>
                <span className="ac-list-meta">
                  {r.user_count} user{r.user_count === 1 ? '' : 's'}{r.is_system ? '' : ' · custom'}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </aside>

      <section className="ac-detail card-fill" aria-label={role ? `${role.name} features` : 'Role'}>
        {role && settings && (
          <>
            <header className="ac-detail-head">
              <div className="ac-detail-title">
                <h2>{roleLabel(role.name)}{dirty && <span className="ac-dirty-dot" aria-label="Unsaved changes" />}</h2>
                <div className="ac-actions">
                  {onViewAs && (
                    <button type="button" className="btn" onClick={() => onViewAs({ kind: 'role', role, grants: after })}>
                      <Icon name="view" size={16} /> View as
                    </button>
                  )}
                  {editable && (
                    <button type="button" className="btn" onClick={() => setDuplicating(true)}>
                      <Icon name="copy" size={16} /> Duplicate role
                    </button>
                  )}
                  {canDelete && (
                    <button type="button" className="btn" onClick={() => setDeleting(true)}>
                      <Icon name="trash-can" size={16} /> Delete role
                    </button>
                  )}
                  {editable && (
                    <button
                      type="button"
                      className={`btn ${dirty ? 'btn-primary' : ''}`.trim()}
                      disabled={!dirty || busy}
                      onClick={() => setConfirming(true)}
                    >
                      Save
                    </button>
                  )}
                </div>
              </div>
              <div className="ac-settings">
                <label className="ac-field ac-field-wide">
                  <span>Description</span>
                  <input
                    className="input"
                    value={settings.description}
                    disabled={!editable}
                    maxLength={255}
                    onChange={(e) => setSettings({ ...settings, description: e.target.value })}
                  />
                </label>
                <label className="ac-field">
                  <span>Landing</span>
                  <Select
                    className="input"
                    value={settings.landing}
                    disabled={!editable}
                    onChange={(e) => setSettings({ ...settings, landing: e.target.value })}
                  >
                    {[...LANDINGS, ...(LANDINGS.some((l) => l.value === settings.landing) ? [] : [{ value: settings.landing, label: settings.landing }])]
                      .map((l) => <option key={l.value} value={l.value}>{l.label}</option>)}
                  </Select>
                </label>
                <label className="ac-field">
                  <span>Data area</span>
                  <Select
                    className="input"
                    value={settings.data_scope_type}
                    disabled={!editable || role.is_system}
                    onChange={(e) => setSettings({ ...settings, data_scope_type: e.target.value })}
                  >
                    {DATA_SCOPES.map((s) => <option key={s.value} value={s.value}>{s.label}</option>)}
                  </Select>
                </label>
              </div>
            </header>
            <div className="ac-scroll">
              <FeatureGroups
                features={features}
                editable={editable}
                levelOf={(f) => after[f.key] || 'none'}
                onChange={(f, level) => setDraft((d) => ({ ...d, [f.key]: level }))}
                marker={(f) => (f.key in draft && (draft[f.key] || 'none') !== (role.grants[f.key] || 'none')
                  ? <span className="ac-changed-dot" aria-label="Changed" />
                  : null)}
              />
            </div>
          </>
        )}
      </section>

      <ConfirmDialog
        open={confirming}
        title={`Save ${roleLabel(role?.name)}?`}
        message={role ? saveSummary(roleLabel(role.name), changes, features, role.user_count, settingsChanged) : ''}
        confirmLabel="Save"
        busy={busy}
        onConfirm={save}
        onCancel={() => setConfirming(false)}
      />
      <ConfirmDialog
        open={deleting}
        title={`Delete ${role?.name}?`}
        message="The role has no users. Its grants are removed and the change is recorded in History."
        confirmLabel="Delete role"
        danger
        busy={busy}
        onConfirm={remove}
        onCancel={() => setDeleting(false)}
      />
      {duplicating && role && (
        <DuplicateDialog
          source={role}
          onClose={() => setDuplicating(false)}
          onCreated={(created) => {
            onRolesChanged([...roles, created])
            setSelectedId(created.id)
            setDuplicating(false)
            toast.success('Role created', `${created.name}, copied from ${role.name}. Set its features and Save.`)
          }}
        />
      )}
      <span className="ac-sr" aria-live="polite">{role ? `${scopeLabel(role.data_scope_type)} data area` : ''}</span>
    </div>
  )
}

function DuplicateDialog({ source, onClose, onCreated }) {
  const [name, setName] = useState(`${source.name} copy`)
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function create() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.post('/admin/access/roles', { source_role_id: source.id, name: name.trim() })
      onCreated(data)
    } catch (err) {
      setError(detailMessage(err, 'Choose another name and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      size="sm"
      title={`Duplicate ${roleLabel(source.name)}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={create} disabled={busy || !name.trim()}>
            {busy ? 'Please wait…' : 'Create role'}
          </button>
        </>
      )}
    >
      <label className="ac-field ac-field-wide">
        <span>New role name</span>
        <input className="input" value={name} maxLength={50} autoFocus onChange={(e) => setName(e.target.value)} />
      </label>
      {error && <p className="ac-field-error" role="alert">{error}</p>}
    </Modal>
  )
}
