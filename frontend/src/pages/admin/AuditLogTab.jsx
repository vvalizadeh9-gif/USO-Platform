import { motion } from 'framer-motion'
import { ChevronDown, ChevronRight, Filter, X } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading } from '../../components/ui'
import { AUDIT_ENTITY_TYPES, AUDIT_MODULES, describeAuditEntry, formatDateTime } from '../../lib/auditLog'

const PAGE_SIZE = 25
const EMPTY_FILTERS = { module: '', entity_type: '', user_id: '', date_from: '', date_to: '' }

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
    if (filters.module) params.module = filters.module
    if (filters.entity_type) params.entity_type = filters.entity_type
    if (filters.user_id) params.user_id = filters.user_id
    if (filters.date_from) params.date_from = filters.date_from
    if (filters.date_to) params.date_to = filters.date_to
    api.get('/admin/audit-logs', { params })
      .then((r) => setData(r.data))
      .catch(() => setData({ total_count: 0, items: [] }))
  }, [filters, offset])

  function setFilter(key, value) {
    setOffset(0)
    setFilters((f) => ({ ...f, [key]: value }))
  }
  function clearFilters() {
    setOffset(0)
    setFilters(EMPTY_FILTERS)
  }
  function toggle(id) {
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
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
        <div className="row" style={{ gap: 8, marginBottom: 14 }}>
          <Filter size={15} style={{ color: 'var(--text-muted)' }} />
          <h3 style={{ fontSize: 14.5 }}>Filters</h3>
        </div>
        <div className="row wrap" style={{ gap: 12, alignItems: 'flex-end' }}>
          <div className="field" style={{ marginBottom: 0, minWidth: 160 }}>
            <label>Module</label>
            <select className="input" value={filters.module} onChange={(e) => setFilter('module', e.target.value)}>
              <option value="">All modules</option>
              {AUDIT_MODULES.map((m) => <option key={m} value={m}>{m}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <label>Entity type</label>
            <select className="input" value={filters.entity_type} onChange={(e) => setFilter('entity_type', e.target.value)}>
              <option value="">All entity types</option>
              {AUDIT_ENTITY_TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0, minWidth: 180 }}>
            <label>User</label>
            <select className="input" value={filters.user_id} onChange={(e) => setFilter('user_id', e.target.value)}>
              <option value="">All users</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.full_name}</option>)}
            </select>
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>From</label>
            <input className="input" type="date" value={filters.date_from} onChange={(e) => setFilter('date_from', e.target.value)} />
          </div>
          <div className="field" style={{ marginBottom: 0 }}>
            <label>To</label>
            <input className="input" type="date" value={filters.date_to} onChange={(e) => setFilter('date_to', e.target.value)} />
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
                  <th>Module</th>
                  <th>Entity</th>
                  <th>Action / reason</th>
                  <th>IP address</th>
                </tr>
              </thead>
              <tbody>
                {data.items.map((e, i) => {
                  const isOpen = expanded.has(e.id)
                  const hasDetail = e.old_value || e.new_value
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
                        <td className="dim tnum" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{formatDateTime(e.created_at)}</td>
                        <td style={{ fontWeight: 500 }}>{e.user_full_name || 'System'}</td>
                        <td><span className="pill pill-dim">{e.module}</span></td>
                        <td className="text-data dim">{e.entity_type}{e.entity_id != null ? ` #${e.entity_id}` : ''}</td>
                        <td style={{ fontSize: 13 }}>{describeAuditEntry(e)}</td>
                        <td className="dim tnum" style={{ fontSize: 12.5 }}>{e.ip_address || '—'}</td>
                      </motion.tr>
                      {isOpen && hasDetail && (
                        <tr>
                          <td></td>
                          <td colSpan={6} style={{ background: 'var(--surface-2)', padding: '10px 14px' }}>
                            <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', gap: 12 }}>
                              <RawValue label="Old value" value={e.old_value} />
                              <RawValue label="New value" value={e.new_value} />
                            </div>
                            {e.reason && (
                              <div className="dim" style={{ fontSize: 12.5, marginTop: 8 }}>Reason: {e.reason}</div>
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
