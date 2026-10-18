import { useCallback, useMemo, useState } from 'react'
import api from '../../api/client'
import AssignPanel from '../../components/work/AssignPanel'
import SiteHistoryDrawer from '../../components/SiteHistoryDrawer'
import SiteTable from '../../components/work/SiteTable'
import {
  EmptyStep, Fa, Flag, SearchBox, SiteIdButton, StepError, TechChips,
  ToolSelect, WaitingCell, WorkListCard,
} from '../../components/work/parts'
import { useWork } from '../../components/work/WorkContext'
import { useToast } from '../../context/ToastContext'
import { useAuth } from '../../context/AuthContext'
import { formatDateTime } from '../../lib/dates'
import { orderSites } from '../../lib/siteOrder'
import useStepData, { useExportRows } from './useStepData'
import { formatNumber } from '../../lib/numbers'
import Select from '../../components/Select'

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
    // Re-check · Round 2 is the only Health check flag besides new village;
    // there is no "DT ongoing" tag (UEP-14 §3.3).
    flags: (r) => [
      (r.hc_state === 'Ready for re-check' || r.round_no > 1) && (
        <Flag key="re" title={r.returning_reason || undefined}>Re-check · Round {Math.max(2, r.round_no || 2)}</Flag>
      ),
    ],
    who: { key: 'prev', label: 'Previous contractor', render: (r) => <Fa>{r.previous_contractor}</Fa> },
    async assign(ids, contractor) {
      const { data } = await api.post('/hc/assignments', { contractor_id: contractor.contractor_id, work_item_ids: ids })
      return { undoUrl: `/hc/assignments/${data.id}/undo`, code: data.code }
    },
  },
  dt: {
    url: '/hc/queues/dt-assignment',
    rows: (data) => data,
    flags: (r) => [r.returned_reason && <Flag key="back" title={r.returned_reason}>Handed back</Flag>],
    who: { key: 'hcby', label: 'HC by', render: (r) => <Fa>{r.hc_contractor}</Fa> },
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
  { label: 'Requested tech', value: (r) => (r.requested_technologies || []).join(' ') },
  { label: 'Waiting (days)', value: (r) => r.days_waiting },
]

/**
 * Health check and Drive test Assign (UEP-14 §3.3): the sites waiting to be
 * assigned, and the assign bar docked under them. Select sites, pick a
 * contractor, press Assign.
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
  const [byProvince, setByProvince] = useState(false)
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
    const kept = rows.filter(
      (r) =>
        (!province || r.province === province) &&
        (!q || (r.site_code || '').toLowerCase().includes(q) || (r.village || '').toLowerCase().includes(q) || String(r.village_code || '').includes(q)),
    )
    return orderSites(kept, byProvince)
  }, [rows, query, province, byProvince])
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
  const columns = [
    {
      key: 'site', label: 'Site ID', width: '16%',
      render: (r) => (
        <span className="uw-site">
          <SiteIdButton siteCode={r.site_code} onClick={() => open(r)} />
          {config.flags(r)}
        </span>
      ),
    },
    {
      key: 'village', label: 'Villages', width: '19%',
      render: (r) => (
        <span className="uw-site">
          <Fa>{r.village}</Fa>
          {r.village_count > 1 && <span className="uw-muted"> +{formatNumber(r.village_count - 1)}</span>}
          {r.new_villages > 0 && <Flag>{plural(r.new_villages, 'new village')}</Flag>}
        </span>
      ),
    },
    { key: 'province', label: 'Province', width: '13%', render: (r) => <Fa>{r.province}</Fa> },
    { key: 'tech', label: 'Requested tech', width: '14%', render: (r) => <TechChips techs={r.requested_technologies} /> },
    { ...config.who, width: '15%' },
    {
      key: 'waiting',
      label: <>Waiting · SLA {slaDays ?? '–'} d</>,
      render: (r) => <WaitingCell days={r.days_waiting} slaDays={slaDays} />,
    },
  ]

  const visible = shown.slice(0, limit)
  const selectedProvinces = live.map((id) => byId.get(id)?.province)

  return (
    <WorkListCard
      {...panelProps}
      stage={process}
      chip={process === 'hc' ? 'Step 1 · Sites waiting for a health check' : 'Step 3 · Sites cleared for a drive test'}
      busy={!rows && !error}
      tools={
        <>
          <SearchBox value={query} onChange={setQuery} label="Search site ID, village ID or name" placeholder="Site, village ID or name…" />
          <ToolSelect label="Province" value={province} onChange={setProvince} options={provinces} allLabel="All provinces" />
          <Select
            aria-label="Sort"
            className="uw-select"
            value={byProvince ? 'province' : 'waiting'}
            onChange={(e) => setByProvince(e.target.value === 'province')}
            options={[
              { value: 'waiting', label: 'Longest waiting' },
              { value: 'province', label: 'By province' },
            ]}
          />
          <span className="uw-count">{plural(shown.length, 'site')}</span>
        </>
      }
      foot={
        readOnly ? null : (
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
        )
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
                    Show {Math.min(PAGE, shown.length - visible.length)} more of {shown.length.toLocaleString('en-US')}
                  </button>
                </td>
              </tr>
            )
          }
        />
      )}
      <SiteHistoryDrawer workItemId={history.id} siteCode={history.code} onClose={() => setHistory({ id: null, code: null })} />
    </WorkListCard>
  )
}
