import { useCallback, useMemo, useState } from 'react'
import api from '../../api/client'
import AssignPanel from '../../components/work/AssignPanel'
import SiteHistoryDrawer from '../../components/SiteHistoryDrawer'
import SiteTable from '../../components/work/SiteTable'
import {
  EmptyStep, Fa, SearchBox, SiteIdButton, SortHeader, StepError,
  ToolSelect, VillageCount, WaitingCell, WorkListCard,
} from '../../components/work/parts'
import { useWork } from '../../components/work/WorkContext'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { formatDateTime } from '../../lib/dates'
import { byWait } from '../../lib/siteOrder'
import { typeLabel } from '../explorer/listModel'
import useStepData, { useExportRows } from './useStepData'
import { formatNumber } from '../../lib/numbers'

/** The server takes at most this many sites in one assignment. */
const MAX_ASSIGN = 500
/** Rows drawn at a time: the pool can hold the whole country. */
const PAGE = 200

const plural = (n, one) => `${formatNumber(n)} ${n === 1 ? one : `${one}s`}`

/** The pool's "Ready to assign" states: Home's hc_assign queue counts these. */
const HC_READY = new Set(['New', 'Ready for re-check'])

/** Villages a row assigns: a new-village row only its new ones. */
const villagesOf = (r) => (r.new_villages > 0 ? r.new_villages : Math.max(1, r.village_count || 0))

const PROCESS = {
  hc: {
    url: '/hc/basket',
    rows: (data) => data.filter((b) => HC_READY.has(b.hc_state)),
    // The site ID's second line (UEP-31 §2.1): a re-check and its round.
    note: (r) =>
      (r.hc_state === 'Ready for re-check' || r.round_no > 1) && (
        <span className="uw-sub" title={r.returning_reason || undefined}>Re-check · Round {Math.max(2, r.round_no || 2)}</span>
      ),
    who: { key: 'prev', label: 'Previous contractor', render: (r) => <Fa>{r.previous_contractor}</Fa> },
    async assign(ids, contractor) {
      const { data } = await api.post('/hc/assignments', { contractor_id: contractor.contractor_id, work_item_ids: ids })
      return { undoUrl: `/hc/assignments/${data.id}/undo`, code: data.code }
    },
  },
  dt: {
    url: '/hc/queues/dt-assignment',
    rows: (data) => data,
    note: (r) => r.returned_reason && <span className="uw-sub" title={r.returned_reason}>Handed back</span>,
    who: { key: 'hcby', label: 'Health check by', render: (r) => <Fa>{r.hc_contractor}</Fa> },
    async assign(ids, contractor) {
      const { data } = await api.post('/work-items/assign', {
        work_item_ids: ids, contractor_id: contractor.contractor_id, assignment_type: 'official',
      })
      return { undoUrl: `/work-items/assign/${data.batch_id}/undo`, code: data.batch_code }
    },
  },
}

const EXPORT_COLUMNS = [
  { label: 'Site ID', value: (r) => r.site_code },
  { label: 'Village', value: (r) => r.village },
  { label: 'Villages', value: (r) => r.village_count },
  { label: 'Province', value: (r) => r.province },
  { label: 'Site type', value: (r) => typeLabel(r.site_type) },
  { label: 'Requested tech', value: (r) => (r.requested_technologies || []).join(' ') },
  { label: 'Waiting (days)', value: (r) => r.days_waiting },
]

/** Waiting (longest first) or Province: the two sortable headers. */
function sortRows(rows, sort) {
  const dir = sort.dir === 'asc' ? 1 : -1
  if (sort.key === 'province') {
    return [...rows].sort((a, b) => dir * (a.province || '').localeCompare(b.province || '', 'fa') || byWait(a, b))
  }
  return [...rows].sort((a, b) => -dir * byWait(a, b))
}

/** Search matches the site ID and each village's name or code. */
function matches(r, q) {
  if (!q) return true
  if ((r.site_code || '').toLowerCase().includes(q)) return true
  return (r.villages || []).some((v) => (v.name || '').toLowerCase().includes(q) || String(v.code || '').includes(q))
}

/**
 * Health check and Drive test Assign (UEP-31 §2): the sites waiting to be
 * assigned on the left, the Contractors column on the right. Select sites,
 * pick a contractor, press Assign.
 */
export default function AssignStep({ process, step, figures, summary, panelProps, onExport }) {
  const config = PROCESS[process]
  const toast = useToast()
  const { user } = useAuth()
  const { notice, clearNotice, confirmAction } = useWork()
  const { rows: data, error, retry } = useStepData(config.url)
  const [selected, setSelected] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [province, setProvince] = useState('')
  const [sort, setSort] = useState({ key: 'waiting', dir: 'desc' })
  const [limit, setLimit] = useState(PAGE)
  const [busy, setBusy] = useState(false)
  const [leaving, setLeaving] = useState(() => new Set())
  const [history, setHistory] = useState({ id: null, code: null })
  const slaDays = figures?.sla_days
  const readOnly = user?.role?.name === 'Viewer'

  const rows = useMemo(() => (data ? config.rows(data) : null), [data, config])
  const byId = useMemo(() => new Map((rows || []).map((r) => [r.work_item_id, r])), [rows])
  const provinces = useMemo(
    () => [...new Set((rows || []).map((r) => r.province).filter(Boolean))].sort(),
    [rows],
  )
  const shown = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    return sortRows(rows.filter((r) => (!province || r.province === province) && matches(r, q)), sort)
  }, [rows, query, province, sort])
  useExportRows(onExport, EXPORT_COLUMNS, shown)

  // A selection only holds sites still in the queue; it survives filtering.
  const live = useMemo(() => [...selected].filter((id) => byId.has(id)), [selected, byId])
  const villageCount = live.reduce((n, id) => n + villagesOf(byId.get(id)), 0)
  // A re-check pre-selects whoever checked it last: when every selected
  // site shares one previous contractor.
  const previousContractorId = useMemo(() => {
    const prev = new Set(live.map((id) => byId.get(id)?.previous_contractor_id).filter(Boolean))
    return prev.size === 1 ? [...prev][0] : null
  }, [live, byId])

  const onSelect = useCallback(
    (ids, on) => {
      if (notice) clearNotice()
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of ids) {
          if (on && next.size >= MAX_ASSIGN) break
          on ? next.add(id) : next.delete(id)
        }
        return next
      })
    },
    [notice, clearNotice],
  )

  async function assign(contractor) {
    const ids = live
    const villages = villageCount
    setBusy(true)
    try {
      const { undoUrl, code } = await config.assign(ids, contractor)
      setLeaving(new Set(ids))
      setSelected(new Set())
      const dueDays = summary?.[process === 'hc' ? 'hc2' : 'dt5']?.sla_days
      const due = dueDays ? ` · due ${formatDateTime(new Date(Date.now() + dueDays * 86400000))}` : ''
      const text = `Batch ${code || ''} sent to ${contractor.name} · ${plural(ids.length, 'site')} · ${plural(villages, 'village')} recorded${due}`
      // The rows slide out, then the list reloads without them.
      setTimeout(() => {
        setLeaving(new Set())
        confirmAction({ text, undoUrl })
      }, 260)
    } catch (err) {
      toast.error('Assignment failed', err.response?.data?.detail || 'Please try again.')
      if (err.response?.status === 409) retry()
    } finally {
      setBusy(false)
    }
  }

  const open = (r) => setHistory({ id: r.work_item_id, code: r.site_code })
  const onSort = (key) =>
    setSort((s) => (s.key === key ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' } : { key, dir: key === 'waiting' ? 'desc' : 'asc' }))
  const columns = [
    {
      key: 'site', label: 'Site ID', width: '17%',
      render: (r) => (
        <span className="uw-cell-two">
          <SiteIdButton siteCode={r.site_code} onClick={() => open(r)} />
          {config.note(r)}
        </span>
      ),
    },
    { key: 'village', label: 'Villages', width: '12%', render: (r) => <VillageCount villages={r.villages} /> },
    { key: 'province', header: <SortHeader id="province" label="Province" sort={sort} onSort={onSort} />, width: '19%', render: (r) => <Fa>{r.province}</Fa> },
    { key: 'type', label: 'Site type', width: '13%', render: (r) => typeLabel(r.site_type) || <span className="uw-none">—</span> },
    { ...config.who, width: '19%' },
    {
      key: 'waiting',
      header: <SortHeader id="waiting" label="Waiting" sort={sort} onSort={onSort} />,
      render: (r) => <WaitingCell days={r.days_waiting} slaDays={slaDays} />,
    },
  ]

  const visible = shown.slice(0, limit)
  const selectedProvinces = live.map((id) => byId.get(id)?.province)

  return (
    <div {...panelProps} className={`uw-assign-layout ${readOnly ? 'is-read-only' : ''}`.trim()}>
      <WorkListCard
        busy={!rows && !error}
        tools={
          <>
            <SearchBox value={query} onChange={setQuery} label="Search site ID, village ID or name" placeholder="Site, village ID or name…" />
            <ToolSelect label="Province" value={province} onChange={setProvince} options={provinces} allLabel="All provinces" />
          </>
        }
      >
      {error && !rows ? (
        <StepError stepName={step.name} onRetry={retry} />
      ) : rows && rows.length === 0 ? (
        <EmptyStep text={process === 'hc' ? 'No sites waiting for a health check.' : 'No sites waiting for a drive test.'} />
      ) : (
        <SiteTable
          label={step.name}
          rows={visible}
          filterIds={shown.map((r) => r.work_item_id)}
          rowId={(r) => r.work_item_id}
          columns={columns}
          selected={new Set(live)}
          onSelect={readOnly ? undefined : onSelect}
          leaving={leaving}
          siteLabel={(r) => r.site_code}
          loading={!rows}
          after={
            visible.length < shown.length && (
              <tr className="uw-more-row">
                <td colSpan={columns.length + 1}>
                  <button type="button" className="uw-btn uw-btn-sm" onClick={() => setLimit((n) => n + PAGE)}>
                    Show {Math.min(PAGE, shown.length - visible.length)} more
                  </button>
                </td>
              </tr>
            )
          }
        />
      )}
        <SiteHistoryDrawer workItemId={history.id} siteCode={history.code} onClose={() => setHistory({ id: null, code: null })} />
      </WorkListCard>
      {!readOnly && (
        <AssignPanel
          process={process}
          selectedCount={live.length}
          villageCount={villageCount}
          selectedProvinces={selectedProvinces}
          previousContractorId={previousContractorId}
          onClear={() => setSelected(new Set())}
          onAssign={assign}
          busy={busy}
        />
      )}
    </div>
  )
}
