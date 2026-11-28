import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api/client'
import Icon from '../../components/Icon'
import PageFrame from '../../components/PageFrame'
import PageHeader from '../../components/PageHeader'
import { useAuth } from '../../context/AuthContext'
import { FEATURE, can } from '../../lib/access'
import { formatDayMonth } from '../../lib/dates'
import { formatNumber } from '../../lib/numbers'
import '../../styles/home.css'
import '../../styles/admin-contractors.css'

const API = '/admin/contractors'
const TOAST_MS = 6000

/** When this user last opened the page, so names imported since can be flagged. */
const seenKey = (user) => `uep.contractors.seen.${user?.id ?? 'me'}`
function useLastSeen(user) {
  const [seen] = useState(() => {
    const at = localStorage.getItem(seenKey(user))
    return at ? new Date(at) : null
  })
  useEffect(() => {
    localStorage.setItem(seenKey(user), new Date().toISOString())
  }, [user])
  return seen
}

const isNew = (c, seen) => c.source === 'cpm' && seen && c.created_at && new Date(c.created_at) > seen

function sourceText(c, seen) {
  if (c.source === 'manual') return 'Added by hand'
  return isNew(c, seen) ? `CPM · new ${formatDayMonth(c.created_at)}` : 'CPM'
}

/**
 * Admin > Contractors (UEP-31 §7): which drive-test contractors appear in
 * Drive test's Assign columns, and contractors added by hand. Hiding one
 * keeps their open sites, history and login. PM and Admin edit; Viewer reads.
 */
export default function ContractorsPage() {
  const { user } = useAuth()
  const canEdit = can(user, FEATURE.CONTRACTORS, 'edit')
  const seen = useLastSeen(user)
  const [rows, setRows] = useState(null)
  const [failed, setFailed] = useState(false)
  const [tab, setTab] = useState('shown')
  const [query, setQuery] = useState('')
  const [adding, setAdding] = useState(false)
  const [toast, setToast] = useState(null)

  const load = useCallback(() => {
    setFailed(false)
    api.get(API).then((r) => setRows(r.data)).catch(() => setFailed(true))
  }, [])
  useEffect(load, [load])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])

  const shown = useMemo(() => (rows || []).filter((c) => c.show_in_drive_test), [rows])
  const hidden = useMemo(() => (rows || []).filter((c) => !c.show_in_drive_test), [rows])
  const newHidden = hidden.filter((c) => isNew(c, seen))
  const list = (tab === 'shown' ? shown : hidden).filter(
    (c) => !query.trim() || c.name.toLowerCase().includes(query.trim().toLowerCase()),
  )

  const replace = (row) => setRows((all) => all.map((c) => (c.id === row.id ? row : c)))

  async function setShown(c, on, fromUndo = false) {
    try {
      const { data } = await api.patch(`${API}/${c.id}`, { show_in_drive_test: on })
      replace(data)
      if (!fromUndo) {
        setToast({
          text: on ? `${c.name} shown in Drive test` : `${c.name} hidden from Drive test · open sites stay with them`,
          undo: () => setShown(data, !on, true),
        })
      } else {
        setToast(null)
      }
    } catch (err) {
      setToast({ text: err.response?.data?.detail || 'Could not save. Please try again.', error: true })
    }
  }

  async function add(name) {
    const { data } = await api.post(API, { name })
    setRows((all) => [...all, data].sort((a, b) => a.name.localeCompare(b.name)))
    setAdding(false)
    setTab('shown')
    setToast({ text: `${data.name} added and shown in Drive test` })
  }

  const header = (
    <PageHeader
      title="Contractors"
      actions={
        canEdit && (
          <button type="button" className="btn btn-primary" disabled={adding || !rows} onClick={() => setAdding(true)}>
            <Icon name="add" size={16} /> Add contractor
          </button>
        )
      }
    />
  )

  return (
    <PageFrame bar={header} className="cad-page">
      {newHidden.length > 0 && (
        <p className="cad-info">
          <Icon name="information" size={16} />
          <span>
            {formatNumber(newHidden.length)} new {newHidden.length === 1 ? 'name' : 'names'} from the{' '}
            {formatDayMonth(newHidden.map((c) => c.created_at).sort().at(-1))} CPM import{' '}
            {newHidden.length === 1 ? 'is' : 'are'} hidden.
          </span>
          <button type="button" className="cad-link" onClick={() => setTab('hidden')}>Review</button>
        </p>
      )}
      <section className="card cad-card" aria-busy={!rows && !failed}>
        <header className="cad-tools">
          <div className="cad-seg" role="radiogroup" aria-label="Show contractors">
            {[['shown', 'Shown', shown.length], ['hidden', 'Hidden', hidden.length]].map(([key, label, n]) => (
              <button key={key} type="button" role="radio" aria-checked={tab === key} className="cad-seg-btn" onClick={() => setTab(key)}>
                {label} <span className="cad-seg-count">{rows ? formatNumber(n) : '–'}</span>
              </button>
            ))}
          </div>
          <label className="cad-search">
            <Icon name="search" size={16} />
            <input type="search" value={query} aria-label="Search contractor name" placeholder="Contractor name…" onChange={(e) => setQuery(e.target.value)} />
          </label>
        </header>
        <div className="cad-scroll">
          {failed ? (
            <div className="cad-state" role="alert">
              <b>Couldn't load contractors.</b>
              <button type="button" className="btn" onClick={load}>Retry</button>
            </div>
          ) : (
            <table className="cad-table" aria-label="Contractors">
              <colgroup>
                <col style={{ width: '24%' }} />
                <col style={{ width: '17%' }} />
                <col />
                <col style={{ width: '11%' }} />
                <col style={{ width: '16%' }} />
              </colgroup>
              <thead>
                <tr>
                  <th scope="col">Contractor</th>
                  <th scope="col">Source</th>
                  <th scope="col">Works in</th>
                  <th scope="col">Open now</th>
                  <th scope="col">Show in Drive test</th>
                </tr>
              </thead>
              <tbody>
                {adding && <AddRow onAdd={add} onCancel={() => setAdding(false)} />}
                {rows && list.map((c) => {
                  const open = c.open_hc + c.open_dt
                  return (
                    <tr key={c.id}>
                      <td className="cad-name">{c.name}</td>
                      <td>{sourceText(c, seen)}</td>
                      <td>
                        {c.provinces.length ? (
                          <bdi dir="rtl" lang="fa" className="cad-fa">{c.provinces.join('، ')}</bdi>
                        ) : (
                          <span className="cad-none">—</span>
                        )}
                      </td>
                      <td className={`cad-num ${!c.show_in_drive_test && open > 0 ? 'is-late' : ''}`.trim()}>{formatNumber(open)}</td>
                      <td>
                        <button
                          type="button"
                          role="switch"
                          className="cad-switch"
                          aria-checked={c.show_in_drive_test}
                          aria-label={`Show ${c.name} in Drive test`}
                          disabled={!canEdit}
                          onClick={() => setShown(c, !c.show_in_drive_test)}
                        />
                      </td>
                    </tr>
                  )
                })}
              </tbody>
            </table>
          )}
        </div>
      </section>
      {toast && (
        <div className={`cad-toast ${toast.error ? 'is-error' : ''}`.trim()} role={toast.error ? 'alert' : 'status'}>
          <span>{toast.text}</span>
          {toast.undo && <button type="button" className="cad-toast-undo" onClick={toast.undo}>Undo</button>}
        </div>
      )}
    </PageFrame>
  )
}

/** The inline first row that adds a contractor: Enter saves, Esc cancels. */
function AddRow({ onAdd, onCancel }) {
  const [name, setName] = useState('')
  const [error, setError] = useState(null)
  const [busy, setBusy] = useState(false)
  const inputRef = useRef(null)
  useEffect(() => inputRef.current?.focus(), [])

  async function save() {
    if (!name.trim() || busy) return
    setBusy(true)
    setError(null)
    try {
      await onAdd(name)
    } catch (err) {
      setError(err.response?.status === 409 ? 'A contractor with this name already exists.' : err.response?.data?.detail || 'Could not add. Please try again.')
      setBusy(false)
    }
  }

  return (
    <tr className="cad-add">
      <td colSpan={4}>
        <input
          ref={inputRef}
          className="cad-input"
          aria-label="Contractor name"
          aria-invalid={error ? true : undefined}
          aria-describedby={error ? 'cad-add-error' : undefined}
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') save()
            if (e.key === 'Escape') onCancel()
          }}
        />
        {error && <span id="cad-add-error" className="cad-error">{error}</span>}
      </td>
      <td>
        <span className="cad-add-actions">
          <button type="button" className="btn btn-sm btn-primary" disabled={!name.trim() || busy} onClick={save}>Add</button>
          <button type="button" className="btn btn-sm btn-ghost" onClick={onCancel}>Cancel</button>
        </span>
      </td>
    </tr>
  )
}
