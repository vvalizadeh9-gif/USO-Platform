import { motion } from 'framer-motion'
import {
  Users, Building2, Database, GitBranch, UploadCloud, GitCompare, Activity, ScrollText, ArrowRight,
} from 'lucide-react'
import { useEffect, useState } from 'react'
import api from '../../api/client'
import { Loading, fadeUp, stagger } from '../../components/ui'
import { actorLabel, describeAuditEntry, formatDateTime } from '../../lib/auditLog'

export default function OverviewTab({ onNavigateTab }) {
  const [stats, setStats] = useState(null)
  const [health, setHealth] = useState(null)
  const [recent, setRecent] = useState(null)

  useEffect(() => {
    api.get('/admin/stats').then((r) => setStats(r.data)).catch(() => setStats(false))
    api.get('/admin/system-health').then((r) => setHealth(r.data)).catch(() => setHealth(false))
    api.get('/admin/audit-logs', { params: { limit: 8 } })
      .then((r) => setRecent(r.data.items))
      .catch(() => setRecent([]))
  }, [])

  if (stats === null || health === null || recent === null) return <Loading label="Loading overview" />

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      <motion.div className="grid grid-kpi" variants={stagger} initial="hidden" animate="show">
        <KpiCard icon={Users} label="Active Users" value={stats ? stats.active_users_count : '—'} color="var(--signal)" />
        <KpiCard icon={Building2} label="Active Contractors" value={stats ? stats.active_contractors_count : '—'} color="var(--violet, #6d5bd0)" />
      </motion.div>

      <div className="grid" style={{ gridTemplateColumns: '1fr 1fr', alignItems: 'start' }}>
        <SystemHealthWidget health={health} onNavigateTab={onNavigateTab} />
        <RecentActivityWidget entries={recent} />
      </div>

      <AuditLogPreview entries={recent.slice(0, 5)} onNavigateTab={onNavigateTab} />
    </div>
  )
}

function KpiCard({ icon: Icon, label, value, color }) {
  return (
    <motion.div className="stat" variants={fadeUp} style={{ '--accent-glow': color }} whileHover={{ y: -3 }} transition={{ type: 'spring', stiffness: 300, damping: 20 }}>
      <div className="label"><Icon size={15} strokeWidth={2} /> {label}</div>
      <div className="value tnum">{value}</div>
    </motion.div>
  )
}

function SystemHealthWidget({ health, onNavigateTab }) {
  return (
    <div className="card card-pad">
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <Database size={16} style={{ color: 'var(--text-muted)' }} />
        <h3 style={{ fontSize: 15 }}>System health</h3>
      </div>

      {health === false ? (
        <p className="muted" style={{ fontSize: 13 }}>Could not load system health.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <HealthRow
            icon={Database}
            label="Database"
            value={health.db_status === 'ok' ? 'Operational' : 'Error'}
            tone={health.db_status === 'ok' ? 'green' : 'red'}
          />
          <HealthRow
            icon={GitBranch}
            label="Migrations"
            value={health.alembic_mismatch ? `Mismatch (${health.alembic_current_revision || '—'} → ${health.alembic_head_revision || '—'})` : 'Up to date'}
            tone={health.alembic_mismatch ? 'amber' : 'green'}
          />

          <div style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
            <div className="row" style={{ gap: 7, marginBottom: 6 }}>
              <UploadCloud size={14} style={{ color: 'var(--text-dim)' }} />
              <span className="muted" style={{ fontSize: 12.5, fontWeight: 500 }}>Last CPM import</span>
            </div>
            {health.last_cpm_import ? (
              <div style={{ fontSize: 13, lineHeight: 1.6 }}>
                <span className="text-data" style={{ fontWeight: 500 }}>{health.last_cpm_import.filename}</span>
                <div className="dim" style={{ fontSize: 12.5 }}>
                  {health.last_cpm_import.imported_by || 'Unknown'} · {formatDateTime(health.last_cpm_import.created_at)}
                </div>
                <div className="row wrap" style={{ gap: 6, marginTop: 6 }}>
                  <span className="pill pill-dim">{health.last_cpm_import.total_rows} rows</span>
                  <span className="pill pill-green">{health.last_cpm_import.new_count} new</span>
                  {health.last_cpm_import.changed_count > 0 && (
                    <span className="pill pill-amber">{health.last_cpm_import.changed_count} changed</span>
                  )}
                </div>
              </div>
            ) : (
              <span className="dim" style={{ fontSize: 12.5 }}>No imports yet.</span>
            )}
          </div>

          <div className="row between" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 12 }}>
            <div className="row" style={{ gap: 7 }}>
              <GitCompare size={14} style={{ color: 'var(--text-dim)' }} />
              <span style={{ fontSize: 13 }}>
                <b className="tnum">{health.pending_change_requests_count}</b> pending change request{health.pending_change_requests_count === 1 ? '' : 's'}
              </span>
            </div>
            {health.pending_change_requests_count > 0 && (
              <button className="btn btn-sm" onClick={() => onNavigateTab('validate')}>
                Review <ArrowRight size={13} />
              </button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function HealthRow({ icon: Icon, label, value, tone }) {
  const pillClass = tone === 'green' ? 'pill-green' : tone === 'red' ? 'pill-red' : 'pill-amber'
  return (
    <div className="row between">
      <div className="row" style={{ gap: 7 }}>
        <Icon size={14} style={{ color: 'var(--text-dim)' }} />
        <span style={{ fontSize: 13 }}>{label}</span>
      </div>
      <span className={`pill ${pillClass}`}>{value}</span>
    </div>
  )
}

function RecentActivityWidget({ entries }) {
  return (
    <div className="card card-pad">
      <div className="row" style={{ gap: 8, marginBottom: 14 }}>
        <Activity size={16} style={{ color: 'var(--text-muted)' }} />
        <h3 style={{ fontSize: 15 }}>Recent activity</h3>
      </div>
      {entries.length === 0 ? (
        <span className="dim" style={{ fontSize: 12.5 }}>No activity recorded yet.</span>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {entries.map((e) => (
            <div key={e.id} style={{ fontSize: 13, lineHeight: 1.5 }}>
              <div>{describeAuditEntry(e)}</div>
              <span className="dim" style={{ fontSize: 11.5 }}>{formatDateTime(e.created_at)}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function AuditLogPreview({ entries, onNavigateTab }) {
  return (
    <div className="card">
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div className="row between">
          <div className="row" style={{ gap: 8 }}>
            <ScrollText size={16} style={{ color: 'var(--text-muted)' }} />
            <h3 style={{ fontSize: 15 }}>Audit log</h3>
          </div>
          <button className="btn btn-sm btn-ghost" onClick={() => onNavigateTab('audit')}>
            View all <ArrowRight size={13} />
          </button>
        </div>
      </div>
      {entries.length === 0 ? (
        <div style={{ padding: '0 20px 20px' }} className="dim">No entries yet.</div>
      ) : (
        <div className="table-wrap" style={{ border: 'none', borderRadius: 0, borderTop: '1px solid var(--border)' }}>
          <table>
            <thead>
              <tr>
                <th>Time</th>
                <th>User</th>
                <th>Event</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td className="dim tnum" style={{ fontSize: 12.5, whiteSpace: 'nowrap' }}>{formatDateTime(e.created_at)}</td>
                  <td style={{ fontWeight: 500 }}>{actorLabel(e)}</td>
                  <td className="muted" style={{ fontSize: 13 }}>{describeAuditEntry(e)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
