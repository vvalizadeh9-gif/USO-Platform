import { useEffect, useMemo, useRef, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import SiteHistoryDrawer from '../../components/SiteHistoryDrawer'
import {
  EmptyStep, Fa, Flag, SiteIdButton, SkeletonRows, StepError, VillageCount, WorkListCard,
} from '../../components/work/parts'
import { useWork } from '../../components/work/WorkContext'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { formatDateTime } from '../../lib/dates'
import { formatNumber } from '../../lib/numbers'
import useStepData, { useExportRows } from './useStepData'

// Fallback only: categories are admin-extendable, so the live list comes from
// /reference/problem-categories; this keeps the screen usable if that fails.
const FALLBACK_CATEGORIES = ['Managed Service', 'CPG Project', 'NWG RND', 'Huawei Cleanup', 'Temp Power']

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'to_decide', label: 'To decide' },
  { key: 'overdue', label: 'Late' },
  { key: 'completed', label: 'Done' },
]

const plural = (n, one) => `${formatNumber(n)} ${n === 1 ? one : `${one}s`}`

const EXPORT_COLUMNS = [
  { label: 'Batch', value: (r) => r.code },
  { label: 'Contractor', value: (r) => r.contractor },
  { label: 'Assigned', value: (r) => formatDateTime(r.assigned_at) },
  { label: 'Sites', value: (r) => r.sites },
  { label: 'Ready', value: (r) => r.counts.ready },
  { label: 'Not ready', value: (r) => r.counts.not_ready },
  { label: 'Pending', value: (r) => r.counts.pending },
  { label: 'To decide', value: (r) => r.counts.to_decide },
]

const hoursText = (h) => (h >= 24 ? `${Math.floor(h / 24)} d` : `${Math.max(1, Math.ceil(h))} h`)

/** "Due in 23 h" (grey; yellow under 12 h), "Late 2 h" (red), "Completed in
 * 31 h" (green; red when finished after the SLA). */
export function slaPill(batch, now = Date.now()) {
  const due = batch.due_at ? new Date(batch.due_at).getTime() : null
  if (batch.completed_at) {
    const hours = Math.round((new Date(batch.completed_at) - new Date(batch.assigned_at)) / 3600000)
    const late = due != null && new Date(batch.completed_at).getTime() > due
    return { tone: late ? 'red' : 'green', text: `Completed in ${hours} h` }
  }
  if (due == null) return { tone: 'grey', text: 'No due date' }
  const left = (due - now) / 3600000
  if (left < 0) return { tone: 'red', text: `Late ${hoursText(-left)}` }
  return { tone: left < 12 ? 'yellow' : 'grey', text: `Due in ${hoursText(left)}` }
}

function SlaPill({ batch }) {
  const { tone, text } = slaPill(batch)
  return <span className={`uw-pill is-${tone}`}>{text}</span>
}

/** The batch to open: the first with results to decide, otherwise the first. */
const firstBatch = (rows) => (rows.find((b) => b.counts.to_decide > 0) || rows[0])?.id ?? null

/**
 * Health check · Checks (UEP-31 §3): an inbox. The batches on the left with
 * their status and results; the open batch's sites on the right, where its
 * results are decided. No contractor anywhere on the page.
 */
export default function ChecksStep({ step, panelProps, onExport }) {
  const [params, setParams] = useSearchParams()
  const filter = FILTERS.some((f) => f.key === params.get('filter')) ? params.get('filter') : 'open'
  const { rows: data, error, retry } = useStepData('/hc/batches', { status: filter })
  const rows = data?.rows ?? null
  useExportRows(onExport, EXPORT_COLUMNS, rows)
  const listRef = useRef(null)
  // The result bars fill once, when the page opens.
  const [filling, setFilling] = useState(true)
  useEffect(() => {
    if (!rows || !filling) return undefined
    const t = setTimeout(() => setFilling(false), 700)
    return () => clearTimeout(t)
  }, [rows, filling])

  const asked = Number(params.get('batch')) || null
  const batchId = rows ? (rows.some((b) => b.id === asked) ? asked : firstBatch(rows)) : asked

  const update = (changes) => {
    const next = new URLSearchParams(params)
    for (const [k, v] of Object.entries(changes)) (v ? next.set(k, v) : next.delete(k))
    setParams(next, { replace: true })
  }

  const onListKey = (event) => {
    const move = { ArrowDown: 1, ArrowUp: -1 }[event.key]
    if (!move) return
    event.preventDefault()
    const items = [...listRef.current.querySelectorAll('[role="option"]')]
    const at = items.indexOf(document.activeElement)
    items[Math.min(items.length - 1, Math.max(0, (at < 0 ? 0 : at + move)))]?.focus()
  }

  return (
    <div {...panelProps} className="uw-inbox">
      <WorkListCard
        className="uw-inbox-list"
        busy={!rows && !error}
        tools={
          <div className="uw-seg" role="radiogroup" aria-label="Show batches">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                className="uw-seg-btn"
                onClick={() => update({ filter: f.key, batch: null })}
              >
                {f.label} <span className="uw-seg-count">{formatNumber(data?.counts?.[f.key] ?? 0)}</span>
              </button>
            ))}
          </div>
        }
      >
        {error && !rows ? (
          <StepError stepName={step.name} onRetry={retry} />
        ) : rows && rows.length === 0 ? (
          <EmptyStep text={filter === 'to_decide' ? 'No health-check results waiting for a decision.' : 'No batches here.'} />
        ) : (
          <div ref={listRef} className="uw-batches" role="listbox" aria-label="Batches" onKeyDown={onListKey}>
            {(rows || []).map((b) => (
              <BatchOption
                key={b.id}
                batch={b}
                selected={b.id === batchId}
                filling={filling}
                onOpen={() => update({ batch: String(b.id) })}
              />
            ))}
          </div>
        )}
      </WorkListCard>
      {batchId ? (
        <BatchDetail key={batchId} id={batchId} step={step} />
      ) : (
        <section className="uw-card" aria-label="Batch" />
      )}
    </div>
  )
}

function BatchOption({ batch: b, selected, filling, onOpen }) {
  const { ready, not_ready: notReady, pending, to_decide: toDecide } = b.counts
  const total = Math.max(1, ready + notReady + pending)
  const pct = (n) => `${(100 * n) / total}%`
  return (
    <button
      type="button"
      role="option"
      aria-selected={selected}
      tabIndex={selected ? 0 : -1}
      className={`uw-batch-row ${toDecide > 0 ? 'is-unread' : ''} ${filling ? 'is-filling' : ''}`.trim()}
      onClick={onOpen}
    >
      <span className="uw-batch-line">
        {toDecide > 0 && <i className="uw-batch-dot" aria-label="Has results to decide" role="img" />}
        <span className="uw-batch-code">{b.code}</span>
        {b.round > 1 && <Flag>Round {b.round}</Flag>}
        <SlaPill batch={b} />
      </span>
      <span className="uw-batch-bar" aria-hidden="true">
        <i className="is-ready" style={{ width: pct(ready) }} />
        <i className="is-not-ready" style={{ width: pct(notReady) }} />
        <i className="is-pending" style={{ width: pct(pending) }} />
      </span>
      <span className="uw-batch-counts">
        <span><i className="is-ready" aria-hidden="true" />{formatNumber(ready)} ready</span>
        <span><i className="is-not-ready" aria-hidden="true" />{formatNumber(notReady)} not ready</span>
        <span><i className="is-pending" aria-hidden="true" />{formatNumber(pending)} pending</span>
      </span>
    </button>
  )
}

function Result({ site: s }) {
  const tone = !s.result ? 'is-pending' : s.result === 'Ready' ? 'is-ready' : 'is-not-ready'
  const label = !s.result ? 'Pending' : s.result === 'Ready' ? 'Ready' : 'Not ready'
  return (
    <span className="uw-cell-two">
      <span className={`uw-result ${tone}`}><i aria-hidden="true" />{label}</span>
      {s.result === 'NotReady' && (s.not_normal || []).map((n) => (
        <span key={n.technology} className="uw-why"><b>{n.technology}:</b> <Fa>{n.comment}</Fa></span>
      ))}
      {s.decision && <span className="uw-sub">{s.decision}</span>}
    </span>
  )
}

/** One batch's sites and the decision bar (UEP-31 §3.2). */
function BatchDetail({ id, step }) {
  const toast = useToast()
  const { user } = useAuth()
  const { confirmAction, version } = useWork()
  const { rows: batch, error, retry } = useStepData(`/hc/batches/${id}`)
  const [selected, setSelected] = useState(() => new Set())
  const [decision, setDecision] = useState('ready')
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES)
  const [picked, setPicked] = useState(() => new Set())
  const [busy, setBusy] = useState(false)
  const [history, setHistory] = useState({ id: null, code: null })
  const readOnly = user?.role?.name === 'Viewer'

  useEffect(() => {
    api
      .get('/reference/problem-categories')
      .then((r) => r.data.length && setCategories(r.data.map((c) => c.name)))
      .catch(() => {})
  }, [])
  useEffect(() => setSelected(new Set()), [version])

  const sites = useMemo(() => batch?.site_rows ?? [], [batch])
  const undecided = useMemo(() => sites.filter((s) => s.state === 'to_decide'), [sites])
  const chosen = sites.filter((s) => selected.has(s.task_id))
  const hasNotReady = chosen.some((s) => s.result === 'NotReady')
  // A Not ready result can only go to remediation.
  const effective = hasNotReady ? 'problematic' : decision

  // UEP-24 F13: start from the categories the contractor gave, until the
  // reviewer picks for themselves.
  const [touched, setTouched] = useState(false)
  const suggested = useMemo(
    () => [...new Set(chosen.flatMap((s) => s.reason_categories || []))].filter((c) => categories.includes(c)).sort().join('|'),
    [chosen, categories],
  )
  useEffect(() => {
    if (!touched) setPicked(new Set(suggested ? suggested.split('|') : []))
  }, [suggested, touched])

  const toggle = (taskId) => {
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(taskId) ? next.delete(taskId) : next.add(taskId)
      return next
    })
  }
  const allOn = undecided.length > 0 && undecided.every((s) => selected.has(s.task_id))

  async function decide() {
    setBusy(true)
    try {
      if (effective === 'ready') {
        const { data } = await api.post('/hc/results/confirm', { task_ids: chosen.map((s) => s.task_id) })
        confirmAction({ text: `✓ ${plural(chosen.length, 'site')} confirmed ready → Drive test.`, undoUrl: `/hc/results/confirm/${data.batch_id}/undo` })
      } else {
        await api.post('/hc/results/review-bulk', {
          task_ids: chosen.map((s) => s.task_id), problem_categories: [...picked],
        })
        confirmAction({ text: `✓ ${plural(chosen.length, 'site')} sent to remediation (${[...picked].join(', ')}).` })
      }
      setPicked(new Set())
      setTouched(false)
      setDecision('ready')
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
      retry()
    } finally {
      setBusy(false)
    }
  }

  const canGo = chosen.length > 0 && !busy && (effective === 'ready' || picked.size > 0)

  return (
    <WorkListCard
      className="uw-inbox-open"
      aria-label={batch ? `Batch ${batch.code}` : 'Batch'}
      busy={!batch && !error}
      tools={
        batch && (
          <span className="uw-batch-head">
            <h2>{batch.code}</h2>
            <span>Assigned {formatDateTime(batch.assigned_at)}{batch.assigned_by ? ` by ${batch.assigned_by}` : ''}</span>
          </span>
        )
      }
      foot={
        !readOnly && undecided.length > 0 ? (
          <div className={`uw-decide ${chosen.length ? 'is-active' : ''}`.trim()}>
            <span className="uw-decide-lead"><b>{plural(chosen.length, 'site')} selected</b></span>
            <div className="uw-seg" role="radiogroup" aria-label="Decision">
              <button
                type="button" role="radio" className="uw-seg-btn"
                aria-checked={effective === 'ready'} disabled={hasNotReady}
                onClick={() => setDecision('ready')}
              >
                Ready → Drive test
              </button>
              <button
                type="button" role="radio" className="uw-seg-btn"
                aria-checked={effective === 'problematic'}
                onClick={() => setDecision('problematic')}
              >
                Problematic → Remediation
              </button>
            </div>
            {effective === 'problematic' && (
              <div className="uw-route-chips" role="group" aria-label="Owning teams">
                {categories.map((c) => (
                  <button
                    key={c} type="button" className="uw-pick" aria-pressed={picked.has(c)}
                    onClick={() => { setTouched(true); setPicked((p) => { const n = new Set(p); n.has(c) ? n.delete(c) : n.add(c); return n }) }}
                  >
                    {c}
                  </button>
                ))}
              </div>
            )}
            <button
              type="button"
              className={`uw-btn ${effective === 'ready' ? 'uw-btn-primary' : 'uw-btn-danger-solid'}`}
              disabled={!canGo}
              aria-busy={busy || undefined}
              onClick={decide}
            >
              {effective === 'ready' ? 'Confirm ready' : 'Send to remediation'}
            </button>
          </div>
        ) : null
      }
    >
      {error && !batch ? (
        <StepError stepName={step.name} onRetry={retry} />
      ) : (
        <table className="uw-table uw-table-wrap" aria-label={batch ? `Sites in ${batch.code}` : 'Sites'}>
          <colgroup>
            <col style={{ width: 'var(--uep-col-check)' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '17%' }} />
            <col />
            <col style={{ width: '17%' }} />
          </colgroup>
          <thead>
            <tr>
              <th className="uw-col-check" scope="col">
                {!readOnly && (
                  <span className="uw-check-hit">
                    <input
                      type="checkbox"
                      aria-label="Select every undecided result"
                      checked={allOn}
                      disabled={undecided.length === 0}
                      onChange={() => setSelected(allOn ? new Set() : new Set(undecided.map((s) => s.task_id)))}
                    />
                  </span>
                )}
              </th>
              <th scope="col">Site ID</th>
              <th scope="col">Villages</th>
              <th scope="col">Province</th>
              <th scope="col">Result</th>
              <th scope="col">Sent</th>
            </tr>
          </thead>
          {!batch ? (
            <SkeletonRows columns={6} />
          ) : (
            <tbody>
              {sites.map((s, i) => {
                const on = selected.has(s.task_id)
                const pickable = !readOnly && s.state === 'to_decide'
                return (
                  <tr
                    key={s.task_id}
                    className={`${pickable ? 'is-selectable' : ''} ${on ? 'is-selected' : ''}`.trim() || undefined}
                    style={i < 14 ? { '--row-i': i } : undefined}
                    onClick={(e) => pickable && !e.target.closest('button, input, label') && toggle(s.task_id)}
                  >
                    <td className="uw-col-check">
                      {pickable && (
                        <label className="uw-check-hit">
                          <input type="checkbox" checked={on} aria-label={`Select ${s.site_code}`} onChange={() => toggle(s.task_id)} />
                        </label>
                      )}
                    </td>
                    <td>
                      <SiteIdButton siteCode={s.site_code} onClick={() => setHistory({ id: s.work_item_id, code: s.site_code })} />
                    </td>
                    <td><VillageCount villages={s.villages} /></td>
                    <td><Fa>{s.province}</Fa></td>
                    <td className="uw-wrap"><Result site={s} /></td>
                    <td>
                      {s.submitted_at ? (
                        <span className={s.late ? 'uw-late' : undefined}>
                          {formatDateTime(s.submitted_at)}{s.late && <span className="uw-sr-only"> late</span>}
                        </span>
                      ) : (
                        <span className="uw-none">—</span>
                      )}
                    </td>
                  </tr>
                )
              })}
            </tbody>
          )}
        </table>
      )}
      <SiteHistoryDrawer workItemId={history.id} siteCode={history.code} onClose={() => setHistory({ id: null, code: null })} />
    </WorkListCard>
  )
}
