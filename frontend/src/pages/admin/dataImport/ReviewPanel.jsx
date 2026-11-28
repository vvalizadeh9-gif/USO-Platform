import { useCallback, useEffect, useRef, useState } from 'react'
import api from '../../../api/client'
import Icon from '../../../components/Icon'
import { SegmentedControl, Tabs } from '../../../components/ui'
import { useToast } from '../../../context/ToastContext'
import { detailMessage } from '../../../lib/apiError'
import { describeBlobError, filenameFrom, saveBlob } from '../../../lib/download'
import SummaryBar from './SummaryBar'
import { applyState, fmt, showValue } from './dataImportModel'

const DECISION_OPTIONS = [
  { key: 'keep', label: 'Keep UEP' },
  { key: 'file', label: 'Use file' },
]

/** Step 3: the whole file at a glance, then Conflicts · Errors · Changes,
 * and the footer that applies it. */
export default function ReviewPanel({ batch, onBatch, onCancel, onApplied, onExpired }) {
  const toast = useToast()
  const counts = batch.counts || {}
  const decisions = batch.decisions || {}
  const [tab, setTab] = useState(decisions.conflicts > 0 ? 'conflicts' : counts.row_errors > 0 ? 'errors' : 'changes')
  const [field, setField] = useState('')
  const [q, setQ] = useState('')
  const [page, setPage] = useState(1)
  const [data, setData] = useState(null)
  const [loading, setLoading] = useState(false)
  const [applying, setApplying] = useState(false)
  // Read through refs so a new toast or callback object never re-fetches.
  const toastRef = useRef(toast)
  const expiredRef = useRef(onExpired)
  toastRef.current = toast
  expiredRef.current = onExpired

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const { data: body } = await api.get(`/data-import/batches/${batch.id}/preview`, {
        params: { tab, field: field || undefined, q: q || undefined, page },
      })
      setData(body)
    } catch (err) {
      toastRef.current.error('Preview not loaded', detailMessage(err, 'Try again.'))
      if (err.response?.status === 409) expiredRef.current?.()
    } finally {
      setLoading(false)
    }
  }, [batch.id, tab, field, q, page])
  useEffect(() => { load() }, [load])

  async function decide(payload) {
    try {
      const { data: body } = await api.post(`/data-import/batches/${batch.id}/decisions`, payload)
      onBatch({ ...batch, decisions: body.decisions })
      if (payload.change_ids && data) {
        setData({ ...data, items: data.items.map((i) => (payload.change_ids.includes(i.id) ? { ...i, decision: payload.decision } : i)) })
      } else {
        load()
      }
    } catch (err) {
      toast.error('Choice not saved', detailMessage(err, 'Try again.'))
    }
  }

  async function apply() {
    setApplying(true)
    try {
      const { data: body } = await api.post(`/data-import/batches/${batch.id}/apply`)
      onApplied(body)
    } catch (err) {
      toast.error('Nothing was applied', detailMessage(err, 'Try again.'))
    } finally {
      setApplying(false)
    }
  }

  async function errorFile() {
    try {
      const r = await api.get(`/data-import/batches/${batch.id}/errors.xlsx`, { responseType: 'blob' })
      saveBlob(r.data, filenameFrom(r.headers, `UEP_import_${batch.number}_errors.xlsx`))
    } catch (err) {
      toast.error('Error file not downloaded', await describeBlobError(err))
    }
  }

  const state = applyState(decisions, applying)
  const tabs = [
    { key: 'conflicts', label: 'Conflicts', count: decisions.conflicts || 0, alert: decisions.undecided || undefined },
    { key: 'errors', label: 'Errors', count: counts.row_errors || 0 },
    { key: 'changes', label: 'Changes', count: decisions.to_apply || 0 },
  ]
  const changeTab = (key) => { setData(null); setTab(key); setField(''); setPage(1) }
  const pages = data ? Math.max(1, Math.ceil(data.total / data.page_size)) : 1

  return (
    <div className="di-review">
      <SummaryBar counts={counts} />
      {(counts.warnings?.length > 0 || counts.already_imported_as) && (
        <ul className="di-warnings" aria-label="Warnings">
          {counts.already_imported_as && (
            <li><Icon name="warning--alt" size={16} />This file was already imported as batch #{counts.already_imported_as}</li>
          )}
          {(counts.warnings || []).slice(0, 3).map((w) => <li key={w}><Icon name="warning--alt" size={16} />{w}</li>)}
        </ul>
      )}

      <section className="di-card di-table-card">
        <div className="di-table-head">
          <Tabs tabs={tabs} value={tab} onChange={changeTab} label="Review" />
          <div className="di-table-tools">
            {tab !== 'errors' && data?.fields?.length > 0 && (
              <select className="di-select" aria-label="Field" value={field}
                onChange={(e) => { setField(e.target.value); setPage(1) }}>
                <option value="">All fields</option>
                {data.fields.map((f) => <option key={f.field} value={f.field}>{f.label} ({fmt(f.count)})</option>)}
              </select>
            )}
            <input className="di-search" type="search" placeholder="Site or village" aria-label="Search"
              value={q} onChange={(e) => { setQ(e.target.value); setPage(1) }} />
            {tab === 'conflicts' && decisions.conflicts > 0 && (
              <>
                <button type="button" className="btn btn-sm" onClick={() => decide(field ? { decision: 'keep', field } : { decision: 'keep', all: true })}>
                  Keep UEP for all
                </button>
                <button type="button" className="btn btn-sm" onClick={() => decide(field ? { decision: 'file', field } : { decision: 'file', all: true })}>
                  Use file for all
                </button>
              </>
            )}
            {tab === 'errors' && counts.row_errors > 0 && (
              <button type="button" className="btn btn-sm" onClick={errorFile}>
                <Icon name="download" size={16} />Download error file
              </button>
            )}
          </div>
        </div>

        <div className="di-table-scroll" aria-busy={loading}>
          {data && data.items.length === 0 && !loading && <p className="di-empty">Nothing here</p>}
          {data && data.items.length > 0 && (data.tab === 'errors'
            ? <ErrorTable items={data.items} />
            : <ChangeTable items={data.items} conflicts={data.tab === 'conflicts'} onDecide={decide} />)}
          {!data && <div className="di-skel" />}
        </div>
        {pages > 1 && (
          <div className="di-pager tnum">
            <button type="button" className="btn btn-sm" disabled={page <= 1} onClick={() => setPage(page - 1)} aria-label="Previous page">
              <Icon name="chevron--left" size={16} />
            </button>
            {page} / {pages}
            <button type="button" className="btn btn-sm" disabled={page >= pages} onClick={() => setPage(page + 1)} aria-label="Next page">
              <Icon name="chevron--right" size={16} />
            </button>
          </div>
        )}
      </section>

      <footer className="di-footer">
        {state.reason && <span className="di-footer-reason">{state.reason}</span>}
        <button type="button" className="btn" onClick={onCancel} disabled={applying}>Cancel</button>
        <button type="button" className="btn btn-primary" onClick={apply} disabled={state.disabled}
          title={state.reason || undefined}>
          {applying ? 'Applying…' : state.label}
        </button>
      </footer>
    </div>
  )
}

function Where({ item }) {
  return (
    <td className="di-where">
      <span className="tnum">{item.site_id}</span> <span className="di-dim">{item.site_type}</span>
      {item.village_code && <> · <span className="tnum">{item.village_code}</span></>}
    </td>
  )
}

function ChangeTable({ items, conflicts, onDecide }) {
  return (
    <table className="di-table">
      <thead>
        <tr>
          <th scope="col">Site / village</th>
          <th scope="col">Field</th>
          <th scope="col">UEP value</th>
          <th scope="col">File value</th>
          {conflicts && <th scope="col" className="di-col-choice">Choice</th>}
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.id} className={conflicts && !item.decision ? 'is-open' : ''}>
            <Where item={item} />
            <td>{item.field_label}</td>
            <td>
              {showValue(item.uep_value)}
              {item.uep_source && <span className="di-source">{item.uep_source}</span>}
            </td>
            <td className="di-file-value">{showValue(item.file_value)}</td>
            {conflicts && (
              <td className="di-col-choice">
                <SegmentedControl options={DECISION_OPTIONS} value={item.decision}
                  label={`Choice for ${item.field_label} of ${item.site_id}`}
                  onChange={(decision) => onDecide({ decision, change_ids: [item.id] })} />
              </td>
            )}
          </tr>
        ))}
      </tbody>
    </table>
  )
}

function ErrorTable({ items }) {
  return (
    <table className="di-table">
      <thead>
        <tr>
          <th scope="col" className="di-col-row">Row</th>
          <th scope="col">Site ID</th>
          <th scope="col">Site type</th>
          <th scope="col">Village code</th>
          <th scope="col">Message</th>
        </tr>
      </thead>
      <tbody>
        {items.map((item) => (
          <tr key={item.row}>
            <td className="tnum di-col-row">{item.row}</td>
            <td className="tnum">{item.site_id || '—'}</td>
            <td>{item.site_type || '—'}</td>
            <td className="tnum">{item.village_code || '—'}</td>
            <td className={item.status === 'error' ? 'di-msg is-error' : 'di-msg'}>
              {item.messages.join(' · ')}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
