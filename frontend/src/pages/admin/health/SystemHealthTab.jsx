import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../../api/client'
import Icon from '../../../components/Icon'
import PageFrame from '../../../components/PageFrame'
import PageHeader from '../../../components/PageHeader'
import Sparkline from '../../../components/Sparkline'
import { Modal } from '../../../components/ui'
import { useAuth } from '../../../context/AuthContext'
import { useToast } from '../../../context/ToastContext'
import { FEATURE, can } from '../../../lib/access'
import { detailMessage } from '../../../lib/apiError'
import { formatDateTime } from '../../../lib/auditLog'
import { formatNumber } from '../../../lib/numbers'
import {
  STATE_LABEL, agoText, areaPoints, daysSince, formatBytes, formatCores, formatGrowth,
} from './healthModel'
import '../../../styles/system-health.css'

/**
 * Admin › System health (UEP-25): is UEP healthy, at a glance. Six blocks on
 * one screen, charts first. App and Resources read UEP's own namespace when
 * DevOps has granted read access; otherwise they say so in grey and the rest
 * works. Admin sees Usage and records backup confirmations; PM and Viewer
 * read the rest. No green anywhere: normal is plain, Watch is amber, a
 * problem is red, and each carries an icon and a word.
 */
export default function SystemHealthTab() {
  const { user } = useAuth()
  const admin = can(user, FEATURE.SYSTEM_HEALTH, 'edit')
  const [data, setData] = useState(null)
  const [error, setError] = useState(null)
  const [refreshing, setRefreshing] = useState(false)
  const [backupOpen, setBackupOpen] = useState(false)
  const [loadedAt, setLoadedAt] = useState(null)

  const load = useCallback(async () => {
    setRefreshing(true)
    setError(null)
    try {
      const { data: body } = await api.get('/admin/system-health')
      setData(body)
      setLoadedAt(new Date())
    } catch (err) {
      setError(detailMessage(err, 'Check your connection and try again.'))
    } finally {
      setRefreshing(false)
    }
  }, [])
  useEffect(() => { load() }, [load])

  const summary = data?.summary
  const header = (
    <PageHeader
      title={<><span className="sh-title-tile" aria-hidden="true"><Icon name="activity" size={20} /></span>System health</>}
      count={summary && <Verdict summary={summary} />}
      freshness={{
        at: loadedAt,
        label: loadedAt ? `As of ${loadedAt.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}` : null,
        onRefresh: load,
        refreshing,
      }}
    />
  )

  return (
    <PageFrame bar={header} className="sh-page">
      {error && (
        <div className="sh-error" role="alert">
          <span>System health could not be loaded. {error}</span>
          <button type="button" className="btn" onClick={load}>Try again</button>
        </div>
      )}
      {!error && !data && <div className="sh-grid" aria-busy="true">{Array.from({ length: 6 }, (_, i) => <div key={i} className="sh-card sh-skel" />)}</div>}
      {!error && data && (
        <div className={`sh-grid ${data.usage ? '' : 'no-usage'}`.trim()}>
          <AppBlock data={data} />
          <ResourcesBlock data={data} />
          <DatabaseBlock database={data.database} />
          <BackupsBlock backups={data.backups} admin={admin} onConfirm={() => setBackupOpen(true)} />
          <FreshnessBlock freshness={data.freshness} />
          {data.usage && <UsageBlock usage={data.usage} />}
        </div>
      )}
      {backupOpen && (
        <BackupDialog
          onClose={() => setBackupOpen(false)}
          onSaved={(backups) => { setData((d) => ({ ...d, backups })); setBackupOpen(false); load() }}
        />
      )}
    </PageFrame>
  )
}

function Verdict({ summary }) {
  const problem = summary.status !== 'normal'
  return (
    <span className={`sh-verdict ${problem ? 'is-red' : ''}`.trim()} role="status">
      <Icon name={problem ? 'warning--alt' : 'checkmark--outline'} size={16} />
      {summary.headline}
    </span>
  )
}

function StateTag({ state }) {
  if (!state || state === 'ok') return null
  const icon = state === 'unknown' ? 'help' : 'warning--alt'
  return (
    <span className={`sh-tag is-${state}`}>
      <Icon name={icon} size={16} />{STATE_LABEL[state]}
    </span>
  )
}

function Block({ title, icon, state, children, action, className = '' }) {
  return (
    <section className={`sh-card ${className}`.trim()} aria-label={title}>
      <header className="sh-card-head">
        <h2><Icon name={icon} size={16} />{title}</h2>
        <span className="sh-card-end">{action}<StateTag state={state} /></span>
      </header>
      <div className="sh-card-body">{children}</div>
    </section>
  )
}

function NotConnected({ message }) {
  return <p className="sh-grey">{message || 'Not connected — needs read access from DevOps'}</p>
}

function AppBlock({ data }) {
  const app = data.app
  return (
    <Block title="App" icon="cloud--upload" state={app ? app.state : 'unknown'}>
      {!data.kubernetes_connected || !app ? <NotConnected message={data.kubernetes_message} /> : (
        <>
          <p className="sh-line">
            <b>{app.ready} of {app.total}</b> pods ready
            {app.version && <span className="sh-pill">Version {app.version}</span>}
          </p>
          <ul className="sh-pods" aria-label="Pods">
            {app.pods.map((p) => (
              <li key={p.name} className={`sh-pod ${p.ready ? '' : 'is-red'}`.trim()} title={`${p.name} · ${p.phase}${p.ready ? ' · ready' : ' · not ready'} · ${p.restarts} restarts`}>
                <span className="sh-pod-dot" aria-hidden="true" />
                <span className="sh-pod-name">{p.component}</span>
              </li>
            ))}
          </ul>
          <dl className="sh-facts">
            <div><dt>Restarts in 24 h</dt><dd className="tnum">{formatNumber(app.restarts_24h)}</dd></div>
            <div><dt>Last start</dt><dd>{app.last_start ? formatDateTime(app.last_start) : '—'}</dd></div>
          </dl>
        </>
      )}
    </Block>
  )
}

function Gauge({ label, gauge, format }) {
  const pct = gauge?.percent
  const state = gauge?.state || 'unknown'
  return (
    <div className="sh-gauge">
      <div className="sh-gauge-top">
        <span>{label}</span>
        <span className="tnum">
          {pct == null ? 'Not known' : `${format(gauge.used)} of ${format(gauge.limit)} · ${Math.round(pct)}%`}
        </span>
      </div>
      <div
        className={`sh-track is-${state}`}
        role="meter"
        aria-label={label}
        aria-valuemin={0}
        aria-valuemax={100}
        aria-valuenow={pct == null ? undefined : Math.round(pct)}
        title={pct == null ? 'Not known' : `${Math.round(pct)}% of the namespace limit`}
      >
        <span className="sh-fill" style={{ width: `${Math.min(100, pct || 0)}%` }} />
        <span className="sh-tick" style={{ left: '75%' }} aria-hidden="true" />
        <span className="sh-tick" style={{ left: '90%' }} aria-hidden="true" />
      </div>
      {state !== 'ok' && state !== 'unknown' && <StateTag state={state} />}
    </div>
  )
}

function ResourcesBlock({ data }) {
  const r = data.resources
  const worst = r ? ['red', 'amber'].find((s) => r.cpu.state === s || r.memory.state === s) : null
  return (
    <Block title="Resources" icon="meter" state={!r ? 'unknown' : (worst || (r.metrics_available ? 'ok' : 'unknown'))}>
      {!data.kubernetes_connected || !r ? <NotConnected message={data.kubernetes_message} /> : (
        <>
          <Gauge label="CPU" gauge={r.cpu} format={formatCores} />
          <Gauge label="Memory" gauge={r.memory} format={formatBytes} />
          {!r.metrics_available && <p className="sh-grey">CPU and memory need metrics-server</p>}
        </>
      )}
    </Block>
  )
}

/** The 90-day area chart, with a crosshair and a tooltip on hover. */
function AreaChart({ series, valueKey, label }) {
  const W = 320
  const H = 96
  const ref = useRef(null)
  const [hover, setHover] = useState(null)
  const points = areaPoints(series, valueKey, W, H)
  if (points.length < 2) return <p className="sh-grey">The chart fills in as daily snapshots are taken</p>
  const line = points.map((p, i) => `${i ? 'L' : 'M'}${p.x.toFixed(1)},${p.y.toFixed(1)}`).join(' ')
  const area = `${line} L${points[points.length - 1].x.toFixed(1)},${H - 4} L${points[0].x.toFixed(1)},${H - 4} Z`

  function onMove(event) {
    const box = ref.current.getBoundingClientRect()
    const x = ((event.clientX - box.left) / box.width) * W
    let best = points[0]
    for (const p of points) if (Math.abs(p.x - x) < Math.abs(best.x - x)) best = p
    setHover(best)
  }

  return (
    <div className="sh-chart">
      <svg
        ref={ref}
        viewBox={`0 0 ${W} ${H}`}
        preserveAspectRatio="none"
        role="img"
        aria-label={`${label}: ${formatBytes(points[0].value)} to ${formatBytes(points[points.length - 1].value)} over ${points.length} days`}
        onMouseMove={onMove}
        onMouseLeave={() => setHover(null)}
      >
        <line x1="4" x2={W - 4} y1={H - 4} y2={H - 4} className="sh-axis" />
        <path d={area} className="sh-area" />
        <path d={line} className="sh-line-path" vectorEffect="non-scaling-stroke" />
        {hover && (
          <>
            <line x1={hover.x} x2={hover.x} y1="4" y2={H - 4} className="sh-cross" vectorEffect="non-scaling-stroke" />
            <circle cx={hover.x} cy={hover.y} r="4" className="sh-dot" vectorEffect="non-scaling-stroke" />
          </>
        )}
      </svg>
      {hover && (
        <div className="sh-tip" style={{ left: `${(hover.x / W) * 100}%` }} role="tooltip">
          <span>{String(hover.day).slice(0, 10)}</span>
          <b className="tnum">{formatBytes(hover.value)}</b>
        </div>
      )}
    </div>
  )
}

function DatabaseBlock({ database }) {
  const tables = database.largest_tables || []
  const max = Math.max(1, ...tables.map((t) => t.bytes))
  return (
    <Block title="Database" icon="data--base">
      <p className="sh-big tnum">{formatBytes(database.bytes)}</p>
      <p className="sh-sub">
        {formatGrowth(database.growth_90d_bytes)} in 90 days · stored files {formatBytes(database.files_bytes)}
      </p>
      <AreaChart series={database.series || []} valueKey="db_bytes" label="Database size" />
      <ul className="sh-bars" aria-label="Largest tables">
        {tables.map((t) => (
          <li key={t.table} title={`${t.table}: ${formatBytes(t.bytes)}`}>
            <span className="sh-bar-name">{t.table}</span>
            <span className="sh-bar-track"><span className="sh-bar-fill" style={{ width: `${(t.bytes / max) * 100}%` }} /></span>
            <span className="sh-bar-value tnum">{formatBytes(t.bytes)}</span>
          </li>
        ))}
      </ul>
    </Block>
  )
}

function BackupsBlock({ backups, admin, onConfirm }) {
  const days = backups.confirmed_on ? daysSince(backups.confirmed_on) : null
  return (
    <Block
      title="Backups"
      icon="archive"
      state={backups.state}
      action={admin && <button type="button" className="btn btn-sm" onClick={onConfirm}>Record backup</button>}
    >
      {!backups.confirmed_on ? <p className="sh-grey">No backup confirmed yet</p> : (
        <>
          <p className={`sh-big tnum ${backups.state === 'red' ? 'is-red' : ''}`.trim()}>{String(backups.confirmed_on).slice(0, 10)}</p>
          <p className="sh-sub">Last backup confirmed {agoText(days)}</p>
          <p className="sh-sub">Entered by {backups.entered_by || '—'}{backups.note ? ` · ${backups.note}` : ''}</p>
        </>
      )}
    </Block>
  )
}

function FreshRow({ label, state, children }) {
  return (
    <li className={`sh-fresh ${state === 'red' ? 'is-red' : ''}`.trim()}>
      <span className="sh-fresh-label">{label}</span>
      <span className="sh-fresh-value">{children}</span>
      <StateTag state={state} />
    </li>
  )
}

function FreshnessBlock({ freshness }) {
  const { cpm, mojri, migrations } = freshness
  const state = migrations.state === 'red' || freshness.mojri_state === 'red' ? 'red' : 'ok'
  return (
    <Block title="Data freshness" icon="time" state={state}>
      <ul className="sh-fresh-list">
        <FreshRow label="CPM import">
          {cpm ? `${formatDateTime(cpm.at)} · ${cpm.by || '—'} · ${formatNumber(cpm.rows)} rows` : 'No import yet'}
        </FreshRow>
        <FreshRow label="Mojri upload" state={freshness.mojri_state === 'unknown' ? null : freshness.mojri_state}>
          {mojri ? `${formatDateTime(mojri.at)} · ${mojri.by || '—'}` : 'No upload yet'}
        </FreshRow>
        <FreshRow label="Migrations" state={migrations.state}>
          {migrations.mismatch ? `${migrations.current || 'none'} → ${migrations.head}` : 'At the latest version'}
        </FreshRow>
      </ul>
    </Block>
  )
}

function UsageBlock({ usage }) {
  const values = usage.series_14d.map((d) => d.active_users)
  return (
    <Block title="Usage" icon="user--multiple">
      <div className="sh-usage-top">
        <div>
          <p className="sh-big tnum">{formatNumber(usage.active_today)}</p>
          <p className="sh-sub">active today</p>
        </div>
        <Sparkline values={values} label="Active users" />
      </div>
      <dl className="sh-facts">
        <div><dt>Failed sign-ins, 24 h</dt><dd className="tnum">{formatNumber(usage.failed_logins_24h)}</dd></div>
        <div><dt>Server errors, 24 h</dt><dd className={`tnum ${usage.errors_24h > 0 ? 'is-red' : ''}`.trim()}>{formatNumber(usage.errors_24h)}</dd></div>
      </dl>
    </Block>
  )
}

function BackupDialog({ onClose, onSaved }) {
  const toast = useToast()
  const today = new Date().toISOString().slice(0, 10)
  const [date, setDate] = useState(today)
  const [note, setNote] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)

  async function save() {
    setBusy(true)
    setError(null)
    try {
      const { data } = await api.put('/admin/system-health/backup-confirmation', { date, note: note.trim() || null })
      toast.success('Backup recorded', `Last backup confirmed ${date}`)
      onSaved(data)
    } catch (err) {
      setError(detailMessage(err, 'Check the date and try again.'))
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal open size="sm" title="Record the last confirmed backup" onClose={onClose}
      footer={(
        <>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>Cancel</button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={busy || !date}>{busy ? 'Please wait…' : 'Save'}</button>
        </>
      )}
    >
      <label className="sh-field">
        <span>Date the database team confirmed</span>
        <input className="input" type="date" max={today} value={date} onChange={(e) => setDate(e.target.value)} />
      </label>
      <label className="sh-field">
        <span>Note (optional)</span>
        <input className="input" value={note} maxLength={500} onChange={(e) => setNote(e.target.value)} />
      </label>
      {error && <p className="sh-field-error" role="alert">{error}</p>}
    </Modal>
  )
}
