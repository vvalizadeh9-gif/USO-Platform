import { AnimatePresence, motion, useReducedMotion } from 'framer-motion'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api/client'
import Icon from '../../components/Icon'
import PageHeader from '../../components/PageHeader'
import { useAuth } from '../../context/AuthContext'
import '../../styles/home.css'
import '../../styles/sla-policies.css'

const MIN_DAYS = 1
const MAX_DAYS = 365

// Lifecycle order, three columns (UEP-15 §3).
const COLUMNS = [['health_check', 'remediation'], ['drive_test', 'monthly_plan'], ['acceptance']]
const AREA_STYLE = {
  health_check: { color: '#1D4ED8', tint: 'var(--uep-accent-tint)', icon: 'network--3' },
  remediation: { color: '#B45309', tint: 'var(--uep-app-monthly-plan-tint)', icon: 'tool-kit' },
  drive_test: { color: '#0F766E', tint: 'var(--uep-app-drive-test-tint)', icon: 'connection-signal' },
  monthly_plan: { color: '#B45309', tint: 'var(--uep-app-monthly-plan-tint)', icon: 'calendar' },
  acceptance: { color: '#6D28D9', tint: 'var(--uep-app-acceptance-tint)', icon: 'certificate--check' },
}

const isValid = (v) => /^\d+$/.test(String(v)) && Number(v) >= MIN_DAYS && Number(v) <= MAX_DAYS

function formatDate(at) {
  if (!at) return ''
  return new Date(at).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })
}

function formatWhen(at) {
  if (!at) return ''
  return new Date(at).toLocaleString('en-GB', {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  })
}

const errorText = (err) => {
  const d = err?.response?.data?.detail
  if (typeof d === 'string') return d
  if (d?.message) return d.message
  return 'Please try again.'
}

/**
 * Admin > SLA policies (UEP-15): every step's SLA in days, edited in one place.
 * Update saves every changed row in one request; it applies across UEP on the
 * next read. PM and Admin edit; Viewer reads.
 */
export default function SlaPoliciesPage() {
  const { user } = useAuth()
  const canEdit = ['PM', 'Admin'].includes(user?.role?.name)
  const reduced = useReducedMotion()
  const titleRef = useRef(null)

  const [data, setData] = useState(null)
  const [loadError, setLoadError] = useState(false)
  const [draft, setDraft] = useState({})
  const [busy, setBusy] = useState(false)
  const [toast, setToast] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)
  const [conflict, setConflict] = useState([])

  const load = useCallback(() => {
    setLoadError(false)
    return api.get('/admin/sla-policies')
      .then((r) => { setData(r.data); return r.data })
      .catch(() => { setLoadError(true); return null })
  }, [])
  useEffect(() => { load() }, [load])

  useEffect(() => {
    if (!toast) return undefined
    const t = setTimeout(() => setToast(null), toast.revertId ? 8000 : 5000)
    return () => clearTimeout(t)
  }, [toast])

  const rows = useMemo(() => data?.rows ?? [], [data])
  const changed = rows.filter((r) => draft[r.step_key] !== undefined && String(draft[r.step_key]) !== String(r.days))
  const invalid = changed.some((r) => !isValid(draft[r.step_key]))
  const canUpdate = canEdit && !busy && changed.length > 0 && !invalid

  function setValue(key, value) {
    setConflict([])
    setDraft((d) => ({ ...d, [key]: value }))
  }

  async function update() {
    if (!canUpdate) return
    setBusy(true)
    try {
      const r = await api.put('/admin/sla-policies', {
        changes: changed.map((row) => ({
          step_key: row.step_key, days: Number(draft[row.step_key]), expected_days: row.days,
        })),
      })
      setData(r.data)
      setDraft({})
      const n = changed.length
      setToast({ text: `${n} SLA${n === 1 ? '' : 's'} updated across UEP`, revertId: r.data.change_id })
      titleRef.current?.focus()
    } catch (err) {
      if (err?.response?.status === 409) {
        const stale = Object.keys(err.response.data?.detail?.stale ?? {})
        await load()
        setDraft({})
        setConflict(stale)
        setToast({ text: 'Someone else saved meanwhile. The latest values are loaded.', error: true })
      } else {
        setToast({ text: `Couldn't update: ${errorText(err)}`, error: true })
      }
    } finally {
      setBusy(false)
    }
  }

  async function revert(changeId) {
    setToast(null)
    try {
      const r = await api.post(`/admin/sla-policies/revert/${changeId}`)
      setData(r.data)
      setDraft({})
      setToast({ text: 'Previous SLAs restored' })
    } catch (err) {
      setToast({ text: `Couldn't revert: ${errorText(err)}`, error: true })
    }
  }

  const meta = data && (
    <>
      {rows.length} steps · all values in days
      {data.last_change && ` · last change ${formatDate(data.last_change.at)} by ${data.last_change.by}`}
    </>
  )

  const actions = (
    <div className="sla-actions">
      {invalid && <span className="sla-invalid-msg" role="alert">Use 1–365 days</span>}
      {canEdit && changed.length > 0 && (
        <span className="sla-dirty">
          {changed.length} unsaved change{changed.length === 1 ? '' : 's'} ·{' '}
          <button type="button" className="sla-link" onClick={() => setDraft({})}>Discard</button>
        </span>
      )}
      <button type="button" className="btn btn-secondary btn-sm" onClick={() => setHistoryOpen(true)} disabled={!data}>
        History
      </button>
      {canEdit && (
        <button type="button" className="btn btn-primary btn-sm" disabled={!canUpdate} onClick={update}>
          {changed.length > 0 ? `Update ${changed.length}` : 'Update'}
        </button>
      )}
    </div>
  )

  const byArea = (area) => rows.filter((r) => r.area === area)

  return (
    <div className="sla-page">
      <PageHeader title="SLA policies" count={meta} actions={actions} headingRef={titleRef} />

      {loadError && (
        <div className="sla-board">
          <div className="hw-card sla-error">
            <b>Couldn&apos;t load SLA policies</b>
            <button type="button" className="btn btn-secondary btn-sm" onClick={load}>Retry</button>
          </div>
        </div>
      )}

      {!loadError && (
        <div className="sla-board">
          {COLUMNS.map((areas, ci) => (
            <div className="sla-col" key={ci}>
              {areas.map((area, ai) => {
                const label = data?.areas.find((a) => a.key === area)?.label
                const style = AREA_STYLE[area]
                const items = byArea(area)
                return (
                  <motion.section
                    key={area}
                    className="hw-card sla-card"
                    aria-label={label}
                    initial={reduced ? false : { opacity: 0, y: 8 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ duration: 0.24, delay: reduced ? 0 : (ci * 2 + ai) * 0.05 }}
                  >
                    <header className="hw-head sla-head" style={{ background: style.tint }}>
                      <span className="sla-tile" style={{ background: style.color }}>
                        <Icon name={style.icon} size={20} />
                      </span>
                      <h3>{label ?? <span className="h-skel" style={{ width: 120, height: 16 }} />}</h3>
                      {data && <span className="sla-count">{items.length} steps</span>}
                    </header>
                    {!data ? (
                      <div className="sla-rows" aria-busy="true">
                        {[0, 1, 2].map((i) => (
                          <div className="sla-row" key={i}><span className="h-skel" style={{ width: '60%', height: 14 }} /></div>
                        ))}
                      </div>
                    ) : (
                      <div className="sla-rows">
                        {items.map((row) => (
                          <SlaRow
                            key={row.step_key}
                            row={row}
                            value={draft[row.step_key] ?? row.days}
                            canEdit={canEdit}
                            conflicted={conflict.includes(row.step_key)}
                            onChange={(v) => setValue(row.step_key, v)}
                            onEnter={update}
                          />
                        ))}
                      </div>
                    )}
                  </motion.section>
                )
              })}
            </div>
          ))}
        </div>
      )}

      <AnimatePresence>
        {historyOpen && (
          <HistoryDrawer
            onClose={() => setHistoryOpen(false)}
            reduced={reduced}
          />
        )}
      </AnimatePresence>

      <AnimatePresence>
        {toast && (
          <motion.div
            className={`sla-toast ${toast.error ? 'is-error' : ''}`}
            role={toast.error ? 'alert' : 'status'}
            initial={reduced ? false : { opacity: 0, y: 24 }}
            animate={{ opacity: 1, y: 0 }}
            exit={reduced ? { opacity: 0 } : { opacity: 0, y: 24 }}
            transition={{ duration: 0.2 }}
          >
            <span>{toast.text}</span>
            {toast.revertId && canEdit && (
              <button type="button" className="sla-link sla-toast-action" onClick={() => revert(toast.revertId)}>
                Revert
              </button>
            )}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

function SlaRow({ row, value, canEdit, conflicted, onChange, onEnter }) {
  const isChanged = String(value) !== String(row.days)
  const valid = isValid(value)
  const n = Number(value)
  const step = (delta) => {
    const base = valid ? n : row.days
    onChange(Math.min(MAX_DAYS, Math.max(MIN_DAYS, base + delta)))
  }
  const onKeyDown = (e) => {
    if (e.key === 'ArrowUp') { e.preventDefault(); step(1) }
    else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1) }
    else if (e.key === 'Enter') { e.preventDefault(); onEnter() }
  }
  const inputId = `sla-${row.step_key}`
  return (
    <div className={`sla-row ${isChanged ? 'is-changed' : ''} ${conflicted ? 'is-conflict' : ''}`.trim()}>
      <div className="sla-row-text">
        <label className="sla-row-label" htmlFor={canEdit ? inputId : undefined}>
          {row.label}
          {isChanged && <span className="sla-dot" aria-label="changed" />}
        </label>
        <span className="sla-row-meta">{row.meta}</span>
      </div>
      {canEdit ? (
        <div className="sla-stepper">
          {isChanged && <s className="sla-old" aria-label={`was ${row.days}`}>{row.days}</s>}
          <button type="button" className="sla-step" aria-label={`Decrease ${row.label}`}
            disabled={valid && n <= MIN_DAYS} onClick={() => step(-1)}>
            <Icon name="subtract" size={16} />
          </button>
          <input
            id={inputId}
            className={`sla-input ${valid ? '' : 'is-invalid'}`.trim()}
            inputMode="numeric"
            value={value}
            aria-invalid={!valid}
            onChange={(e) => onChange(e.target.value.trim())}
            onKeyDown={onKeyDown}
          />
          <button type="button" className="sla-step" aria-label={`Increase ${row.label}`}
            disabled={valid && n >= MAX_DAYS} onClick={() => step(1)}>
            <Icon name="add" size={16} />
          </button>
          <span className="sla-unit">days</span>
        </div>
      ) : (
        <div className="sla-stepper"><span className="sla-value">{row.days}</span><span className="sla-unit">days</span></div>
      )}
    </div>
  )
}

function HistoryDrawer({ onClose, reduced }) {
  const [entries, setEntries] = useState(null)
  const [failed, setFailed] = useState(false)
  const closeRef = useRef(null)
  useEffect(() => {
    api.get('/admin/sla-policies/history?limit=50').then((r) => setEntries(r.data)).catch(() => setFailed(true))
    closeRef.current?.focus()
    const onKey = (e) => { if (e.key === 'Escape') onClose() }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])
  return (
    <>
      <motion.div className="sla-scrim" onClick={onClose}
        initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
      <motion.aside
        className="sla-drawer"
        role="dialog"
        aria-modal="true"
        aria-label="SLA history"
        initial={reduced ? false : { x: 420 }}
        animate={{ x: 0 }}
        exit={reduced ? { opacity: 0 } : { x: 420 }}
        transition={{ duration: 0.24, ease: [0.2, 0, 0, 1] }}
      >
        <header className="sla-drawer-head">
          <h2>History</h2>
          <button ref={closeRef} type="button" className="sla-step" aria-label="Close history" onClick={onClose}>
            <Icon name="close" size={16} />
          </button>
        </header>
        <div className="sla-drawer-body">
          {failed && <p className="sla-row-meta">Couldn&apos;t load history.</p>}
          {!entries && !failed && <p className="sla-row-meta">Loading…</p>}
          {entries && (
            <ol className="sla-timeline">
              {entries.map((e, i) => (
                <li key={e.change_id}>
                  <div className="sla-tl-head">
                    <b>{e.by}</b>
                    <span>{formatWhen(e.at)}</span>
                    {i === 0 && <span className="sla-current">Current</span>}
                  </div>
                  <ul>
                    {e.changes.map((c) => (
                      <li key={c.step_key}>
                        {c.label}: {c.old_days == null ? '' : `${c.old_days} d → `}{c.new_days} d
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          )}
        </div>
      </motion.aside>
    </>
  )
}
