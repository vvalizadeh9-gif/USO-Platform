import { AnimatePresence, motion } from 'framer-motion'
import {
  History, KeyRound, LifeBuoy, MapPin, Pencil, Plus, Search, ShieldOff, UserPlus, X,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { EmptyState, Loading } from '../../components/ui'
import { roleLabel } from '../../lib/roles'
import { detailMessage } from '../../lib/apiError'
import { ACTIVE, USER_STATUSES, statusPillClass } from '../../lib/userStatus'
import ProvincePicker from './ProvincePicker'
import ResetRequestsPanel from './ResetRequestsPanel'
import UserAuditDrawer from './UserAuditDrawer'
import UserStatusDialog from './UserStatusDialog'
import PasswordResetDialog from './PasswordResetDialog'

const CONTRACTOR_ROLE_NAME = 'Contractor'
const EMPTY_FILTERS = { search: '', status: '', role_id: '' }

export default function UsersTab() {
  const toast = useToast()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState(null)
  const [roles, setRoles] = useState([])
  const [provinces, setProvinces] = useState([])
  const [contractors, setContractors] = useState([])
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [provincePopup, setProvincePopup] = useState(null)
  const [statusTarget, setStatusTarget] = useState(null)
  const [resetTarget, setResetTarget] = useState(null)
  const [historyTarget, setHistoryTarget] = useState(null)
  const [requestsVersion, setRequestsVersion] = useState(0)

  function load() {
    const params = {}
    if (filters.search.trim()) params.search = filters.search.trim()
    if (filters.status) params.status = filters.status
    if (filters.role_id) params.role_id = filters.role_id
    api.get('/admin/users', { params })
      .then((r) => setUsers(r.data))
      .catch(() => setUsers([]))
  }

  // Debounced, because this fires on every keystroke in the search box and the
  // list is a database query. 250ms is below the threshold where typing starts
  // to feel like it is waiting for something.
  useEffect(() => {
    const id = setTimeout(load, 250)
    return () => clearTimeout(id)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters.search, filters.status, filters.role_id])

  useEffect(() => {
    api.get('/reference/roles').then((r) => setRoles(r.data)).catch(() => {})
    api.get('/reference/provinces').then((r) => setProvinces(r.data)).catch(() => {})
    api.get('/reference/contractors').then((r) => setContractors(r.data)).catch(() => {})
  }, [])

  function setFilter(key, value) {
    setFilters((f) => ({ ...f, [key]: value }))
  }

  async function applyStatus(user, status, reason) {
    try {
      await api.post(`/admin/users/${user.id}/status`, { status, reason: reason || null })
      toast.success(
        'Status changed',
        `${user.full_name} is now ${status.toLowerCase()}. Nothing was deleted — `
        + 'their history still shows their name.',
      )
      setStatusTarget(null)
      load()
    } catch (err) {
      toast.error('Could not change the status', detailMessage(err, 'Please try again.'))
    }
  }

  const hasFilters = Object.values(filters).some(Boolean)

  return (
    <div>
      <ResetRequestsPanel
        version={requestsVersion}
        // The request row already carries everything the reset dialog needs,
        // so it is handed over directly rather than looked up in the table
        // below — which is filtered, and would silently do nothing whenever
        // the person asking happens not to match the current search.
        onResetUser={setResetTarget}
        onChanged={() => setRequestsVersion((v) => v + 1)}
      />

      <div className="card card-pad mb-16">
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0, flex: 1, minWidth: 220 }}>
            <label htmlFor="user-search">Search</label>
            <div style={{ position: 'relative' }}>
              <Search
                size={15}
                style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }}
              />
              <input
                id="user-search"
                className="input"
                style={{ paddingLeft: 32 }}
                placeholder="Name, username or email…"
                value={filters.search}
                onChange={(e) => setFilter('search', e.target.value)}
              />
            </div>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 150 }}>
            <label htmlFor="user-status-filter">Status</label>
            <select
              id="user-status-filter"
              className="input"
              value={filters.status}
              onChange={(e) => setFilter('status', e.target.value)}
            >
              <option value="">All statuses</option>
              {USER_STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <label htmlFor="user-role-filter">Role</label>
            <select
              id="user-role-filter"
              className="input"
              value={filters.role_id}
              onChange={(e) => setFilter('role_id', e.target.value)}
            >
              <option value="">All roles</option>
              {roles.map((r) => (
                <option key={r.id} value={r.id}>{roleLabel(r.name)}</option>
              ))}
            </select>
          </div>
          {hasFilters && (
            <button className="btn btn-sm btn-ghost" onClick={() => setFilters(EMPTY_FILTERS)}>
              <X size={13} /> Clear
            </button>
          )}
          <button
            className="btn btn-primary btn-sm"
            onClick={() => { setEditingUser(null); setShowCreate((s) => !s) }}
          >
            <UserPlus size={15} /> New user
          </button>
        </div>
      </div>

      {showCreate && (
        <UserForm
          mode="create"
          roles={roles}
          provinces={provinces}
          contractors={contractors}
          onDone={() => { setShowCreate(false); load() }}
          onError={(m) => toast.error('Could not create user', m)}
          onSuccess={() => toast.success('User created')}
        />
      )}

      {editingUser && (
        <UserForm
          mode="edit"
          user={editingUser}
          roles={roles}
          provinces={provinces}
          contractors={contractors}
          onDone={() => { setEditingUser(null); load() }}
          onError={(m) => toast.error('Could not update user', m)}
          onSuccess={() => toast.success('User updated')}
        />
      )}

      {users === null ? (
        <Loading label="Loading users" />
      ) : users.length === 0 ? (
        <div className="card">
          <EmptyState
            title="No matching users"
            hint={hasFilters ? 'Try a different search, or clear the filters.' : 'Create the first user to get started.'}
          />
        </div>
      ) : (
        <>
          <div className="row between mb-16">
            <span className="muted">
              {users.length} user{users.length === 1 ? '' : 's'}
              {hasFilters ? ' matching' : ''}
            </span>
          </div>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Username</th>
                  <th>Email</th>
                  <th>Role</th>
                  <th>Contractor</th>
                  <th>Province access</th>
                  <th>Status</th>
                  <th style={{ width: 180 }}></th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr key={u.id}>
                    <td style={{ fontWeight: 500 }}>
                      {u.full_name}
                      {u.must_change_password && (
                        <span
                          className="pill pill-amber"
                          style={{ marginLeft: 8, fontSize: 11 }}
                          title="This account is on a temporary password and must set a new one before it can do anything else."
                        >
                          must reset
                        </span>
                      )}
                    </td>
                    <td className="dim tnum">{u.username}</td>
                    <td className="dim text-data">{u.email || '—'}</td>
                    <td>{roleLabel(u.role?.name)}</td>
                    <td className="text-data dim">
                      {u.role?.name === CONTRACTOR_ROLE_NAME
                        ? (contractors.find((c) => c.id === u.contractor_id)?.name || '—')
                        : '—'}
                    </td>
                    <td>
                      <ProvinceCell user={u} onView={() => setProvincePopup(u)} />
                    </td>
                    <td>
                      <span className={`pill ${statusPillClass(u.status)}`}>{u.status}</span>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => { setShowCreate(false); setEditingUser(u) }}
                          title="Edit this user's details"
                        >
                          <Pencil size={14} />
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setResetTarget(u)}
                          title="Reset this user's password"
                        >
                          <KeyRound size={14} />
                        </button>
                        <button
                          className="btn btn-sm btn-ghost"
                          onClick={() => setHistoryTarget(u)}
                          title="View this user's activity history"
                        >
                          <History size={14} />
                        </button>
                        {/* An admin cannot take their own account offline, and
                            the backend refuses it — so the button is not
                            offered rather than offered and then refused. */}
                        {u.id !== currentUser?.id && (
                          <button
                            className="btn btn-sm btn-ghost"
                            style={u.status === ACTIVE ? { color: 'var(--red)' } : undefined}
                            onClick={() => setStatusTarget(u)}
                            title="Change this user's account status"
                          >
                            <ShieldOff size={14} />
                          </button>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      <AnimatePresence>
        {provincePopup && (
          <ProvincePopup user={provincePopup} onClose={() => setProvincePopup(null)} />
        )}
        {statusTarget && (
          <UserStatusDialog
            user={statusTarget}
            onCancel={() => setStatusTarget(null)}
            onConfirm={(status, reason) => applyStatus(statusTarget, status, reason)}
          />
        )}
        {resetTarget && (
          <PasswordResetDialog
            user={resetTarget}
            onClose={() => { setResetTarget(null); load(); setRequestsVersion((v) => v + 1) }}
            onError={(m) => toast.error('Could not reset the password', m)}
          />
        )}
        {historyTarget && (
          <UserAuditDrawer user={historyTarget} onClose={() => setHistoryTarget(null)} />
        )}
      </AnimatePresence>
    </div>
  )
}

// Compact province cell: "All provinces", "–", or a clickable "N provinces" chip.
function ProvinceCell({ user, onView }) {
  if (user.sees_all_provinces) {
    return <span className="text-data dim">All provinces</span>
  }
  const count = user.provinces?.length || 0
  if (count === 0) return <span className="dim">—</span>
  return (
    <button
      className="btn btn-sm"
      style={{ padding: '3px 10px', fontSize: 12.5 }}
      onClick={onView}
    >
      <MapPin size={13} /> {count} province{count > 1 ? 's' : ''}
    </button>
  )
}

function ProvincePopup({ user, onClose }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,50,0.45)', display: 'grid', placeItems: 'center', zIndex: 200 }} onClick={onClose}>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="card card-pad"
        style={{ width: 440, maxHeight: '80vh', overflowY: 'auto' }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row between" style={{ marginBottom: 14 }}>
          <h3 style={{ fontSize: 15 }}>{user.full_name} · province access</h3>
          <button className="btn btn-sm btn-ghost" onClick={onClose}><X size={15} /></button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(150px, 1fr))', gap: 6 }}>
          {user.provinces.map((p) => (
            <span key={p.id} className="text-data" style={{ padding: '7px 11px', background: 'var(--surface-2)', borderRadius: 6, fontSize: 13 }}>
              {p.name}
            </span>
          ))}
        </div>
      </motion.div>
    </div>
  )
}

// Shared create/edit form. Contractor dropdown only appears when the
// selected role is "Contractor" — other roles don't belong to a contractor.
//
// There is no password field on the edit side. Setting a password is its own
// operation with its own dialog, so that "reset their credentials" and "fix
// the spelling of their surname" are never the same click — and are never the
// same entry in the audit log afterwards.
function UserForm({ mode, user, roles, provinces, contractors, onDone, onError, onSuccess }) {
  const isEdit = mode === 'edit'
  const [form, setForm] = useState(() => ({
    username: user?.username || '',
    password: '',
    first_name: user?.first_name || '',
    family_name: user?.family_name || '',
    email: user?.email || '',
    role_id: user?.role?.id ? String(user.role.id) : '',
    contractor_id: user?.contractor_id ? String(user.contractor_id) : '',
    sees_all_provinces: user?.sees_all_provinces || false,
    province_ids: user?.provinces?.map((p) => p.id) || [],
  }))
  const [busy, setBusy] = useState(false)

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  const selectedRole = roles.find((r) => String(r.id) === form.role_id)
  const isContractorRole = selectedRole?.name === CONTRACTOR_ROLE_NAME

  async function submit() {
    setBusy(true)
    try {
      const payload = {
        first_name: form.first_name.trim(),
        family_name: form.family_name.trim(),
        // An empty box means "no address", not "the empty string" — the column
        // is unique, and two accounts saved with "" would collide.
        email: form.email.trim() || null,
        role_id: Number(form.role_id),
        contractor_id: isContractorRole && form.contractor_id ? Number(form.contractor_id) : null,
        sees_all_provinces: form.sees_all_provinces,
        province_ids: form.sees_all_provinces ? [] : form.province_ids,
      }
      if (isEdit) {
        await api.patch(`/admin/users/${user.id}`, payload)
      } else {
        await api.post('/admin/users', {
          ...payload, username: form.username.trim(), password: form.password,
        })
      }
      onSuccess()
      onDone()
    } catch (err) {
      onError(detailMessage(err))
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div className="card card-pad mb-16" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
      <h3 style={{ fontSize: 15, marginBottom: 14 }}>
        {isEdit ? `Edit user · ${user.full_name}` : 'Create user'}
      </h3>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="field">
          <label htmlFor="user-first-name">First name</label>
          <input
            id="user-first-name"
            className="input"
            value={form.first_name}
            onChange={(e) => set('first_name', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="user-family-name">Family name</label>
          <input
            id="user-family-name"
            className="input"
            value={form.family_name}
            onChange={(e) => set('family_name', e.target.value)}
          />
        </div>
        <div className="field">
          <label htmlFor="user-username">Username</label>
          <input
            id="user-username"
            className="input"
            value={form.username}
            disabled={isEdit}
            onChange={(e) => set('username', e.target.value)}
          />
          {isEdit && (
            <span className="dim" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              A username cannot be changed — the audit log identifies this
              person by it.
            </span>
          )}
        </div>
        <div className="field">
          <label htmlFor="user-email">Email address</label>
          <input
            id="user-email"
            className="input"
            type="email"
            value={form.email}
            onChange={(e) => set('email', e.target.value)}
            placeholder="Optional"
          />
        </div>
        {!isEdit && (
          <div className="field">
            <label htmlFor="user-password">Password</label>
            <input
              id="user-password"
              className="input"
              type="password"
              value={form.password}
              onChange={(e) => set('password', e.target.value)}
              placeholder="At least 12 characters"
              autoComplete="new-password"
            />
            <span className="dim" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
              A long phrase you can pass on is better than a short one with
              symbols in it.
            </span>
          </div>
        )}
        <div className="field">
          <label htmlFor="user-role">Role</label>
          <select
            id="user-role"
            className="input"
            value={form.role_id}
            onChange={(e) => set('role_id', e.target.value)}
          >
            <option value="">Select…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.name)}</option>)}
          </select>
        </div>
      </div>

      {isContractorRole && (
        <div className="field">
          <label htmlFor="user-contractor">Contractor</label>
          <select
            id="user-contractor"
            className="input"
            value={form.contractor_id}
            onChange={(e) => set('contractor_id', e.target.value)}
          >
            <option value="">Select the contractor this user belongs to…</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="dim" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
            This user will only see assignments belonging to this contractor.
          </span>
        </div>
      )}

      <label className="row" style={{ gap: 8, margin: '4px 0 14px', cursor: 'pointer' }}>
        <input type="checkbox" checked={form.sees_all_provinces} onChange={(e) => set('sees_all_provinces', e.target.checked)} />
        <span>Can see all provinces (Administrator / Project Manager)</span>
      </label>

      {!form.sees_all_provinces && (
        <ProvincePicker
          provinces={provinces}
          selected={form.province_ids}
          onChange={(ids) => set('province_ids', ids)}
        />
      )}

      <div className="row mt-8" style={{ gap: 8 }}>
        <button className="btn btn-primary" disabled={busy} onClick={submit}>
          {busy ? <div className="spinner" /> : <><Plus size={15} /> {isEdit ? 'Save changes' : 'Create user'}</>}
        </button>
        <button className="btn btn-ghost" onClick={onDone}>Cancel</button>
      </div>

      {isEdit && (
        <div className="row" style={{ gap: 7, marginTop: 14, color: 'var(--text-muted)', fontSize: 12.5 }}>
          <LifeBuoy size={13} />
          <span>
            To set this person&apos;s password, use the key button in their row.
            To take the account offline, use the shield button — nothing here
            deletes a user.
          </span>
        </div>
      )}
    </motion.div>
  )
}
