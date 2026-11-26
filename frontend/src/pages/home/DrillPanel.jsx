import { useEffect, useId, useMemo, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useNavigate } from 'react-router-dom'
import api from '../../api/client'
import Icon from '../../components/Icon'
import { useDialogFocus } from '../../components/useDialogFocus'
import { describeBlobError, filenameFrom, saveBlob } from '../../lib/download'
import { formatNumber } from '../../lib/numbers'
import { NO_GROUP, STATUSES, ageBar, groupByDay, openUrl, unitFor } from './homeLogic'

/**
 * The panel behind every number on Home (UEP-27 §4.5).
 *
 * The page owns the stack of views (`views`, newest last) and passes
 * `onPush`, `onBack` and `onClose`; this component draws the top one:
 *
 * * `{ kind: 'summary', title, crumb, lines, exportTitle }` -- one line per
 *   queue, each opening that queue's list;
 * * `{ kind: 'list', ticket, crumb, appName, status }` -- a queue's items:
 *   status chips, search, grouping, age bars, Export and Open in {app};
 * * `{ kind: 'done' }` -- this week's finished acts, by day;
 * * `{ kind: 'pip' }` -- each contractor's delivery against target.
 *
 * A dialog over a light scrim: the page behind never scrolls or reflows, and
 * the list scrolls inside. Esc, ✕ and the scrim close it, and focus returns
 * to the number that opened it (useDialogFocus).
 */
export default function DrillPanel({ views, canExport, onPush, onBack, onClose }) {
  const panelRef = useRef(null)
  const titleId = useId()
  const open = views.length > 0
  useDialogFocus(open, panelRef, onClose)
  if (!open) return null
  const view = views[views.length - 1]
  const shared = { view, titleId, canExport, onPush, onBack: views.length > 1 ? onBack : null, onClose }
  const View = VIEWS[view.kind]
  return createPortal(
    <div className="hd-root">
      <div className="hd-scrim" onClick={onClose} data-testid="drill-scrim" />
      <aside ref={panelRef} className="hd-panel" role="dialog" aria-modal="true" aria-labelledby={titleId} data-view={view.kind}>
        <View key={views.length} {...shared} />
      </aside>
    </div>,
    document.body,
  )
}

// ---------------------------------------------------------------------------
// Shared parts
// ---------------------------------------------------------------------------
function Header({ titleId, crumb, title, figure, onBack, onClose, children }) {
  return (
    <div className="hd-head">
      <div className="hd-top">
        <div className="hd-titles">
          <div className="hd-crumb">
            {onBack ? (
              <>
                <button type="button" className="hd-back" onClick={onBack}>
                  <Icon name="arrow--left" size={16} />Back
                </button>
                <span aria-hidden="true">·</span>
                <span>{crumb}</span>
              </>
            ) : crumb}
          </div>
          <h2 id={titleId}>{title}{figure && <small>{figure}</small>}</h2>
        </div>
        <button type="button" className="hd-close" aria-label="Close" onClick={onClose}>
          <Icon name="close" size={16} />
        </button>
      </div>
      {children}
    </div>
  )
}

/** Downloads a server-built file; reports what went wrong when it fails. */
function useExport() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)
  const run = async (url, params, fallback) => {
    setBusy(true)
    setError(null)
    try {
      const r = await api.get(url, { params, responseType: 'blob' })
      saveBlob(r.data, filenameFrom(r.headers, fallback))
    } catch (err) {
      setError(await describeBlobError(err, 'Could not export the list.'))
    } finally {
      setBusy(false)
    }
  }
  return { busy, error, run }
}

function ExportButton({ exporter, onClick }) {
  return (
    // aria-disabled, not disabled: a disabled button drops focus to <body>,
    // and Esc would then no longer reach the panel.
    <button
      type="button"
      className={`hd-export${exporter.busy ? ' is-busy' : ''}`}
      onClick={exporter.busy ? undefined : onClick}
      aria-disabled={exporter.busy || undefined}
      aria-busy={exporter.busy}
    >
      <Icon name="download" size={16} />
      {exporter.busy ? 'Preparing…' : 'Export to Excel'}
    </button>
  )
}

function Footer({ count, exporter, onExport, children }) {
  return (
    <div className="hd-foot">
      <span className="hd-count">{count}</span>
      {exporter.error && <span className="hd-error" role="alert">{exporter.error}</span>}
      {onExport && <ExportButton exporter={exporter} onClick={onExport} />}
      {children}
    </div>
  )
}

function useFetch(url, params) {
  const [state, setState] = useState({ data: null, error: null, loading: true })
  const key = JSON.stringify(params || {})
  useEffect(() => {
    let live = true
    setState((s) => ({ ...s, loading: true }))
    api.get(url, params ? { params } : undefined)
      .then((r) => live && setState({ data: r.data, error: null, loading: false }))
      .catch(() => live && setState((s) => ({ ...s, error: 'This list didn’t load.', loading: false })))
    return () => { live = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- `key` is the params
  }, [url, key])
  return state
}

function Empty({ title, hint }) {
  return <div className="hd-empty"><b>{title}</b>{hint && <span>{hint}</span>}</div>
}

const totalOf = (counts) => Object.values(counts || {}).reduce((a, b) => a + b, 0)

// ---------------------------------------------------------------------------
// Summary: one line per queue
// ---------------------------------------------------------------------------
function SummaryView({ view, titleId, canExport, onPush, onBack, onClose }) {
  const exporter = useExport()
  const lines = view.lines
  const total = lines.reduce((s, l) => s + l.count, 0)
  const late = lines.reduce((s, l) => s + (l.late || 0), 0)
  const max = Math.max(1, ...lines.map((l) => l.count))
  return (
    <>
      <Header titleId={titleId} crumb={view.crumb} title={view.title} figure={formatNumber(total)} onBack={onBack} onClose={onClose}>
        {late > 0 && (
          <div className="hd-sum">
            <div className="hd-bar" aria-hidden="true">
              <i className="hs-late" style={{ flexGrow: late }} />
              <i className="hs-not-late" style={{ flexGrow: total - late }} />
            </div>
            <div className="hd-chips">
              <span className="hd-chip is-static"><i className="hs-late" />Late <b>{formatNumber(late)}</b></span>
              <span className="hd-chip is-static"><i className="hs-not-late" />Not late <b>{formatNumber(total - late)}</b></span>
            </div>
          </div>
        )}
      </Header>
      <div className="hd-list" tabIndex={0} aria-label="Items">
        {lines.length === 0 && <Empty title="Nothing here" hint="New work will appear here." />}
        {lines.map((line, i) => (
          <button
            key={line.key}
            type="button"
            className="hd-line"
            style={{ '--r': i }}
            data-line={line.key}
            onClick={() => onPush({ kind: 'list', ticket: line.ticket, crumb: view.title, appName: line.appName })}
          >
            <span className="hd-line-label"><i style={{ background: line.color }} aria-hidden="true" />{line.label}</span>
            <span className="hd-line-count">
              {line.late > 0 && <em>{formatNumber(line.late)} late</em>}
              {formatNumber(line.count)}<small>{unitFor(line.count, line.unit)}</small>
            </span>
            <Icon name="chevron--right" size={16} className="hd-chev" />
            <span className="hd-hbar" style={{ width: `${(line.count / max) * 100}%` }} aria-hidden="true">
              {line.late > 0 && <i className="hs-late" style={{ flexGrow: line.late }} />}
              <i className="hs-not-late" style={{ flexGrow: line.count - (line.late || 0) }} />
            </span>
          </button>
        ))}
      </div>
      <Footer
        count={`${formatNumber(lines.length)} ${unitFor(lines.length, 'lines')}`}
        exporter={exporter}
        onExport={canExport ? () => exporter.run('/me/home/export.xlsx', {
          panel: 'summary', title: view.exportTitle || view.title, queues: lines.map((l) => l.key).join(','),
        }, 'UEP_Summary.xlsx') : null}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// List: one queue's items
// ---------------------------------------------------------------------------
const GROUPS = [['none', 'No groups'], ['province', 'Province'], ['contractor', 'Contractor']]
const SEARCH_DEBOUNCE_MS = 250
const PAGE = 1000

function useDebounced(value, ms) {
  const [v, setV] = useState(value)
  useEffect(() => {
    const id = setTimeout(() => setV(value), ms)
    return () => clearTimeout(id)
  }, [value, ms])
  return v
}

function AgeBar({ item }) {
  const bar = ageBar(item)
  const cls = { late: 'hs-late', due_soon: 'hs-due', on_time: 'hs-on-time', no_date: 'hs-no-date' }[item.status]
  let text
  if (item.status === 'no_date') text = <span>No date</span>
  else if (item.age_days != null) {
    text = <><b>{formatNumber(item.age_days)} {unitFor(item.age_days, 'days')}</b>{item.sla_days != null && <span>SLA {item.sla_days}</span>}</>
  } else if (item.due_at) {
    text = <span>Due {new Intl.DateTimeFormat('en-GB', { day: 'numeric', month: 'short' }).format(new Date(item.due_at))}</span>
  }
  return (
    <span className={`hd-age ${cls}`}>
      <span className="hd-age-text">{text}</span>
      <span className="hd-track" aria-hidden="true">
        <i style={{ width: `${bar.width}%` }} />
        {bar.tick != null && <u style={{ left: `${bar.tick}%` }} />}
      </span>
    </span>
  )
}

function ItemRow({ item, index }) {
  const meta = [item.village_name && item.site_id, item.province, item.holder_name].filter(Boolean).join(' · ')
  return (
    <div className="hd-item" style={{ '--r': index }} data-status={item.status}>
      <b>{item.label}{item.village_name && item.village_name !== item.label ? ` ${item.village_name}` : ''}</b>
      <AgeBar item={item} />
      <span className="hd-meta">{meta || '—'}</span>
    </div>
  )
}

function ItemList({ data }) {
  if (data.items.length === 0) return <Empty title="No matches" hint="Try another word or filter." />
  if (data.group === 'none') return data.items.map((item, i) => <ItemRow key={item.id} item={item} index={i} />)
  // The server orders items by group, largest first: a header where one starts.
  const groupOf = (item) => item[data.group] || NO_GROUP[data.group]
  const byKey = Object.fromEntries(data.groups.map((g) => [g.key, g]))
  const out = []
  let current = null
  data.items.forEach((item, i) => {
    const key = groupOf(item)
    if (key !== current) {
      current = key
      const g = byKey[key] || { key, count: 0, late: 0 }
      out.push(
        <div key={`g:${key}`} className="hd-group" style={{ '--r': i }} role="heading" aria-level={3}>
          {key}<span>{formatNumber(g.count)}{g.late ? ` · ${formatNumber(g.late)} late` : ''}</span>
        </div>,
      )
    }
    out.push(<ItemRow key={item.id} item={item} index={i} />)
  })
  return out
}

function ListView({ view, titleId, canExport, onBack, onClose }) {
  const navigate = useNavigate()
  const ticket = view.ticket
  const [status, setStatus] = useState(view.status || 'all')
  const [q, setQ] = useState('')
  const [group, setGroup] = useState('none')
  const debouncedQ = useDebounced(q, SEARCH_DEBOUNCE_MS)
  const params = useMemo(() => ({ status, q: debouncedQ, group, size: PAGE }), [status, debouncedQ, group])
  const { data, error, loading } = useFetch(`/me/queues/${ticket.queue_key}/items`, params)
  const exporter = useExport()
  const counts = data?.counts_by_status
  const all = totalOf(counts)
  const chips = [['all', 'All', all], ...STATUSES.filter((s) => counts?.[s.key]).map((s) => [s.key, s.label, counts[s.key]])]
  const exportParams = { status, q: debouncedQ, group }
  return (
    <>
      <Header
        titleId={titleId}
        crumb={view.crumb}
        title={ticket.short_label}
        figure={`${formatNumber(ticket.count)} ${unitFor(ticket.count, ticket.unit)}`}
        onBack={onBack}
        onClose={onClose}
      >
        <div className="hd-sum">
          <div className="hd-bar is-thick" aria-hidden="true">
            {STATUSES.filter((s) => counts?.[s.key]).map((s) => <i key={s.key} className={s.cls} style={{ flexGrow: counts[s.key] }} />)}
          </div>
          <div className="hd-chips" role="group" aria-label="Filter by status">
            {chips.map(([key, label, n]) => (
              <button key={key} type="button" className="hd-chip" aria-pressed={status === key} data-status={key} onClick={() => setStatus(key)}>
                {key !== 'all' && <i className={STATUSES.find((s) => s.key === key).cls} aria-hidden="true" />}
                {label} <b>{formatNumber(n)}</b>
              </button>
            ))}
          </div>
        </div>
      </Header>
      <div className="hd-tools">
        <label className="hd-search">
          <Icon name="search" size={16} />
          <input type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Find a site, village or contractor" aria-label="Find in this list" maxLength={100} />
        </label>
        <div className="hd-seg" role="group" aria-label="Group by">
          {GROUPS.map(([key, label]) => (
            <button key={key} type="button" aria-pressed={group === key} onClick={() => setGroup(key)}>{label}</button>
          ))}
        </div>
      </div>
      <div className="hd-list" tabIndex={0} aria-label="Items" aria-busy={loading} data-testid="drill-list">
        {error && !data && <Empty title={error} hint="Close the panel and try again." />}
        {!data && !error && <ListSkeleton />}
        {data && <ItemList data={data} />}
        {data && data.total > data.items.length && (
          <p className="hd-more">Showing the first {formatNumber(data.items.length)}. Export to Excel for all {formatNumber(data.total)}.</p>
        )}
      </div>
      <Footer
        count={data ? `${formatNumber(data.total)} in this list` : ' '}
        exporter={exporter}
        onExport={canExport ? () => exporter.run(`/me/queues/${ticket.queue_key}/export.xlsx`, exportParams, 'UEP_List.xlsx') : null}
      >
        <button
          type="button"
          className="hd-open"
          onClick={() => { onClose(); navigate(openUrl(ticket.url, { status, q: debouncedQ })) }}
        >
          Open in {view.appName || 'UEP'}<Icon name="arrow--right" size={16} />
        </button>
      </Footer>
    </>
  )
}

function ListSkeleton() {
  return (
    <div aria-hidden="true" className="hd-skel">
      {[0, 1, 2, 3, 4].map((i) => <span key={i} className="h-skel" style={{ height: 36, marginBottom: 8 }} />)}
    </div>
  )
}

// ---------------------------------------------------------------------------
// Done this week
// ---------------------------------------------------------------------------
function DoneView({ titleId, canExport, onBack, onClose }) {
  const { data, error } = useFetch('/me/done', { period: 'week' })
  const exporter = useExport()
  const groups = data ? groupByDay(data.items) : []
  let i = 0
  return (
    <>
      <Header titleId={titleId} crumb="This week" title="Done this week" figure={data ? `${formatNumber(data.total)} ${unitFor(data.total, 'items')}` : null} onBack={onBack} onClose={onClose} />
      <div className="hd-list" tabIndex={0} aria-label="Items" aria-busy={!data && !error}>
        {error && <Empty title={error} />}
        {!data && !error && <ListSkeleton />}
        {data && data.total === 0 && <Empty title="Nothing finished yet this week" hint="The week starts on Saturday." />}
        {groups.map((g) => (
          <div key={g.key} role="group" aria-label={g.label}>
            <div className="hd-group" style={{ '--r': i++ }}>{g.label}<span>{formatNumber(g.items.length)}</span></div>
            {g.items.map((item) => (
              <div key={item.id} className="hd-item" style={{ '--r': i++ }}>
                <b>{item.label || item.action}</b>
                <span className="hd-age hs-on-time"><span className="hd-age-text"><span>{item.province || ''}</span></span></span>
                <span className="hd-meta">{item.action}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <Footer
        count={data ? `${formatNumber(data.total)} this week` : ' '}
        exporter={exporter}
        onExport={canExport ? () => exporter.run('/me/home/export.xlsx', { panel: 'done' }, 'UEP_Done-this-week.xlsx') : null}
      />
    </>
  )
}

// ---------------------------------------------------------------------------
// Contractor PIP
// ---------------------------------------------------------------------------
function PipView({ titleId, canExport, onBack, onClose }) {
  const { data, error } = useFetch('/me/pip/by-contractor')
  const exporter = useExport()
  const rows = data?.rows || []
  const target = rows.reduce((s, r) => s + (r.target || 0), 0)
  const max = Math.max(1, ...rows.map((r) => Math.max(r.target || 0, r.delivered)))
  return (
    <>
      <Header
        titleId={titleId}
        crumb={data ? `This month · ${formatNumber(data.days_left)} ${unitFor(data.days_left, 'days')} left` : 'This month'}
        title="Contractor PIP"
        figure={data ? `${formatNumber(rows.reduce((s, r) => s + r.delivered, 0))} of ${formatNumber(target)} sites` : null}
        onBack={onBack}
        onClose={onClose}
      />
      <div className="hd-list" tabIndex={0} aria-label="Items" aria-busy={!data && !error}>
        {error && <Empty title={error} />}
        {!data && !error && <ListSkeleton />}
        {data && rows.length === 0 && <Empty title="No contractor plans this month" />}
        {rows.map((r, i) => {
          const span = Math.max(r.target || 0, r.delivered)
          return (
            <div key={r.contractor} className="hd-line is-static" style={{ '--r': i }}>
              <span className="hd-line-label"><i className="hs-pip" aria-hidden="true" />{r.contractor}</span>
              <span className="hd-line-count">
                {formatNumber(r.delivered)}<small>{r.target != null ? `of ${formatNumber(r.target)}` : 'no plan'}</small>
              </span>
              <span className="hd-hbar" style={{ width: `${(span / max) * 100}%` }} aria-hidden="true">
                <i className="hs-pip" style={{ flexGrow: r.delivered }} />
                <i className="hs-rest" style={{ flexGrow: Math.max(0, (r.target || 0) - r.delivered) }} />
              </span>
            </div>
          )
        })}
      </div>
      <Footer
        count={`${formatNumber(rows.length)} ${unitFor(rows.length, 'lines')}`}
        exporter={exporter}
        onExport={canExport ? () => exporter.run('/me/home/export.xlsx', { panel: 'pip' }, 'UEP_Contractor-PIP.xlsx') : null}
      />
    </>
  )
}

const VIEWS = { summary: SummaryView, list: ListView, done: DoneView, pip: PipView }
