import { Fragment, useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import Icon from '../../components/Icon'
import SiteHistoryDrawer from '../../components/SiteHistoryDrawer'
import {
  EmptyStep, Fa, Flag, SearchBox, SiteIdButton, SkeletonRows, StepError, TechChips, WorkListCard,
} from '../../components/work/parts'
import { useWork } from '../../components/work/WorkContext'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { formatDateTime } from '../../lib/dates'
import { formatNumber } from '../../lib/numbers'
import Select from '../../components/Select'
import useStepData, { useExportRows } from './useStepData'

const TABS = [
  { key: 'review', label: 'To review', empty: 'No drive tests waiting for review.' },
  { key: 'with', label: 'With contractors', empty: 'No drive tests with contractors.' },
  { key: 'reviewed', label: 'Reviewed', empty: 'No reviewed drive tests yet.' },
]

/** Why a drive test goes back. There is no DT category table yet; these are
 * the reasons reviewers use. */
const SEND_BACK_REASONS = ['Route incomplete', 'Technology missing', 'Report quality', 'Wrong site', 'Measurements out of range']

const plural = (n, one) => `${formatNumber(n)} ${n === 1 ? one : `${one}s`}`

const EXPORT_COLUMNS = [
  { label: 'Site ID', value: (r) => r.site_code },
  { label: 'Round', value: (r) => r.round },
  { label: 'Province', value: (r) => r.province },
  { label: 'Contractor', value: (r) => r.contractor },
  { label: 'Batch', value: (r) => r.batch },
  { label: 'Aging (days)', value: (r) => r.aging_days },
  { label: 'Outcome', value: (r) => r.outcome },
]

/** Days, or hours under a day, and a bar against the SLA; red over it. */
function AgingCell({ days, slaDays }) {
  if (days == null) return <span className="uw-none">—</span>
  const late = slaDays != null && days > slaDays
  const text = days < 1 ? `${Math.max(1, Math.round(days * 24))} h` : `${formatNumber(Math.floor(days))} d`
  const pct = slaDays ? Math.min(100, (100 * days) / slaDays) : 0
  return (
    <span className={`uw-wait ${late ? 'is-late' : ''}`.trim()}>
      <span className="uw-wait-days">{text}{late && <span className="uw-sr-only"> late</span>}</span>
      <span className="uw-wait-bar" aria-hidden="true"><i className={late ? 'uw-wait-beyond' : 'uw-wait-within'} style={{ width: `${pct}%` }} /></span>
    </span>
  )
}

/** A header that sorts its column, with aria-sort and an accent arrow. */
function SortHeader({ id, label, sort, onSort }) {
  const active = sort.key === id
  return (
    <th scope="col" aria-sort={active ? (sort.dir === 'asc' ? 'ascending' : 'descending') : 'none'}>
      <button type="button" className={`uw-sort ${active ? 'is-active' : ''}`.trim()} onClick={() => onSort(id)}>
        {label}
        {active && <Icon name={sort.dir === 'asc' ? 'arrow--up' : 'arrow--down'} size={16} />}
      </button>
    </th>
  )
}

/**
 * Drive test · Tests (UEP-14 §3.5): site-based, no batches -- drive tests
 * finish site by site over weeks. Three tabs; Accept marks DT done, Send back
 * returns the site to the same contractor as the next round with a new clock.
 */
export default function TestsStep({ step, panelProps, onExport }) {
  const [params, setParams] = useSearchParams()
  const tab = TABS.some((t) => t.key === params.get('view')) ? params.get('view') : 'review'
  const toast = useToast()
  const { user } = useAuth()
  const { confirmAction, version } = useWork()
  const [contractor, setContractor] = useState('')
  const [query, setQuery] = useState('')
  const [sort, setSort] = useState({ key: 'aging', dir: 'desc' })
  const [expanded, setExpanded] = useState(() => new Set())
  const [selected, setSelected] = useState(() => new Set())
  const [decision, setDecision] = useState('accept')
  const [reason, setReason] = useState('')
  const [checkedOutside, setCheckedOutside] = useState(false)
  const [busy, setBusy] = useState(false)
  const [contractors, setContractors] = useState([])
  const [history, setHistory] = useState({ id: null, code: null })
  const readOnly = user?.role?.name === 'Viewer'

  const { rows: data, error, retry } = useStepData('/drive-test/tests', {
    tab, sort: sort.key, dir: sort.dir,
    ...(contractor ? { contractor_id: contractor } : {}),
    ...(query.trim() ? { q: query.trim() } : {}),
  })
  const rows = data?.rows ?? null
  useExportRows(onExport, EXPORT_COLUMNS, rows)

  useEffect(() => {
    api.get('/drive-test/contractors/load').then((r) => setContractors(r.data)).catch(() => {})
  }, [])
  useEffect(() => setSelected(new Set()), [tab, version])

  const setTab = (key) => {
    const next = new URLSearchParams(params)
    next.set('view', key)
    setParams(next, { replace: true })
  }
  const onSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'aging' ? 'desc' : 'asc' }))
  const toggle = (set, id) => set((prev) => {
    const next = new Set(prev)
    next.has(id) ? next.delete(id) : next.add(id)
    return next
  })

  const reviewing = tab === 'review' && !readOnly
  const chosen = (rows || []).filter((r) => selected.has(r.work_item_id))
  const noFiles = chosen.some((r) => r.evidence_count === 0)
  const canGo = chosen.length > 0 && !busy && (decision === 'accept' ? !noFiles || checkedOutside : Boolean(reason))

  async function decide() {
    setBusy(true)
    try {
      for (const r of chosen) {
        await api.post(`/drive-tests/${r.drive_test_id}/coordinator-review`, {
          decision: decision === 'accept' ? 'Approved' : 'Returned',
          comment: decision === 'accept' ? null : reason,
          ...(decision === 'accept' && r.evidence_count === 0 ? { report_checked_outside: true } : {}),
        })
      }
      confirmAction({
        text: decision === 'accept'
          ? `✓ ${plural(chosen.length, 'site')} accepted. They now count as DT done.`
          : `✓ ${plural(chosen.length, 'site')} sent back to the same contractor as the next round.`,
      })
      setReason('')
      setCheckedOutside(false)
      setDecision('accept')
    } catch (err) {
      toast.error('Could not save', err.response?.data?.detail || 'Please try again.')
      retry()
    } finally {
      setBusy(false)
    }
  }

  const cols = (reviewing ? 1 : 0) + 7 + (tab === 'reviewed' ? 1 : 0)
  const allOn = rows?.length > 0 && rows.every((r) => selected.has(r.work_item_id))

  return (
    <WorkListCard
      {...panelProps}
      stage="dt"
      chip="Step 4 · Drive tests, site by site"
      busy={!rows && !error}
      tools={
        <>
          <div className="uw-seg" role="tablist" aria-label="Tests">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="uw-seg-btn" onClick={() => setTab(t.key)}>
                {t.label} <span className="uw-seg-count">{formatNumber(data?.counts?.[t.key] ?? 0)}</span>
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
          <SearchBox value={query} onChange={setQuery} label="Search site, village name or ID, batch code" placeholder="Site, village, batch…" />
        </>
      }
      foot={
        reviewing && rows?.length ? (
          <div className={`uw-decide ${chosen.length ? 'is-active' : ''}`.trim()}>
            <span className="uw-decide-lead"><b>{plural(chosen.length, 'site')} selected</b></span>
            <div className="uw-seg" role="radiogroup" aria-label="Decision">
              <button type="button" role="radio" className="uw-seg-btn" aria-checked={decision === 'accept'} onClick={() => setDecision('accept')}>
                Accept → DT done
              </button>
              <button type="button" role="radio" className="uw-seg-btn" aria-checked={decision === 'back'} onClick={() => setDecision('back')}>
                Send back → In test
              </button>
            </div>
            {decision === 'back' ? (
              <div className="uw-route-chips" role="radiogroup" aria-label="Reason">
                {SEND_BACK_REASONS.map((r) => (
                  <button key={r} type="button" role="radio" className="uw-pick" aria-checked={reason === r} onClick={() => setReason(r)}>
                    {r}
                  </button>
                ))}
              </div>
            ) : noFiles ? (
              <label className="uw-check-line">
                <input type="checkbox" checked={checkedOutside} onChange={(e) => setCheckedOutside(e.target.checked)} />
                Some have no report: I checked them outside UEP
              </label>
            ) : null}
            <button
              type="button"
              className={`uw-btn ${decision === 'accept' ? 'uw-btn-primary' : 'uw-btn-danger-solid'}`}
              disabled={!canGo}
              aria-busy={busy || undefined}
              onClick={decide}
            >
              {decision === 'accept' ? `Accept ${plural(chosen.length, 'site')}` : `Send back ${plural(chosen.length, 'site')}`}
            </button>
          </div>
        ) : null
      }
    >
      {error && !rows ? (
        <StepError stepName={step.name} onRetry={retry} />
      ) : rows && rows.length === 0 ? (
        <EmptyStep text={TABS.find((t) => t.key === tab).empty} />
      ) : (
        <table className="uw-table" aria-label={TABS.find((t) => t.key === tab).label}>
          <colgroup>
            {reviewing && <col style={{ width: 'var(--uep-col-check)' }} />}
            <col style={{ width: 'var(--uep-col-icon)' }} />
            <col style={{ width: '15%' }} />
            <col style={{ width: '18%' }} />
            <col style={{ width: '12%' }} />
            <col style={{ width: '14%' }} />
            <col style={{ width: '10%' }} />
            <col />
            {tab === 'reviewed' && <col style={{ width: '11%' }} />}
          </colgroup>
          <thead>
            <tr>
              {reviewing && (
                <th className="uw-col-check" scope="col">
                  <span className="uw-check-hit">
                    <input
                      type="checkbox"
                      aria-label="Select every site shown"
                      checked={Boolean(allOn)}
                      disabled={!rows?.length}
                      onChange={() => setSelected(allOn ? new Set() : new Set(rows.map((r) => r.work_item_id)))}
                    />
                  </span>
                </th>
              )}
              <th scope="col"><span className="uw-sr-only">Details</span></th>
              <SortHeader id="site" label="Site ID" sort={sort} onSort={onSort} />
              <th scope="col">Villages</th>
              <SortHeader id="province" label="Province" sort={sort} onSort={onSort} />
              <SortHeader id="contractor" label="Contractor" sort={sort} onSort={onSort} />
              <th scope="col">Batch</th>
              <SortHeader id="aging" label={tab === 'with' ? `Aging · SLA ${rows?.[0]?.sla_days ?? 14} d` : 'Aging'} sort={sort} onSort={onSort} />
              {tab === 'reviewed' && <th scope="col">Outcome</th>}
            </tr>
          </thead>
          {!rows ? (
            <SkeletonRows columns={cols} />
          ) : (
            <tbody>
              {rows.map((r, i) => {
                const key = `${r.work_item_id}-${r.outcome || ''}`
                const open = expanded.has(key)
                const on = selected.has(r.work_item_id)
                return (
                  <Fragment key={key}>
                    <tr
                      className={`${reviewing ? 'is-selectable' : ''} ${on ? 'is-selected' : ''}`.trim() || undefined}
                      style={i < 14 ? { '--row-i': i } : undefined}
                      onClick={(e) => reviewing && !e.target.closest('button, input, label') && toggle(setSelected, r.work_item_id)}
                    >
                      {reviewing && (
                        <td className="uw-col-check">
                          <label className="uw-check-hit">
                            <input type="checkbox" checked={on} aria-label={`Select ${r.site_code}`} onChange={() => toggle(setSelected, r.work_item_id)} />
                          </label>
                        </td>
                      )}
                      <td>
                        <button
                          type="button"
                          className="uw-icon-btn uw-expand"
                          aria-expanded={open}
                          aria-label={`${open ? 'Hide' : 'Show'} details of ${r.site_code}`}
                          onClick={() => toggle(setExpanded, key)}
                        >
                          <Icon name="chevron--right" size={16} />
                        </button>
                      </td>
                      <td>
                        <span className="uw-site">
                          <SiteIdButton siteCode={r.site_code} onClick={() => setHistory({ id: r.work_item_id, code: r.site_code })} />
                          {r.round > 1 && <Flag>Round {r.round}</Flag>}
                        </span>
                      </td>
                      <td>
                        <Fa>{r.villages[0]?.name}</Fa>
                        {r.villages.length > 1 && <span className="uw-muted"> +{formatNumber(r.villages.length - 1)}</span>}
                      </td>
                      <td><Fa>{r.province}</Fa></td>
                      <td><Fa>{r.contractor}</Fa></td>
                      <td><span className="uw-muted">{r.batch}</span></td>
                      <td><AgingCell days={r.aging_days} slaDays={r.sla_days} /></td>
                      {tab === 'reviewed' && (
                        <td>
                          <span className={`uw-result ${r.outcome === 'DT done' ? 'is-ready' : 'is-not-ready'}`}><i aria-hidden="true" />{r.outcome}</span>
                        </td>
                      )}
                    </tr>
                    {open && (
                      <tr className="uw-detail-row is-open">
                        <td colSpan={cols}>
                          <div className="uw-expand-body">
                            <span className="uw-chips">
                              {r.villages.map((v) => (
                                <span key={v.id} className="uw-chip"><Fa>{v.name}</Fa>&nbsp;· {v.code || v.id}{v.is_new && ' · New in CPM'}</span>
                              ))}
                            </span>
                            <TechChips techs={r.technologies} />
                            <span className="uw-muted">
                              assigned {formatDateTime(r.assigned_at)}{r.assigned_by ? ` by ${r.assigned_by}` : ''}
                              {r.submitted_at && ` · submitted ${formatDateTime(r.submitted_at)}`}
                              {` · ${plural(r.evidence_count, 'evidence file')}`}
                            </span>
                          </div>
                        </td>
                      </tr>
                    )}
                  </Fragment>
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
