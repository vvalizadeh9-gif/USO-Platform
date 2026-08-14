import { AnimatePresence, motion } from 'framer-motion'
import { Plus, UserPlus, Search, Check, X, Pencil, Trash2, MapPin } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { Loading, StatusPill } from '../../components/ui'
import { roleLabel } from '../../lib/roles'

const CONTRACTOR_ROLE_NAME = 'Contractor'

export default function UsersTab() {
  const toast = useToast()
  const { user: currentUser } = useAuth()
  const [users, setUsers] = useState(null)
  const [roles, setRoles] = useState([])
  const [provinces, setProvinces] = useState([])
  const [contractors, setContractors] = useState([])
  const [showCreate, setShowCreate] = useState(false)
  const [editingUser, setEditingUser] = useState(null)
  const [provincePopup, setProvincePopup] = useState(null)  // user whose provinces we're viewing
  const [deleteTarget, setDeleteTarget] = useState(null)

  function load() {
    api.get('/admin/users').then((r) => setUsers(r.data)).catch(() => setUsers([]))
  }
  useEffect(() => {
    load()
    api.get('/reference/roles').then((r) => setRoles(r.data)).catch(() => {})
    api.get('/reference/provinces').then((r) => setProvinces(r.data)).catch(() => {})
    api.get('/reference/contractors').then((r) => setContractors(r.data)).catch(() => {})
  }, [])

  async function confirmDelete() {
    try {
      await api.delete(`/admin/users/${deleteTarget.id}`)
      toast.success('User deleted', `${deleteTarget.full_name} removed.`)
      setDeleteTarget(null)
      load()
    } catch (err) {
      toast.error('Could not delete user', err.response?.data?.detail || 'Please try again.')
      setDeleteTarget(null)
    }
  }

  if (!users) return <Loading label="Loading users" />

  return (
    <div>
      <div className="row between mb-16">
        <span className="muted">{users.length} users</span>
        <button
          className="btn btn-primary btn-sm"
          onClick={() => { setEditingUser(null); setShowCreate((s) => !s) }}
        >
          <UserPlus size={15} /> New user
        </button>
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

      <div className="table-wrap mt-16">
        <table>
          <thead>
            <tr>
              <th>User</th>
              <th>Username</th>
              <th>Role</th>
              <th>Contractor</th>
              <th>Province access</th>
              <th>Status</th>
              <th style={{ width: 110 }}></th>
            </tr>
          </thead>
          <tbody>
            {users.map((u) => (
              <tr key={u.id}>
                <td style={{ fontWeight: 500 }}>{u.full_name}</td>
                <td className="dim tnum">{u.username}</td>
                <td>{roleLabel(u.role?.name)}</td>
                <td className="text-data dim">
                  {u.role?.name === CONTRACTOR_ROLE_NAME
                    ? (contractors.find((c) => c.id === u.contractor_id)?.name || '—')
                    : '—'}
                </td>
                <td>
                  <ProvinceCell user={u} onView={() => setProvincePopup(u)} />
                </td>
                <td><StatusPill status={u.active ? 'Approved' : 'Rejected'} /></td>
                <td>
                  <div className="row" style={{ gap: 4 }}>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => { setShowCreate(false); setEditingUser(u) }}
                    >
                      <Pencil size={14} /> Edit
                    </button>
                    {u.id !== currentUser?.id && (
                      <button
                        className="btn btn-sm btn-ghost"
                        style={{ color: 'var(--red)' }}
                        onClick={() => setDeleteTarget(u)}
                        title="Delete user"
                      >
                        <Trash2 size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <AnimatePresence>
        {provincePopup && (
          <ProvincePopup user={provincePopup} onClose={() => setProvincePopup(null)} />
        )}
        {deleteTarget && (
          <DeleteConfirm user={deleteTarget} onCancel={() => setDeleteTarget(null)} onConfirm={confirmDelete} />
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

function DeleteConfirm({ user, onCancel, onConfirm }) {
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(20,30,50,0.45)', display: 'grid', placeItems: 'center', zIndex: 200 }} onClick={onCancel}>
      <motion.div
        initial={{ opacity: 0, y: 14, scale: 0.97 }}
        animate={{ opacity: 1, y: 0, scale: 1 }}
        exit={{ opacity: 0, scale: 0.97 }}
        className="card card-pad"
        style={{ width: 400, borderColor: 'var(--red)', borderWidth: 1.5 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="row" style={{ gap: 8, color: 'var(--red)', marginBottom: 10 }}>
          <Trash2 size={18} />
          <h3 style={{ fontSize: 16, color: 'var(--red)' }}>Delete user?</h3>
        </div>
        <p className="muted" style={{ fontSize: 13, lineHeight: 1.6, marginBottom: 16 }}>
          Are you sure you want to permanently delete <b>{user.full_name}</b> ({user.username})?
          This cannot be undone.
        </p>
        <div className="row" style={{ gap: 8 }}>
          <button className="btn" style={{ background: 'var(--red)', color: '#fff', border: 'none' }} onClick={onConfirm}>
            <Trash2 size={14} /> Yes, delete
          </button>
          <button className="btn btn-ghost" onClick={onCancel}>No, cancel</button>
        </div>
      </motion.div>
    </div>
  )
}

// Shared create/edit form. Contractor dropdown only appears when the
// selected role is "Contractor" — other roles don't belong to a contractor.
function UserForm({ mode, user, roles, provinces, contractors, onDone, onError, onSuccess }) {
  const isEdit = mode === 'edit'
  const [form, setForm] = useState(() => ({
    username: user?.username || '',
    password: '',
    full_name: user?.full_name || '',
    role_id: user?.role?.id ? String(user.role.id) : '',
    contractor_id: user?.contractor_id ? String(user.contractor_id) : '',
    sees_all_provinces: user?.sees_all_provinces || false,
    province_ids: user?.provinces?.map((p) => p.id) || [],
    active: user?.active ?? true,
  }))
  const [busy, setBusy] = useState(false)

  function set(k, v) { setForm((f) => ({ ...f, [k]: v })) }

  const selectedRole = roles.find((r) => String(r.id) === form.role_id)
  const isContractorRole = selectedRole?.name === CONTRACTOR_ROLE_NAME

  async function submit() {
    setBusy(true)
    try {
      const payload = {
        full_name: form.full_name,
        role_id: Number(form.role_id),
        contractor_id: isContractorRole && form.contractor_id ? Number(form.contractor_id) : null,
        sees_all_provinces: form.sees_all_provinces,
        province_ids: form.sees_all_provinces ? [] : form.province_ids,
      }
      if (isEdit) {
        if (form.password) payload.password = form.password
        payload.active = form.active
        await api.patch(`/admin/users/${user.id}`, payload)
      } else {
        await api.post('/admin/users', { ...payload, username: form.username, password: form.password })
      }
      onSuccess()
      onDone()
    } catch (err) {
      onError(err.response?.data?.detail || 'Please check the fields and try again.')
    } finally {
      setBusy(false)
    }
  }

  return (
    <motion.div className="card card-pad" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
      <h3 style={{ fontSize: 15, marginBottom: 14 }}>{isEdit ? `Edit user · ${user.full_name}` : 'Create user'}</h3>
      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr' }}>
        <div className="field">
          <label>Full name</label>
          <input className="input" value={form.full_name} onChange={(e) => set('full_name', e.target.value)} />
        </div>
        <div className="field">
          <label>Username</label>
          <input className="input" value={form.username} disabled={isEdit} onChange={(e) => set('username', e.target.value)} />
        </div>
        <div className="field">
          <label>{isEdit ? 'New password (leave blank to keep current)' : 'Password'}</label>
          <input className="input" type="password" value={form.password} onChange={(e) => set('password', e.target.value)} placeholder="min 8 characters" />
        </div>
        <div className="field">
          <label>Role</label>
          <select className="input" value={form.role_id} onChange={(e) => set('role_id', e.target.value)}>
            <option value="">Select…</option>
            {roles.map((r) => <option key={r.id} value={r.id}>{roleLabel(r.name)}</option>)}
          </select>
        </div>
      </div>

      {isContractorRole && (
        <div className="field">
          <label>Contractor</label>
          <select className="input" value={form.contractor_id} onChange={(e) => set('contractor_id', e.target.value)}>
            <option value="">Select the contractor this user belongs to…</option>
            {contractors.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
          </select>
          <span className="dim" style={{ fontSize: 12, marginTop: 4, display: 'block' }}>
            This user will only see assignments belonging to this contractor.
          </span>
        </div>
      )}

      {isEdit && (
        <label className="row" style={{ gap: 8, margin: '4px 0 14px', cursor: 'pointer' }}>
          <input type="checkbox" checked={form.active} onChange={(e) => set('active', e.target.checked)} />
          <span>Account active (uncheck to disable login)</span>
        </label>
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
    </motion.div>
  )
}

// Searchable multi-select province picker. Clearer than a flat button list
// when there are many provinces: search box, select-all / clear, live count,
// and scrollable checkbox list.
function ProvincePicker({ provinces, selected, onChange }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return provinces
    return provinces.filter((p) => p.name.toLowerCase().includes(q))
  }, [provinces, query])

  function toggle(id) {
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id]
    )
  }
  const selectAllFiltered = () =>
    onChange([...new Set([...selected, ...filtered.map((p) => p.id)])])
  const clearAll = () => onChange([])

  if (provinces.length === 0) {
    return (
      <div className="field">
        <label>Grant province access</label>
        <span className="dim">Import a CPM file first to populate provinces.</span>
      </div>
    )
  }

  return (
    <div className="field">
      <div className="row between" style={{ marginBottom: 6 }}>
        <label style={{ margin: 0 }}>Grant province access</label>
        <span className="dim" style={{ fontSize: 12 }}>
          {selected.length} selected
        </span>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={15}
            style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }}
          />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Search provinces…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-sm" onClick={selectAllFiltered}>
          <Check size={14} /> All
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={clearAll}>
          <X size={14} /> Clear
        </button>
      </div>

      <div
        style={{
          maxHeight: 220,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: 6,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 2,
        }}
      >
        {filtered.map((p) => {
          const on = selected.includes(p.id)
          return (
            <label
              key={p.id}
              className="row"
              style={{
                gap: 9,
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                background: on ? 'var(--signal-glow)' : 'transparent',
                transition: 'background 0.13s',
              }}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
              <span className="text-data" style={{ color: on ? 'var(--signal-strong)' : 'var(--text)' }}>
                {p.name}
              </span>
            </label>
          )
        })}
        {filtered.length === 0 && (
          <span className="dim" style={{ padding: 10, fontSize: 13 }}>
            No provinces match “{query}”.
          </span>
        )}
      </div>
    </div>
  )
}
