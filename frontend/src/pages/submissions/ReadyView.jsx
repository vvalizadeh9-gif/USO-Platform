// Ready to submit (UEP-21 §4.4): sites with their villages, a reason panel,
// and the cycle bar. Everything is ticked by default.
import { useCallback, useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import Icon from '../../components/Icon'
import ShamsiDayInput from '../../components/ShamsiDayInput'
import { detailMessage } from '../../lib/apiError'
import { formatNumber } from '../../lib/numbers'
import * as api from './api'
import { REASONS, cycleText, plural, shamsiInput } from './format'
import { CardError, CardHead, GregorianDay, ShamsiDay, SkeletonRows } from './parts'

function useReady(reason, since) {
  const [state, setState] = useState({ data: null, error: '' })
  const load = useCallback(() => {
    setState((s) => ({ ...s, error: '' }))
    api.fetchReady({ reason: reason === 'all' ? undefined : reason, since: since || undefined })
      .then((data) => setState({ data, error: '' }))
      .catch((err) => setState({ data: null, error: detailMessage(err, 'The list did not load.') }))
  }, [reason, since])
  useEffect(load, [load])
  return { ...state, load }
}

function SiteRow({ site, picked, open, onToggleOpen, onToggleSite, onToggleVillage, canAct }) {
  const ids = site.villages.map((v) => v.id)
  const n = ids.filter((id) => picked.has(id)).length
  return (
    <>
      <div className="sb-row sb-ready-row" role="row">
        {canAct ? (
          <input
            type="checkbox"
            aria-label={`Select site ${site.site_code}`}
            checked={n === ids.length}
            ref={(el) => { if (el) el.indeterminate = n > 0 && n < ids.length }}
            onChange={() => onToggleSite(ids, n !== ids.length)}
          />
        ) : <span />}
        <button type="button" className="sb-expand" aria-expanded={open} aria-label={`Show villages of ${site.site_code}`} onClick={onToggleOpen}>
          <Icon name={open ? 'chevron--down' : 'chevron--right'} size={16} />
        </button>
        <span className="sb-strong">{site.site_code}<span className="sb-type">{site.site_type}</span></span>
        <span className="sb-num">{site.villages_ready} of {site.villages_total}</span>
        <span className="sb-fa">{site.province || '—'}</span>
        <span>{site.cra_region || '—'}</span>
        <span className="sb-muted"><GregorianDay value={site.dt_date} /></span>
      </div>
      {open && site.villages.map((v) => (
        <label key={v.id} className="sb-row sb-village-row">
          {canAct ? (
            <input type="checkbox" aria-label={`Select village ${v.code}`} checked={picked.has(v.id)} onChange={() => onToggleVillage(v.id)} />
          ) : <span />}
          <span />
          <span className="sb-num">{v.code}</span>
          <span className="sb-fa">{v.name}</span>
        </label>
      ))}
    </>
  )
}

function ReasonPanel({ counts, reason, onPick, cycle }) {
  const c = cycleText(cycle)
  return (
    <aside className="sb-card sb-panel" aria-label="By reason">
      <h2 className="sb-panel-title">By reason</h2>
      <div className="sb-reasons">
        {REASONS.map((r) => (
          <button
            key={r.id}
            type="button"
            className={`sb-reason ${reason === r.id ? 'is-active' : ''}`.trim()}
            aria-pressed={reason === r.id}
            onClick={() => onPick(r.id)}
          >
            <span className="sb-reason-tile" style={{ background: `var(${r.tile})` }} aria-hidden="true"><Icon name={r.icon} size={16} /></span>
            <span className="sb-reason-label">{r.label}</span>
            <span className="sb-reason-count">{counts ? formatNumber(counts[r.id]) : '—'}</span>
          </button>
        ))}
      </div>
      {cycle && (
        <div className="sb-cycle">
          <div className="sb-cycle-head">
            <span>Batch #{cycle.next_number} cycle</span>
            <span data-tone={c.tone || undefined}>{c.due}</span>
          </div>
          <div className="sb-cycle-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={c.pct} aria-label={`Batch #${cycle.next_number} cycle`}>
            <i style={{ '--pct': `${c.pct}%` }} />
          </div>
          {cycle.day != null && (
            <div className="sb-muted sb-cycle-line">
              Day {cycle.day} of {cycle.days} · #{cycle.last_number} sent <ShamsiDay value={cycle.last_date} />
            </div>
          )}
        </div>
      )}
    </aside>
  )
}

export default function ReadyView({ summary, canAct, onChanged }) {
  const navigate = useNavigate()
  const [reason, setReason] = useState('all')
  const [sinceOn, setSinceOn] = useState(false)
  const [since, setSince] = useState(() => shamsiInput(summary?.cycle?.last_date))
  const { data, error, load } = useReady(reason, sinceOn ? since : '')
  const [picked, setPicked] = useState(new Set())
  const [open, setOpen] = useState(new Set())
  const [busy, setBusy] = useState(false)
  const [actionError, setActionError] = useState('')

  useEffect(() => {
    if (data) setPicked(new Set(data.sites.flatMap((s) => s.villages.map((v) => v.id))))
  }, [data])
  useEffect(() => { if (!since && summary?.cycle?.last_date) setSince(shamsiInput(summary.cycle.last_date)) }, [summary, since])

  const sites = useMemo(() => data?.sites || [], [data])
  const pickedSites = sites.filter((s) => s.villages.some((v) => picked.has(v.id))).length
  const toggleVillage = (id) => setPicked((p) => { const n = new Set(p); n.has(id) ? n.delete(id) : n.add(id); return n })
  const toggleSite = (ids, on) => setPicked((p) => { const n = new Set(p); ids.forEach((id) => (on ? n.add(id) : n.delete(id))); return n })
  const toggleOpen = (id) => setOpen((o) => { const n = new Set(o); n.has(id) ? n.delete(id) : n.add(id); return n })
  const allIds = sites.flatMap((s) => s.villages.map((v) => v.id))

  async function create() {
    setBusy(true)
    setActionError('')
    try {
      const { number } = await api.createDraft([...picked])
      onChanged()
      navigate(`/submissions/batches/${number}`)
    } catch (err) {
      setActionError(detailMessage(err, 'The draft was not created.'))
      load()
    } finally {
      setBusy(false)
    }
  }

  const empty = data && !sites.length
  return (
    <div className="sb-ready">
      <article className="sb-card sb-list" aria-labelledby="sb-ready-title">
        <CardHead icon="send" title="Ready to submit" id="sb-ready-title">
          <div className="sb-since">
            <button type="button" className="uw-btn uw-btn-sm" aria-pressed={sinceOn} onClick={() => setSinceOn((v) => !v)} disabled={!since}>
              <Icon name="time" size={16} />New since
            </button>
            {sinceOn && <ShamsiDayInput value={since} onChange={setSince} aria-label="New since (Shamsi date)" />}
          </div>
        </CardHead>
        <div className="sb-thead sb-ready-row" role="row">
          {canAct ? (
            <input type="checkbox" aria-label="Select all sites" checked={allIds.length > 0 && picked.size === allIds.length}
              onChange={() => setPicked(picked.size === allIds.length ? new Set() : new Set(allIds))} />
          ) : <span />}
          <span /><span>Site ID</span><span>Villages</span><span>Province</span><span>CRA region</span><span>DT approved</span>
        </div>
        <div className="sb-scroll">
          {error && <CardError message={error} onRetry={load} />}
          {!data && !error && <SkeletonRows />}
          {empty && (
            <div className="sb-empty">
              <Icon name="checkmark--outline" size={20} />
              <b>Nothing to submit</b>
              {summary?.cycle?.due_in != null && <span>Next batch due in {plural(Math.max(0, summary.cycle.due_in), 'day')}</span>}
            </div>
          )}
          {sites.map((s) => (
            <SiteRow
              key={s.work_item_id}
              site={s}
              picked={picked}
              open={open.has(s.work_item_id)}
              canAct={canAct}
              onToggleOpen={() => toggleOpen(s.work_item_id)}
              onToggleSite={toggleSite}
              onToggleVillage={toggleVillage}
            />
          ))}
        </div>
        {canAct && (
          <div className="sb-bulk" aria-live="polite">
            <span><b>{formatNumber(picked.size)}</b> villages · <b>{formatNumber(pickedSites)}</b> sites selected</span>
            {actionError && <span className="sb-error">{actionError}</span>}
            <span className="sb-grow" />
            <button type="button" className="uw-btn" onClick={() => setPicked(new Set())} disabled={!picked.size}>Clear</button>
            <button type="button" className="uw-btn uw-btn-primary" onClick={create} disabled={!picked.size || busy}>
              <Icon name="send" size={16} />Create draft batch #{summary?.cycle?.next_number ?? ''}
            </button>
          </div>
        )}
      </article>
      <ReasonPanel counts={data?.counts} reason={reason} onPick={setReason} cycle={summary?.cycle} />
    </div>
  )
}
