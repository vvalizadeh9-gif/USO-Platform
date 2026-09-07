import { Plus, Wrench } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading } from '../../components/ui'
import { useToast } from '../../context/ToastContext'
import { isCategoryOwner, roleLabel } from '../../lib/roles'

/**
 * The remediation routing table, as a screen.
 *
 * A category says: this kind of health-check failure belongs to that team, and
 * they have this many days. It is the one piece of workflow configuration that
 * changes with the business rather than with the code, and it was always meant
 * to be editable from here — the columns exist, permission checks ask
 * `Role.is_category_owner` rather than comparing names, and seeding only fills
 * in what is missing so an administrator's choices survive a restart. Only the
 * screen was missing, so the way to add a category was a code change.
 *
 * Two deliberate absences. There is no delete: removing a category would also
 * remove the record of every fix worked under it, so deactivating is the only
 * way out and it leaves the history readable. And renaming is offered plainly,
 * because the row keeps its id — open fixes and historical rounds go on
 * pointing at it.
 */
export default function ProblemCategoriesTab() {
  const toast = useToast()
  const [categories, setCategories] = useState(null)
  const [roles, setRoles] = useState([])
  const [editing, setEditing] = useState(null) // category id | 'new' | null
  const [busy, setBusy] = useState(false)

  function load() {
    api
      .get('/admin/problem-categories')
      .then((r) => setCategories(r.data))
      .catch(() => setCategories([]))
  }

  useEffect(() => {
    load()
    api
      .get('/reference/roles')
      .then((r) => setRoles(r.data.filter((role) => isCategoryOwner(role.name))))
      .catch(() => setRoles([]))
  }, [])

  async function save(id, body) {
    setBusy(true)
    try {
      if (id === 'new') {
        await api.post('/admin/problem-categories', body)
        toast.success('Category added', `${body.name} is now routable.`)
      } else {
        await api.patch(`/admin/problem-categories/${id}`, body)
        toast.success('Category updated')
      }
      setEditing(null)
      load()
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!categories) return <Loading label="Loading problem categories" />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div className="row between wrap" style={{ gap: 12, alignItems: 'flex-start' }}>
          <div>
            <h3 style={{ fontSize: 15 }}>Problem Categories</h3>
            <p className="dim" style={{ fontSize: 12.5, marginTop: 4, maxWidth: '62ch' }}>
              When a health check fails, a PM or Coordinator tags it with one or
              more of these. Each opens a fix against the owning team, with its
              own deadline. Adding one here makes that team&rsquo;s Fix Queue
              appear — no release needed.
            </p>
          </div>
          <button
            className="btn btn-primary btn-sm"
            onClick={() => setEditing('new')}
            disabled={editing === 'new'}
          >
            <Plus size={14} /> Add category
          </button>
        </div>
      </div>

      {editing === 'new' && (
        <div className="card-pad" style={{ paddingTop: 0 }}>
          <CategoryForm
            roles={roles}
            busy={busy}
            onCancel={() => setEditing(null)}
            onSave={(body) => save('new', body)}
          />
        </div>
      )}

      {categories.length === 0 ? (
        <div style={{ padding: 20 }}>
          <EmptyState
            title="No problem categories yet"
            hint="Add one and point it at the team that owns that kind of fix."
          />
        </div>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Category</th>
              <th>Owning team</th>
              <th>SLA</th>
              <th>Open fixes</th>
              <th>Used</th>
              <th style={{ width: 90 }}></th>
            </tr>
          </thead>
          <tbody>
            {categories.map((c) => (
              // Keyed on the Fragment, not the rows inside it: a category renders
              // two sibling rows when it is being edited, and React reconciles
              // the outermost element of each iteration.
              <Fragment key={c.id}>
                <tr style={{ opacity: c.active ? 1 : 0.55 }}>
                  <td style={{ fontWeight: 500 }}>
                    <span className="row" style={{ gap: 7 }}>
                      <Wrench size={14} style={{ color: 'var(--text-dim)' }} />
                      {c.name}
                      {!c.active && <span className="pill pill-dim">Inactive</span>}
                    </span>
                  </td>
                  <td className="text-data">
                    {c.owner_role_name ? (
                      roleLabel(c.owner_role_name)
                    ) : (
                      <span style={{ color: 'var(--red)' }}>
                        No owner — fixes land nowhere
                      </span>
                    )}
                  </td>
                  <td className="tnum">{c.sla_days} days</td>
                  <td className="tnum" style={{ color: c.open_fixes ? 'var(--amber)' : undefined }}>
                    {c.open_fixes}
                  </td>
                  <td className="tnum dim">{c.total_fixes}</td>
                  <td>
                    <button
                      className="btn btn-sm btn-ghost"
                      onClick={() => setEditing(editing === c.id ? null : c.id)}
                    >
                      {editing === c.id ? 'Close' : 'Edit'}
                    </button>
                  </td>
                </tr>
                {editing === c.id && (
                  <tr>
                    <td colSpan={6} style={{ background: 'var(--surface-2)', padding: '12px 14px' }}>
                      <CategoryForm
                        category={c}
                        roles={roles}
                        busy={busy}
                        onCancel={() => setEditing(null)}
                        onSave={(body) => save(c.id, body)}
                      />
                    </td>
                  </tr>
                )}
              </Fragment>
            ))}
          </tbody>
        </table>
      )}
    </div>
  )
}

function CategoryForm({ category, roles, busy, onSave, onCancel }) {
  const [name, setName] = useState(category?.name || '')
  const [ownerRoleId, setOwnerRoleId] = useState(
    category?.owner_role_id ? String(category.owner_role_id) : '',
  )
  const [slaDays, setSlaDays] = useState(String(category?.sla_days ?? 7))
  const [active, setActive] = useState(category?.active ?? true)

  const isNew = !category
  const valid = name.trim().length >= 2 && ownerRoleId && Number(slaDays) >= 1

  const submit = () =>
    onSave({
      name: name.trim(),
      owner_role_id: Number(ownerRoleId),
      sla_days: Number(slaDays),
      ...(isNew ? {} : { active }),
    })

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, maxWidth: 640 }}>
      <div className="row wrap" style={{ gap: 10, alignItems: 'flex-end' }}>
        <div className="field" style={{ flex: 2, minWidth: 200, margin: 0 }}>
          <label>Category name</label>
          <input
            className="input"
            value={name}
            autoFocus={isNew}
            placeholder="e.g. Huawei Cleanup"
            onChange={(e) => setName(e.target.value)}
          />
        </div>
        <div className="field" style={{ flex: 2, minWidth: 200, margin: 0 }}>
          <label>Owning team</label>
          <select
            className="input"
            value={ownerRoleId}
            onChange={(e) => setOwnerRoleId(e.target.value)}
          >
            <option value="">Select a team…</option>
            {roles.map((r) => (
              <option key={r.id} value={r.id}>{roleLabel(r.name)}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ width: 110, margin: 0 }}>
          <label>SLA (days)</label>
          <input
            className="input tnum"
            type="number"
            min={1}
            max={365}
            value={slaDays}
            onChange={(e) => setSlaDays(e.target.value)}
          />
        </div>
      </div>

      {!isNew && (
        <label className="row" style={{ gap: 8, fontSize: 13, cursor: 'pointer' }}>
          <input
            type="checkbox"
            checked={active}
            onChange={(e) => setActive(e.target.checked)}
          />
          <span>
            Active
            <span className="dim" style={{ marginLeft: 6, fontSize: 12 }}>
              — an inactive category disappears from the routing chips but keeps
              its history. It cannot be switched off while fixes are still open
              against it.
            </span>
          </span>
        </label>
      )}

      {!isNew && category.total_fixes > 0 && (
        <p className="dim" style={{ fontSize: 12, margin: 0, maxWidth: '64ch' }}>
          Renaming is safe: {category.total_fixes} recorded fix
          {category.total_fixes === 1 ? '' : 'es'} keep pointing at this
          category. Changing the owning team affects only fixes opened after the
          change — work already in flight stays with the team doing it.
        </p>
      )}

      <div className="row" style={{ gap: 8 }}>
        <button className="btn btn-primary btn-sm" disabled={!valid || busy} onClick={submit}>
          {busy ? <div className="spinner" /> : isNew ? 'Add category' : 'Save changes'}
        </button>
        <button className="btn btn-ghost btn-sm" onClick={onCancel}>Cancel</button>
      </div>
    </div>
  )
}
