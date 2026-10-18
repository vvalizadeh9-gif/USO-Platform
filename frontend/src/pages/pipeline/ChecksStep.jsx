import { useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import Icon from '../../components/Icon'
import SiteHistoryDrawer from '../../components/SiteHistoryDrawer'
import {
  EmptyStep, Fa, Flag, SearchBox, SiteIdButton, SkeletonRows, StepError, WorkListCard,
} from '../../components/work/parts'
import { useWork } from '../../components/work/WorkContext'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { formatDateTime } from '../../lib/dates'
import { formatNumber } from '../../lib/numbers'
import Select from '../../components/Select'
import useStepData, { useExportRows } from './useStepData'

// Fallback only: categories are admin-extendable, so the live list comes from
// /reference/problem-categories; this keeps the screen usable if that fails.
const FALLBACK_CATEGORIES = ['Managed Service', 'CPG Project', 'NWG RND', 'Huawei Cleanup', 'Temp Power']

const FILTERS = [
  { key: 'open', label: 'Open' },
  { key: 'to_decide', label: 'To decide' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'completed', label: 'Completed' },
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

/** "Due in 21 h" (grey; yellow under 12 h), "Overdue 1 d" (red), "Completed
 * in 31 h" (green; red when late). */
function slaPill(batch, now = Date.now()) {
  const due = batch.due_at ? new Date(batch.due_at).getTime() : null
  if (batch.completed_at) {
    const hours = Math.round((new Date(batch.completed_at) - new Date(batch.assigned_at)) / 3600000)
    const late = due != null && new Date(batch.completed_at).getTime() > due
    return { tone: late ? 'red' : 'green', text: `Completed in ${hours} h` }
  }
  if (due == null) return { tone: 'grey', text: 'No due date' }
  const left = (due - now) / 3600000
  if (left < 0) {
    const over = -left
    return { tone: 'red', text: over >= 24 ? `Overdue ${Math.floor(over / 24)} d` : `Overdue ${Math.ceil(over)} h` }
  }
  const text = left >= 24 ? `Due in ${Math.floor(left / 24)} d` : `Due in ${Math.ceil(left)} h`
  return { tone: left < 12 ? 'yellow' : 'grey', text }
}

function SlaPill({ batch }) {
  const { tone, text } = slaPill(batch)
  return <span className={`uw-pill is-${tone}`}>{text}</span>
}

function ResultBar({ counts }) {
  const total = Math.max(1, counts.ready + counts.not_ready + counts.pending)
  const pct = (n) => `${(100 * n) / total}%`
  return (
    <span className="uw-result-cell">
      <span className="uw-result-bar" aria-hidden="true">
        <i className="is-ready" style={{ width: pct(counts.ready) }} />
        <i className="is-not-ready" style={{ width: pct(counts.not_ready) }} />
        <i className="is-pending" style={{ width: pct(counts.pending) }} />
      </span>
      <span className="uw-result-text">
        {formatNumber(counts.ready)} ready · {formatNumber(counts.not_ready)} not ready · {formatNumber(counts.pending)} pending
      </span>
    </span>
  )
}

/**
 * Health check · Checks (UEP-14 §3.4): In check and Results merged. The
 * list has one row per assignment batch; a row opens that batch's sites on
 * the same page, where its results are decided. Read-only for contractor
 * work: nothing is assigned from here.
 */
export default function ChecksStep({ step, panelProps, onExport }) {
  const [params, setParams] = useSearchParams()
  const filter = params.get('filter') || 'open'
  const batchId = params.get('batch')
  const [contractor, setContractor] = useState('')
  const [query, setQuery] = useState('')
  const listParams = { status: filter, ...(contractor ? { contractor_id: contractor } : {}), ...(query.trim() ? { q: query.trim() } : {}) }
  const { rows: data, error, retry } = useStepData('/hc/batches', listParams)
  const [contractors, setContractors] = useState([])

  useEffect(() => {
    api.get('/hc/contractors/load').then((r) => setContractors(r.data)).catch(() => {})
  }, [])

  const rows = data?.rows ?? null
  useExportRows(onExport, EXPORT_COLUMNS, rows)

  const setParam = (key, value) => {
    const next = new URLSearchParams(params)
    if (value) next.set(key, value)
    else next.delete(key)
    setParams(next, { replace: key !== 'batch' })
  }

  if (batchId) {
    return <BatchDetail id={batchId} step={step} panelProps={panelProps} onBack={() => setParam('batch', null)} />
  }

  return (
    <WorkListCard
      {...panelProps}
      stage="hc"
      chip="Step 2 · Assignment batches and their results"
      busy={!rows && !error}
      tools={
        <>
          <div className="uw-seg" role="radiogroup" aria-label="Show batches">
            {FILTERS.map((f) => (
              <button
                key={f.key}
                type="button"
                role="radio"
                aria-checked={filter === f.key}
                className="uw-seg-btn"
                onClick={() => setParam('filter', f.key)}
              >
                {f.label} <span className="uw-seg-count">{formatNumber(data?.counts?.[f.key] ?? 0)}</span>
              </button>
            ))}
          </div>
          <Select
            className="uw-select"
            aria-label="Contractor"
            value={contractor}
            onChange={(e) => setContractor(e.target.value)}
            options={[{ value: '', label: 'All contractors' }, ...contractors.map((c) => ({ value: String(c.contractor_id), label: c.name }))]}
          />
          <SearchBox value={query} onChange={setQuery} label="Search batch or site ID" placeholder="Batch or site ID…" />
        </>
      }
    >
      {error && !rows ? (
        <StepError stepName={step.name} onRetry={retry} />
      ) : rows && rows.length === 0 ? (
        <EmptyStep text={filter === 'to_decide' ? 'No health-check results waiting for a decision.' : 'No batches here.'} />
      ) : (
        <table className="uw-table" aria-label="Assignment batches">
          <colgroup>
            <col style={{ width: '17%' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '16%' }} />
            <col style={{ width: '14%' }} />
            <col />
            <col style={{ width: '11%' }} />
            <col style={{ width: 'var(--uep-col-icon)' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col">Batch</th>
              <th scope="col">Contractor</th>
              <th scope="col">Assigned</th>
              <th scope="col">SLA</th>
              <th scope="col">Result</th>
              <th scope="col">To decide</th>
              <th scope="col"><span className="uw-sr-only">Open</span></th>
            </tr>
          </thead>
          {!rows ? (
            <SkeletonRows columns={7} />
          ) : (
            <tbody>
              {rows.map((b, i) => (
                <tr
                  key={b.id}
                  className="is-selectable is-row-link"
                  style={i < 14 ? { '--row-i': i } : undefined}
                  tabIndex={0}
                  aria-label={`Batch ${b.code}, ${b.contractor || 'no contractor'}, ${plural(b.counts.to_decide, 'result')} to decide`}
                  onClick={() => setParam('batch', String(b.id))}
                  onKeyDown={(e) => e.key === 'Enter' && setParam('batch', String(b.id))}
                >
                  <td>
                    <span className="uw-site">
                      <b className="uw-batch">{b.code}</b>
                      <span className="uw-muted">{plural(b.sites, 'site')}</span>
                      {b.round > 1 && <Flag>Round {b.round}</Flag>}
                    </span>
                  </td>
                  <td><Fa>{b.contractor}</Fa></td>
                  <td>
                    <span className="uw-two-line">
                      <span>{formatDateTime(b.assigned_at)}</span>
                      {b.assigned_by && <span className="uw-muted">by {b.assigned_by}</span>}
                    </span>
                  </td>
                  <td><SlaPill batch={b} /></td>
                  <td><ResultBar counts={b.counts} /></td>
                  <td>
                    {b.counts.to_decide > 0 ? (
                      <span className="uw-pill is-accent">{formatNumber(b.counts.to_decide)} to decide</span>
                    ) : (
                      <span className="uw-none">—</span>
                    )}
                  </td>
                  <td className="uw-col-icon"><span className="uw-chevron"><Icon name="chevron--right" size={16} /></span></td>
                </tr>
              ))}
            </tbody>
          )}
        </table>
      )}
    </WorkListCard>
  )
}

/** One batch's sites and the decision bar (UEP-14 §3.4, batch detail). */
function BatchDetail({ id, step, panelProps, onBack }) {
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
        for (const s of chosen) {
          await api.post(`/hc/tasks/${s.task_id}/review`, { problem_categories: [...picked] })
        }
        confirmAction({ text: `✓ ${plural(chosen.length, 'site')} sent to remediation (${[...picked].join(', ')}).` })
      }
      setPicked(new Set())
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
      {...panelProps}
      stage="hc"
      chip="Step 2 · Assignment batches and their results"
      busy={!batch && !error}
      tools={
        <>
          <button type="button" className="uw-btn uw-btn-sm" onClick={onBack}>
            <Icon name="arrow--left" size={16} /> All batches
          </button>
          {batch && (
            <span className="uw-batch-head">
              <b className="uw-batch">{batch.code}</b>
              <SlaPill batch={batch} />
              <Fa>{batch.contractor}</Fa>
              <span className="uw-muted">assigned {formatDateTime(batch.assigned_at)}{batch.assigned_by ? ` by ${batch.assigned_by}` : ''} · due {formatDateTime(batch.due_at)}</span>
              <span className="uw-muted">
                {formatNumber(batch.counts.ready)} ready · {formatNumber(batch.counts.not_ready)} not ready · {formatNumber(batch.counts.pending)} pending
              </span>
            </span>
          )}
        </>
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
                    onClick={() => setPicked((p) => { const n = new Set(p); n.has(c) ? n.delete(c) : n.add(c); return n })}
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
              {effective === 'ready' ? `Confirm ${plural(chosen.length, 'site')} ready` : `Send ${plural(chosen.length, 'site')} to remediation`}
            </button>
          </div>
        ) : null
      }
    >
      {error && !batch ? (
        <StepError stepName={step.name} onRetry={retry} />
      ) : (
        <table className="uw-table" aria-label={batch ? `Batch ${batch.code}` : 'Batch'}>
          <colgroup>
            <col style={{ width: 'var(--uep-col-check)' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '20%' }} />
            <col style={{ width: '13%' }} />
            <col />
            <col style={{ width: '18%' }} />
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
              <th scope="col">Submitted</th>
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
                      <span className="uw-site">
                        <SiteIdButton siteCode={s.site_code} onClick={() => setHistory({ id: s.work_item_id, code: s.site_code })} />
                        {s.round > 1 && <Flag>Round {s.round}</Flag>}
                      </span>
                    </td>
                    <td>
                      <Fa>{s.villages[0]?.name}</Fa>
                      {s.villages.length > 1 && <span className="uw-muted"> +{formatNumber(s.villages.length - 1)}</span>}
                    </td>
                    <td><Fa>{s.province}</Fa></td>
                    <td>
                      <span className="uw-two-line">
                        {s.result ? (
                          <span className={`uw-result ${s.result === 'Ready' ? 'is-ready' : 'is-not-ready'}`}>
                            <i aria-hidden="true" />{s.result === 'Ready' ? 'Ready' : 'Not ready'}
                          </span>
                        ) : (
                          <span className="uw-pill is-yellow">Pending</span>
                        )}
                        {s.decision && <span className="uw-muted">{s.decision}</span>}
                      </span>
                    </td>
                    <td>
                      {s.submitted_at ? (
                        <span className={s.late ? 'uw-late' : undefined}>
                          {formatDateTime(s.submitted_at)} · {formatNumber(Math.round(s.hours_taken))} h
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
