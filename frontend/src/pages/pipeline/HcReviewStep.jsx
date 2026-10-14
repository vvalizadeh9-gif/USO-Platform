import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import api from '../../api/client'
import Icon from '../../components/Icon'
import SiteHistoryDrawer from '../../components/SiteHistoryDrawer'
import { ConfirmDialog } from '../../components/ui'
import {
  EmptyStep, Fa, SearchBox, SiteIdButton, SkeletonRows, StepError, TechChips, WaitingCell, WorkListCard,
} from '../../components/work/parts'
import { useWork } from '../../components/work/WorkContext'
import { useToast } from '../../context/ToastContext'
import useStepData, { useExportRows } from './useStepData'
import { formatNumber } from '../../lib/numbers'

// Fallback only: categories are admin-extendable, so the live list comes from
// /reference/problem-categories; this keeps the screen usable if that fails.
const FALLBACK_CATEGORIES = ['Managed Service', 'CPG Project', 'NWG RND', 'Huawei Cleanup', 'Temp Power']

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`

const EXPORT_COLUMNS = [
  { label: 'Site ID', value: (r) => r.site_code },
  { label: 'Type', value: (r) => r.site_type },
  { label: 'Round', value: (r) => r.round_no },
  { label: 'Result', value: (r) => (r.overall_result === 'Ready' ? 'Ready' : 'Not ready') },
  { label: 'Contractor', value: (r) => r.contractor_name },
  { label: 'Waiting (days)', value: (r) => r.days_waiting },
]

/**
 * Step 3 (UEP-06 §5.1): health-check results awaiting a decision. A Ready
 * site is confirmed (one click, undoable); a Not ready one is routed to the
 * teams that own its problems, behind the "Mark this site Problematic?"
 * confirmation, because routing is what flags it Problematic everywhere else.
 */
export default function HcReviewStep({ step, figures, panelProps, onExport, highlightTaskId }) {
  const toast = useToast()
  const { confirmAction } = useWork()
  const { rows, error, retry } = useStepData('/hc/results', { reviewed: false })
  const [query, setQuery] = useState('')
  const [expanded, setExpanded] = useState(null) // null until the first load opens the failed rows
  const [categories, setCategories] = useState(FALLBACK_CATEGORIES)
  const [pendingRoute, setPendingRoute] = useState(null) // { row, categories } | null
  const [busy, setBusy] = useState(null) // a task id, 'all', or 'route'
  const [history, setHistory] = useState({ id: null, code: null })
  const highlightRef = useRef(null)
  const slaDays = figures?.sla_days

  useEffect(() => {
    api
      .get('/reference/problem-categories')
      .then((r) => r.data.length && setCategories(r.data.map((c) => c.name)))
      .catch(() => {})
  }, [])

  // A reviewer deciding whether a site is problematic should not have to
  // click to find out why it failed: failed rows open by default.
  useEffect(() => {
    if (rows && expanded === null) {
      setExpanded(new Set(rows.filter((r) => r.overall_result === 'NotReady').map((r) => r.task_id)))
    }
  }, [rows, expanded])

  useEffect(() => {
    if (highlightTaskId && highlightRef.current) highlightRef.current.scrollIntoView({ block: 'center' })
  }, [highlightTaskId, rows])

  const shown = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    return rows.filter((r) => !q || (r.site_code || '').toLowerCase().includes(q))
  }, [rows, query])
  const ready = shown.filter((r) => r.overall_result === 'Ready')
  useExportRows(onExport, EXPORT_COLUMNS, rows ? shown : null)

  async function confirm(list, key) {
    setBusy(key)
    try {
      const { data } = await api.post('/hc/results/confirm', { task_ids: list.map((r) => r.task_id) })
      const text =
        list.length === 1
          ? `✓ ${list[0].site_code} confirmed ready.`
          : `✓ ${plural(list.length, 'site')} confirmed ready.`
      confirmAction({ text, undoUrl: `/hc/results/confirm/${data.batch_id}/undo` })
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
      if (err.response?.status === 409) retry()
    } finally {
      setBusy(null)
    }
  }

  async function route() {
    if (!pendingRoute) return
    const { row, categories: chosen } = pendingRoute
    setBusy('route')
    try {
      await api.post(`/hc/tasks/${row.task_id}/review`, { problem_categories: chosen })
      setPendingRoute(null)
      confirmAction({
        text: `✓ ${row.site_code} routed to ${chosen.join(' and ')}. It comes back for re-check once every fix is closed.`,
      })
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(null)
    }
  }

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  return (
    <WorkListCard
      {...panelProps}
      busy={!rows && !error}
      tools={
        <>
          <SearchBox value={query} onChange={setQuery} />
          <button
            type="button"
            className="uw-btn uw-btn-primary"
            disabled={ready.length === 0 || busy != null}
            aria-busy={busy === 'all' || undefined}
            onClick={() => confirm(ready, 'all')}
          >
            Confirm all {formatNumber(ready.length)} Ready
          </button>
        </>
      }
      description="Oldest result first · waiting counts since the result came in"
    >
      {error && !rows ? (
        <StepError stepName={step.name} onRetry={retry} />
      ) : rows && rows.length === 0 ? (
        <EmptyStep stepName={step.name} />
      ) : (
        <table className="uw-table" aria-label={step.name}>
          <colgroup>
            <col style={{ width: 'var(--uep-col-check)' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '9%' }} />
            <col style={{ width: '6%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '10%' }} />
            <col />
            <col style={{ width: '12%' }} />
            <col style={{ width: '13%' }} />
          </colgroup>
          <thead>
            <tr>
              <th scope="col"><span className="uw-sr-only">Details</span></th>
              <th scope="col">Site ID</th>
              <th scope="col">Type</th>
              <th scope="col">Round</th>
              <th scope="col">Requested tech</th>
              <th scope="col">Result</th>
              <th scope="col">Decision</th>
              <th scope="col">Contractor</th>
              <th scope="col">Waiting · SLA {slaDays ?? '–'} d</th>
            </tr>
          </thead>
          {!rows ? (
            <SkeletonRows columns={9} />
          ) : (
            <tbody>
              {[...shown].reverse().map((r) => {
                const open = expanded?.has(r.task_id)
                const detailId = `hc-detail-${r.task_id}`
                const highlighted = highlightTaskId != null && String(r.task_id) === String(highlightTaskId)
                return (
                  <Fragment key={r.task_id}>
                    <tr ref={highlighted ? highlightRef : null} className={highlighted ? 'is-highlighted' : undefined}>
                      <td>
                        {(r.technologies || []).length > 0 && (
                          <button
                            type="button"
                            className="uw-icon-btn"
                            aria-expanded={open}
                            aria-controls={detailId}
                            aria-label={`${open ? 'Hide' : 'Show'} the per-technology results of ${r.site_code}`}
                            onClick={() => toggle(r.task_id)}
                          >
                            <Icon name={open ? 'chevron--down' : 'chevron--right'} size={16} />
                          </button>
                        )}
                      </td>
                      <td>
                        <SiteIdButton siteCode={r.site_code} onClick={() => setHistory({ id: r.work_item_id, code: r.site_code })} />
                      </td>
                      <td>{r.site_type || '—'}</td>
                      <td className="uw-num">{r.round_no}</td>
                      <td><TechChips techs={r.requested_technologies} /></td>
                      <td>
                        <span className={`uw-result ${r.overall_result === 'Ready' ? 'is-ready' : 'is-not-ready'}`}>
                          <i aria-hidden="true" />
                          {r.overall_result === 'Ready' ? 'Ready' : 'Not ready'}
                        </span>
                      </td>
                      <td>
                        {r.overall_result === 'Ready' ? (
                          <button
                            type="button"
                            className="uw-btn uw-btn-sm"
                            disabled={busy != null}
                            aria-busy={busy === r.task_id || undefined}
                            onClick={() => confirm([r], r.task_id)}
                          >
                            <Icon name="checkmark" size={16} /> Confirm ready
                          </button>
                        ) : (
                          <CategoryPicker
                            row={r}
                            categories={categories}
                            disabled={busy != null}
                            onRoute={(chosen) => setPendingRoute({ row: r, categories: chosen })}
                          />
                        )}
                      </td>
                      <td><Fa>{r.contractor_name}</Fa></td>
                      <td><WaitingCell days={r.days_waiting} slaDays={slaDays} /></td>
                    </tr>
                    {open && (
                      <tr id={detailId} className="uw-detail-row">
                        <td />
                        <td colSpan={8}><TechBreakdown techs={r.technologies} /></td>
                      </tr>
                    )}
                  </Fragment>
                )
              })}
            </tbody>
          )}
        </table>
      )}

      <ConfirmDialog
        open={pendingRoute !== null}
        title="Mark this site Problematic?"
        message={
          pendingRoute
            ? `This opens a fix for ${pendingRoute.categories.join(' and ')} and flags the site as Problematic — it drops out of the normal drive-test pipeline until every fix is closed, at which point it returns for re-check automatically. This can be changed again later if needed.`
            : ''
        }
        confirmLabel="Yes, mark Problematic"
        danger
        busy={busy === 'route'}
        onConfirm={route}
        onCancel={() => setPendingRoute(null)}
      />
      <SiteHistoryDrawer workItemId={history.id} siteCode={history.code} onClose={() => setHistory({ id: null, code: null })} />
    </WorkListCard>
  )
}

/** A Not ready site's problem categories as pill toggles, then Route. A site
 * can be blocked by more than one thing, and each category opens its own fix. */
function CategoryPicker({ row, categories, onRoute, disabled }) {
  const [picked, setPicked] = useState(() => new Set(row.problem_categories || []))
  const toggle = (c) =>
    setPicked((prev) => {
      const next = new Set(prev)
      next.has(c) ? next.delete(c) : next.add(c)
      return next
    })
  return (
    <div className="uw-route">
      <div className="uw-route-chips" role="group" aria-label={`Problem categories for ${row.site_code}`}>
        {categories.map((c) => (
          <button key={c} type="button" className="uw-pick" aria-pressed={picked.has(c)} onClick={() => toggle(c)}>
            {c}
          </button>
        ))}
      </div>
      <button
        type="button"
        className="uw-btn uw-btn-primary uw-btn-sm"
        disabled={picked.size === 0 || disabled}
        onClick={() => onRoute([...picked])}
      >
        Route
      </button>
    </div>
  )
}

function TechBreakdown({ techs }) {
  return (
    <dl className="uw-breakdown">
      {techs.map((t) => (
        <div key={t.technology}>
          <dt>{t.technology}</dt>
          <dd className={t.result === 'Normal' ? '' : 'is-not-normal'}>{t.result === 'Normal' ? 'Normal' : 'Not normal'}</dd>
          {t.result !== 'Normal' && <dd className="uw-breakdown-note"><Fa>{t.comment || 'No comment provided'}</Fa></dd>}
        </div>
      ))}
    </dl>
  )
}
