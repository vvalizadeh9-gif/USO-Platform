import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../../api/client'
import Icon from '../../../components/Icon'
import { Modal } from '../../../components/ui'
import { useToast } from '../../../context/ToastContext'
import { detailMessage } from '../../../lib/apiError'
import { roleLabel } from '../../../lib/roles'
import { DATA_SCOPES, LEVEL_LABEL } from './accessModel'
import { FeatureGroups, SkeletonRows } from './RoleView'

function dataAreaText(area) {
  if (!area) return ''
  const type = DATA_SCOPES.find((s) => s.value === area.type)?.label || area.type
  if (area.type === 'contractor') return `${type}: ${area.contractor || 'not set'}`
  if (area.type === 'provinces' || area.type === 'cra_regions') {
    if (area.sees_all_provinces) return `${type}: all`
    return `${type}: ${area.provinces.length ? area.provinces.join(', ') : 'none set'}`
  }
  return type
}

/**
 * By user: search a person, see every feature at its effective level, with a
 * marker where a personal exception sets it. Changing a level creates an
 * exception and asks for a reason (an expiry is optional); "Remove exception"
 * returns the feature to the role's level.
 */
export default function UserView({ features, editable, onChanged, onViewAs }) {
  const toast = useToast()
  const [query, setQuery] = useState('')
  const [results, setResults] = useState(null)
  const [selectedId, setSelectedId] = useState(null)
  const [detail, setDetail] = useState(null)
  const [detailError, setDetailError] = useState(null)
  const [pending, setPending] = useState(null) // { feature, level }
  const [attempt, setAttempt] = useState(0)

  useEffect(() => {
    let live = true
    const timer = setTimeout(() => {
      api.get('/admin/access/users', { params: { q: query, limit: 30 } })
        .then((r) => { if (live) setResults(r.data) })
        .catch(() => { if (live) setResults([]) })
    }, 200)
    return () => { live = false; clearTimeout(timer) }
  }, [query])

  useEffect(() => {
    if (!selectedId) return
    setDetail(null)
    setDetailError(null)
    api.get(`/admin/access/users/${selectedId}`)
      .then((r) => setDetail(r.data))
      .catch((err) => setDetailError(detailMessage(err, 'Try again.')))
  }, [selectedId, attempt])

  const rows = useMemo(() => Object.fromEntries((detail?.features || []).map((f) => [f.key, f])), [detail])
  const exceptions = (detail?.features || []).filter((f) => f.exception)

  async function removeException(key) {
    try {
      const { data } = await api.delete(`/admin/access/users/${selectedId}/overrides/${key}`)
      setDetail(data)
      onChanged()
      toast.success('Exception removed', 'Back to the role’s level.')
    } catch (err) {
      toast.error('Could not remove the exception', detailMessage(err, 'Try again.'))
    }
  }

  return (
    <div className="ac-split">
      <aside className="ac-list card-fill" aria-label="People">
        <div className="ac-search">
          <Icon name="search--locate" size={16} />
          <input
            className="input"
            type="search"
            placeholder="Search people"
            aria-label="Search people"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        {results === null ? <SkeletonRows count={8} /> : (
          <ul className="ac-list-scroll">
            {results.length === 0 && <li className="ac-empty">No one matches “{query}”</li>}
            {results.map((p) => (
              <li key={p.id}>
                <button
                  type="button"
                  className="ac-list-item"
                  aria-current={p.id === selectedId ? 'true' : undefined}
                  onClick={() => setSelectedId(p.id)}
                >
                  <span className="ac-list-name">{p.full_name}</span>
                  <span className="ac-list-meta">{p.username} · {roleLabel(p.role)}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </aside>

      <section className="ac-detail card-fill" aria-label="Person's access">
        {!selectedId && <p className="ac-empty ac-empty-center">Choose a person</p>}
        {selectedId && detailError && (
          <div className="ac-error" role="alert">
            <span>Their access could not be loaded. {detailError}</span>
            <button type="button" className="btn" onClick={() => setAttempt((n) => n + 1)}>Try again</button>
          </div>
        )}
        {selectedId && !detail && !detailError && <SkeletonRows />}
        {detail && features && (
          <>
            <header className="ac-detail-head">
              <div className="ac-detail-title">
                <h2>{detail.user.full_name}</h2>
                <div className="ac-actions">
                  {onViewAs && (
                    <button type="button" className="btn" onClick={() => onViewAs({ kind: 'user', id: detail.user.id, name: detail.user.full_name })}>
                      <Icon name="view" size={16} /> View as this user
                    </button>
                  )}
                </div>
              </div>
              <dl className="ac-facts">
                <div><dt>Role</dt><dd>{roleLabel(detail.user.role)}</dd></div>
                <div>
                  <dt>Data area</dt>
                  <dd>
                    {dataAreaText(detail.data_area)}
                    {editable && <Link className="ac-link" to="/admin?tab=users">Edit in Users</Link>}
                  </dd>
                </div>
              </dl>
              <div className="ac-exceptions">
                {exceptions.length === 0 ? (
                  <span className="ac-empty">No exceptions for this user</span>
                ) : exceptions.map((f) => {
                  const feature = features.find((x) => x.key === f.key)
                  return (
                    <span key={f.key} className={`ac-chip ${f.exception.active ? '' : 'is-expired'}`.trim()} title={f.exception.reason}>
                      {feature?.label || f.key}: {LEVEL_LABEL[f.exception.level]}
                      {f.exception.expires_at && ` · until ${f.exception.expires_at.slice(0, 10)}`}
                      {editable && (
                        <button type="button" className="ac-chip-x" aria-label={`Remove exception on ${feature?.label}`} onClick={() => removeException(f.key)}>
                          <Icon name="close" size={16} />
                        </button>
                      )}
                    </span>
                  )
                })}
              </div>
            </header>
            <div className="ac-scroll">
              <FeatureGroups
                features={features}
                editable={editable}
                levelOf={(f) => rows[f.key]?.effective || 'none'}
                onChange={(f, level) => {
                  if (level !== (rows[f.key]?.effective || 'none')) setPending({ feature: f, level })
                }}
                marker={(f) => (rows[f.key]?.exception?.active
                  ? <span className="ac-exception-mark" title={`Personal exception: ${rows[f.key].exception.reason}`}>exception</span>
                  : null)}
              />
            </div>
          </>
        )}
      </section>

      {pending && detail && (
        <ExceptionDialog
          person={detail.user}
          feature={pending.feature}
          level={pending.level}
          roleLevel={rows[pending.feature.key]?.role_level || 'none'}
          onClose={() => setPending(null)}
          onSaved={(data) => {
            setDetail(data)
            setPending(null)
            onChanged()
            toast.success('Exception saved', 'It applies everywhere within a minute.')
          }}
        />
      )}
    </div>
  )
}

function ExceptionDialog({ person, feature, level, roleLevel, onClose, onSaved }) {
  const [reason, setReason] = useState('')
  const [expires, setExpires] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.put(`/admin/access/users/${person.id}/overrides/${feature.key}`, {
        level, reason: reason.trim(), expires_on: expires || null,
      })
      onSaved(data)
    } catch (err) {
      setError(detailMessage(err, 'Check the reason and the date, then try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      open
      size="sm"
      title={`${feature.label}: ${LEVEL_LABEL[level]} for ${person.full_name}`}
      onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !reason.trim()}>
            {busy ? 'Please wait…' : 'Save exception'}
          </button>
        </>
      )}
    >
      <p className="ac-dialog-line">Role level: {LEVEL_LABEL[roleLevel]}</p>
      <label className="ac-field ac-field-wide">
        <span>Reason</span>
        <input className="input" value={reason} maxLength={500} autoFocus onChange={(e) => setReason(e.target.value)} />
      </label>
      <label className="ac-field">
        <span>Expires (optional)</span>
        <input className="input" type="date" min={tomorrow} value={expires} onChange={(e) => setExpires(e.target.value)} />
      </label>
      {error && <p className="ac-field-error" role="alert">{error}</p>}
    </Modal>
  )
}
