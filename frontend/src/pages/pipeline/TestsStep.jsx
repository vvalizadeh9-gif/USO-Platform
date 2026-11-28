import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import api from '../../api/client'
import SiteHistoryDrawer from '../../components/SiteHistoryDrawer'
import {
  EmptyStep, Fa, Flag, SearchBox, SiteIdButton, SkeletonRows, SortHeader, StepError, VillageCount, WaitingCell, WorkListCard,
} from '../../components/work/parts'
import { useWork } from '../../components/work/WorkContext'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
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
  { label: 'Report files', value: (r) => r.evidence_count },
  { label: 'Aging (days)', value: (r) => r.aging_days },
  { label: 'Outcome', value: (r) => r.outcome },
]

/** "3 files", or a red "No report"; nothing to show while with the contractor. */
function ReportCell({ row, tab }) {
  if (tab === 'with') return <span className="uw-none">—</span>
  if (!row.evidence_count) return <span className="uw-late">No report</span>
  return <span>{formatNumber(row.evidence_count)} {row.evidence_count === 1 ? 'file' : 'files'}</span>
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

  const cols = (reviewing ? 1 : 0) + 6 + (tab === 'reviewed' ? 1 : 0)
  const allOn = rows?.length > 0 && rows.every((r) => selected.has(r.work_item_id))

  return (
    <WorkListCard
      {...panelProps}
      busy={!rows && !error}
      tools={
        <>
          <div className="uw-seg" role="tablist" aria-label="Tests">
            {TABS.map((t) => (
              <button key={t.key} type="button" role="tab" aria-selected={tab === t.key} className="uw-seg-btn" onClick={() => setTab(t.key)}>
                {t.label}
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
                Send back → Round 2
              </button>
            </div>
            {decision === 'back' ? (
              <Select
                className="uw-select uw-reason"
                aria-label="Reason"
                placeholder="Choose a reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                options={SEND_BACK_REASONS.map((r) => ({ value: r, label: r }))}
              />
            ) : noFiles ? (
              <label className="uw-check-line">
                <input type="checkbox" checked={checkedOutside} onChange={(e) => setCheckedOutside(e.target.checked)} />
                I checked the report outside UEP
              </label>
            ) : null}
            <button
              type="button"
              className={`uw-btn ${decision === 'accept' ? 'uw-btn-primary' : 'uw-btn-danger-solid'}`}
              disabled={!canGo}
              aria-busy={busy || undefined}
              onClick={decide}
            >
              {decision === 'accept' ? 'Accept' : 'Send back'}
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
            <col style={{ width: '17%' }} />
            <col style={{ width: '11%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '19%' }} />
            <col style={{ width: '13%' }} />
            <col />
            {tab === 'reviewed' && <col style={{ width: '12%' }} />}
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
              <SortHeader id="site" label="Site ID" sort={sort} onSort={onSort} />
              <th scope="col">Villages</th>
              <SortHeader id="province" label="Province" sort={sort} onSort={onSort} />
              <SortHeader id="contractor" label="Contractor" sort={sort} onSort={onSort} />
              <th scope="col">Report</th>
              <SortHeader id="aging" label={tab === 'with' ? `Aging · SLA ${rows?.[0]?.sla_days ?? 14} d` : 'Aging'} sort={sort} onSort={onSort} />
              {tab === 'reviewed' && <th scope="col">Outcome</th>}
            </tr>
          </thead>
          {!rows ? (
            <SkeletonRows columns={cols} />
          ) : (
            <tbody>
              {rows.map((r, i) => {
                const on = selected.has(r.work_item_id)
                return (
                  <tr
                    key={`${r.work_item_id}-${r.outcome || ''}`}
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
                      <span className="uw-cell-two">
                        <span className="uw-site">
                          <SiteIdButton siteCode={r.site_code} onClick={() => setHistory({ id: r.work_item_id, code: r.site_code })} />
                          {r.round > 1 && <Flag>Round {r.round}</Flag>}
                        </span>
                        {r.batch && <span className="uw-sub">{r.batch}</span>}
                      </span>
                    </td>
                    <td><VillageCount villages={r.villages} /></td>
                    <td><Fa>{r.province}</Fa></td>
                    <td><Fa>{r.contractor}</Fa></td>
                    <td><ReportCell row={r} tab={tab} /></td>
                    <td><WaitingCell days={r.aging_days} slaDays={tab === 'reviewed' ? null : r.sla_days} /></td>
                    {tab === 'reviewed' && (
                      <td>
                        <span className={`uw-result ${r.outcome === 'DT done' ? 'is-ready' : 'is-not-ready'}`}><i aria-hidden="true" />{r.outcome}</span>
                      </td>
                    )}
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
