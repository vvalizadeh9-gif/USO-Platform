import { motion } from 'framer-motion'
import { ChevronDown, ChevronRight, Filter, ShieldAlert, X } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading } from '../../components/ui'
import {
  ACCOUNT_ACTIONS,
  AUDIT_ENTITY_TYPES,
  AUDIT_MODULES,
  AUDIT_RESULTS,
  AUTH_ACTIONS,
  PORTAL_ACTIONS,
  actionLabel,
  actorLabel,
  describeAuditEntry,
  formatDateTime,
} from '../../lib/auditLog'

const PAGE_SIZE = 25
const EMPTY_FILTERS = {
  action: '', module: '', entity_type: '', user_id: '', result: '',
  search: '', date_from: '', date_to: '',
}

// The saved questions an administrator actually asks, as one click each. Every
// one of these is expressible through the filters below; having them as
// presets is the difference between the screen answering a question and the
// screen being a form somebody has to know how to fill in.
const PRESETS = [
  { label: 'Failed sign-ins', filters: { action: 'LOGIN_FAILED' } },
  { label: 'Sign-ins', filters: { action: 'LOGIN_SUCCESS' } },
  { label: 'Password activity', filters: { module: 'Auth', action: 'PASSWORD_RESET' } },
  { label: 'Account changes', filters: { module: 'Admin', entity_type: 'User' } },
  { label: 'Anything refused', filters: { result: 'Failure' } },
]

export default function AuditLogTab() {
  const [filters, setFilters] = useState(EMPTY_FILTERS)
  const [offset, setOffset] = useState(0)
  const [data, setData] = useState(null)
  const [users, setUsers] = useState([])
  const [expanded, setExpanded] = useState(() => new Set())

  useEffect(() => {
    api.get('/admin/users').then((r) => setUsers(r.data)).catch(() => {})
  }, [])

  useEffect(() => {
    setData(null)
    const params = { limit: PAGE_SIZE, offset }
    for (const [key, value] of Object.entries(filters)) {
      if (value) params[key] = value
    }
    api.get('/admin/audit-logs', { params })
      .then((r) => setData(r.data))
      .catch(() => setData({ total_count: 0, items: [] }))
  }, [filters, offset])

  function setFilter(key, value) {
    setOffset(0)
    setFilters((f) => ({ ...f, [key]: value }))
  }
  function applyPreset(preset) {
    setOffset(0)
    setFilters({ ...EMPTY_FILTERS, ...preset.filters })
  }
  function clearFilters() {
    setOffset(0)
    setFilters(EMPTY_FILTERS)
  }
  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const hasFilters = Object.values(filters).some(Boolean)
  const total = data?.total_count ?? 0
  const from = total === 0 ? 0 : offset + 1
  const to = Math.min(offset + PAGE_SIZE, total)

  return (
    <div>
      <div className="card card-pad mb-16">
        <div className="row between" style={{ marginBottom: 14 }}>
          <div className="row" style={{ gap: 8 }}>
            <Filter size={15} style={{ color: 'var(--text-muted)' }} />
            <h3 style={{ fontSize: 14.5 }}>Filters</h3>
          </div>
          <span className="dim" style={{ fontSize: 12 }}>
            Read-only. Entries cannot be edited or removed.
          </span>
        </div>

        <div className="row wrap" style={{ gap: 6, marginBottom: 14 }}>
          {PRESETS.map((p) => (
            <button key={p.label} className="btn btn-sm" onClick={() => applyPreset(p)}>
              {p.label}
            </button>
          ))}
        </div>

        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 190 }}>
            <label htmlFor="audit-action">Action</label>
            <select
              id="audit-action"
              className="input"
              value={filters.action}
              onChange={(e) => setFilter('action', e.target.value)}
            >
              <option value="">All actions</option>
              <optgroup label="Authentication">
                {AUTH_ACTIONS.map((a) => (
                  <option key={a} value={a}>{actionLabel(a)}</option>
                ))}
              </optgroup>
              <optgroup label="Accounts">
                {ACCOUNT_ACTIONS.map((a) => (
                  <option key={a} value={a}>{actionLabel(a)}</option>
                ))}
              </optgroup>
              <optgroup label="Portal activity">
                {PORTAL_ACTIONS.map((a) => (
                  <option key={a} value={a}>{actionLabel(a)}</option>
                ))}
              </optgroup>
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 150 }}>
            <label htmlFor="audit-module">Module</label>
            <select
              id="audit-module"
              className="input"
              value={filters.module}
              onChange={(e) => setFilter('module', e.target.value)}
            >
              <option value="">All modules</option>
              {AUDIT_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 170 }}>
            <label htmlFor="audit-entity">Entity type</label>
            <select
              id="audit-entity"
              className="input"
              value={filters.entity_type}
              onChange={(e) => setFilter('entity_type', e.target.value)}
            >
              <option value="">All entity types</option>
              {AUDIT_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 170 }}>
            <label htmlFor="audit-user">User</label>
            <select
              id="audit-user"
              className="input"
              value={filters.user_id}
              onChange={(e) => setFilter('user_id', e.target.value)}
            >
              <option value="">All users</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 130 }}>
            <label htmlFor="audit-result">Result</label>
            <select
              id="audit-result"
              className="input"
              value={filters.result}
              onChange={(e) => setFilter('result', e.target.value)}
            >
              <option value="">Any result</option>
              {AUDIT_RESULTS.map((r) => <option key={r} value={r}>{r}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 170 }}>
            <label htmlFor="audit-search">Reason contains</label>
            <input
              id="audit-search"
              className="input"
              value={filters.search}
              onChange={(e) => setFilter('search', e.target.value)}
              placeholder="e.g. compromised"
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="audit-from">From</label>
            <input
              id="audit-from"
              className="input"
              type="date"
              value={filters.date_from}
              onChange={(e) => setFilter('date_from', e.target.value)}
            />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label htmlFor="audit-to">To</label>
            <input
              id="audit-to"
              className="input"
              type="date"
              value={filters.date_to}
              onChange={(e) => setFilter('date_to', e.target.value)}
            />
          </div>
          {hasFilters && (
            <button className="btn btn-sm btn-ghost" onClick={clearFilters}>
              <X size={13} /> Clear
            </button>
          )}
        </div>
      </div>

      {data === null ? (
        <Loading label="Loading audit log" />
      ) : data.items.length === 0 ? (
        <div className="card">
          <EmptyState title="No matching entries" hint="Try widening the date range or clearing filters." />
        </div>
      ) : (
        <>
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th style={{ width: 28 }}></th>
                  <th>Timestamp</th>
                  <th>User</th>
                  <th>Action</th>
                  <th>Module</th>
                  <th>Record</th>
                  <th>What happened</th>
                  <th>Result</th>
                  <th>IP address</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e, i) => {
                  const isOpen = expanded.has(e.id)
                  const hasDetail = e.old_value || e.new_value || e.reason
                  const failed = e.result === 'Failure'
                  return (
                    <Fragment key={e.id}>
                      <motion.tr
                        initial={{ opacity: 0 }}
                        animate={{ opacity: 1 }}
                        transition={{ delay: Math.min(i * 0.015, 0.2) }}
                        onClick={() => hasDetail && toggle(e.id)}
                        style={{ cursor: hasDetail ? 'pointer' : 'default' }}
                      >
                        <td style={{ color: 'var(--text-dim)' }}>
                          {hasDetail ? (isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />) : null}
                        </td>
                        <td className="dim tnum" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>
                          {formatDateTime(e.created_at)}
                        </td>
                        <td style={{ fontWeight: 500 }}>
                          {actorLabel(e)}
                          {e.username ? (
                            <span className="dim" style={{ fontSize: 12 }}> · {e.username}</span>
                          ) : e.user_id == null && (
                            // No account resolved, so what is shown above is
                            // what somebody typed, not who they are.
                            <span className="dim" style={{ fontSize: 12 }}> · attempted</span>
                          )}
                        </td>
                        <td>
                          <span className={`pill ${failed ? 'pill-red' : 'pill-dim'}`}>
                            {actionLabel(e.action)}
                          </span>
                        </td>
                        <td><span className="pill pill-dim">{e.module}</span></td>
                        <td className="text-data dim">
                          {e.entity_type}{e.entity_id != null ? ` #${e.entity_id}` : ''}
                        </td>
                        <td style={{ fontSize: 13 }}>{describeAuditEntry(e)}</td>
                        <td>
                          {failed ? (
                            <span className="pill pill-red">
                              <ShieldAlert size={12} style={{ marginRight: 4 }} />
                              Failure
                            </span>
                          ) : (
                            <span className="pill pill-green">Success</span>
                          )}
                        </td>
                        <td className="dim tnum" style={{ fontSize: 12.5 }}>{e.ip_address || '—'}</td>
                      </motion.tr>
                      {isOpen && hasDetail && (
                        <tr>
                          <td></td>
                          <td colSpan={8} style={{ background: 'var(--surface-2)', padding: '10px 14px' }}>
                            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                              <RawValue label="Previous value" value={e.old_value} />
                              <RawValue label="New value" value={e.new_value} />
                            </div>
                            {e.reason && (
                              <div className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>
                                Reason: {e.reason}
                              </div>
                            )}
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  )
                })}
              </tbody>
            </table>
          </div>

          <div className="row between mt-16">
            <span className="dim" style={{ fontSize: 12.5 }}>
              Showing {from}–{to} of {total}
            </span>
            <div className="row" style={{ gap: 8 }}>
              <button className="btn btn-sm" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))}>
                Prev
              </button>
              <button className="btn btn-sm" disabled={offset + PAGE_SIZE >= total} onClick={() => setOffset(offset + PAGE_SIZE)}>
                Next
              </button>
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function RawValue({ label, value }) {
  return (
    <div>
      <div className="dim" style={{ fontSize: 11, textTransform: 'uppercase', letterSpacing: 0.3, marginBottom: 4 }}>{label}</div>
      {value ? (
        <pre style={{ fontSize: 12, background: 'var(--surface-1)', border: '1px solid var(--border-soft)', borderRadius: 'var(--radius-sm)', padding: 8, overflowX: 'auto', margin: 0 }}>
          {JSON.stringify(value, null, 2)}
        </pre>
      ) : (
        <span className="dim" style={{ fontSize: 12.5 }}>—</span>
      )}
    </div>
  )
}
