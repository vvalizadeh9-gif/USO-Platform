import { useCallback, useMemo, useState } from 'react'
import api from '../../api/client'
import AssignPanel from '../../components/work/AssignPanel'
import SiteHistoryDrawer from '../../components/SiteHistoryDrawer'
import SiteTable from '../../components/work/SiteTable'
import {
  EmptyStep, Fa, Flag, HistoryButton, SearchBox, SiteIdButton, StepError, TechChips,
  ToolSelect, WaitingCell, WorkListCard,
} from '../../components/work/parts'
import { useWork } from '../../components/work/WorkContext'
import { useToast } from '../../context/ToastContext'
import { orderSites } from '../../lib/siteOrder'
import useStepData, { useExportRows } from './useStepData'
import { formatNumber } from '../../lib/numbers'
import Select from '../../components/Select'

/** The server takes at most this many sites in one assignment. */
const MAX_ASSIGN = 500
/** Rows drawn at a time: the pool can hold the whole country. */
const PAGE = 200

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`

/** The pool's "Ready to assign" states: Home's hc_assign queue counts these. */
const HC_READY = new Set(['New', 'Ready for re-check'])

const PROCESS = {
  hc: {
    url: '/hc/basket',
    rows: (data) => data.filter((b) => HC_READY.has(b.hc_state)),
    since: 'Longest waiting first · waiting counts since it went on air',
    flags: (r) => [
      (r.hc_state === 'Ready for re-check' || r.round_no > 1) && (
        <Flag key="re" title={r.returning_reason || `Round ${r.round_no}`}>Re-check</Flag>
      ),
      r.dt_status === 'Ongoing' && <Flag key="dt">DT ongoing</Flag>,
    ],
    extraColumns: [],
    async assign(ids, contractor) {
      const { data } = await api.post('/hc/assignments', { contractor_id: contractor.contractor_id, work_item_ids: ids })
      return `/hc/assignments/${data.id}/undo`
    },
  },
  dt: {
    url: '/hc/queues/dt-assignment',
    rows: (data) => data,
    since: 'Longest waiting first · waiting counts since health check passed',
    flags: (r) => [r.returned_reason && <Flag key="back" title={r.returned_reason}>Handed back</Flag>],
    extraColumns: [
      {
        key: 'rounds', label: 'Rounds', width: '8%',
        render: (r) => (r.rounds_taken > 1 ? <Flag>{r.rounds_taken}</Flag> : <span className="uw-num">{r.rounds_taken}</span>),
      },
      { key: 'hcby', label: 'HC by', width: '12%', render: (r) => <Fa>{r.hc_contractor}</Fa> },
    ],
    async assign(ids, contractor) {
      const { data } = await api.post('/work-items/assign', {
        work_item_ids: ids, contractor_id: contractor.contractor_id, assignment_type: 'official',
      })
      return `/work-items/assign/${data.batch_id}/undo`
    },
  },
}

const EXPORT_COLUMNS = [
  { label: 'Site ID', value: (r) => r.site_code },
  { label: 'Village', value: (r) => r.village },
  { label: 'Province', value: (r) => r.province },
  { label: 'Requested tech', value: (r) => (r.requested_technologies || []).join(' ') },
  { label: 'Waiting (days)', value: (r) => r.days_waiting },
]

/**
 * Steps 1 and 4 (UEP-06 §4.1–4.2): the sites waiting to be assigned, and the
 * contractor cards under them. Select sites, click a contractor: assigned.
 */
export default function AssignStep({ process, step, figures, panelProps, onExport }) {
  const config = PROCESS[process]
  const toast = useToast()
  const { notice, clearNotice, confirmAction } = useWork()
  const { rows: data, error, retry } = useStepData(config.url)
  const [selected, setSelected] = useState(() => new Set())
  const [query, setQuery] = useState('')
  const [province, setProvince] = useState('')
  // Longest waiting first by default (UEP-13 §3.10); Province on request.
  const [byProvince, setByProvince] = useState(false)
  const [limit, setLimit] = useState(PAGE)
  const [busyId, setBusyId] = useState(null)
  const [history, setHistory] = useState({ id: null, code: null })
  const slaDays = figures?.sla_days

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
      (r) => (!province || r.province === province) && (!q || (r.site_code || '').toLowerCase().includes(q)),
    )
    return orderSites(kept, byProvince)
  }, [rows, query, province, byProvince])
  useExportRows(onExport, EXPORT_COLUMNS, shown)

  // A selection only holds sites still in the queue; it survives filtering.
  const live = useMemo(() => [...selected].filter((id) => byId.has(id)), [selected, byId])

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
    setBusyId(contractor.contractor_id)
    try {
      const undoUrl = await config.assign(ids, contractor)
      setSelected(new Set())
      confirmAction({ text: `✓ ${plural(ids.length, 'site')} assigned to ${contractor.name}.`, undoUrl })
    } catch (err) {
      toast.error('Assignment failed', err.response?.data?.detail || 'Please try again.')
      // 409: somebody assigned one of these while this page was open.
      if (err.response?.status === 409) retry()
    } finally {
      setBusyId(null)
    }
  }

  const columns = [
    {
      key: 'site', label: 'Site ID', width: '15%',
      render: (r) => (
        <span className="uw-site">
          <SiteIdButton siteCode={r.site_code} onClick={() => setHistory({ id: r.work_item_id, code: r.site_code })} />
          {config.flags(r)}
        </span>
      ),
    },
    {
      key: 'village', label: 'Village', width: '15%',
      render: (r) => (
        <>
          <Fa>{r.village}</Fa>
          {r.village_count > 1 && <span className="uw-muted"> +{formatNumber(r.village_count - 1)}</span>}
        </>
      ),
    },
    { key: 'province', label: 'Province', width: '15%', render: (r) => <Fa>{r.province}</Fa> },
    { key: 'tech', label: 'Requested tech', width: '17%', render: (r) => <TechChips techs={r.requested_technologies} /> },
    ...config.extraColumns,
    {
      key: 'waiting',
      label: (
        <>
          Waiting · SLA {slaDays ?? '–'} d<span className="uw-sr-only">. {config.since.split(' · ')[1]}</span>
        </>
      ),
      render: (r) => <WaitingCell days={r.days_waiting} slaDays={slaDays} />,
    },
    {
      key: 'history', label: <span className="uw-sr-only">History</span>, width: 'var(--uep-col-icon)', className: 'uw-col-icon',
      render: (r) => <HistoryButton siteCode={r.site_code} onClick={() => setHistory({ id: r.work_item_id, code: r.site_code })} />,
    },
  ]

  const visible = shown.slice(0, limit)
  const selectedProvinces = live.map((id) => byId.get(id)?.province)

  return (
    <WorkListCard
      {...panelProps}
      busy={!rows && !error}
      tools={
        <>
          <SearchBox value={query} onChange={setQuery} />
          <ToolSelect label="Province" value={province} onChange={setProvince} options={provinces} allLabel="All provinces" />
          <Select
            aria-label="Sort"
            className="uw-tool-select"
            value={byProvince ? 'province' : 'waiting'}
            onChange={(e) => setByProvince(e.target.value === 'province')}
            options={[
              { value: 'waiting', label: 'Longest waiting' },
              { value: 'province', label: 'Province' },
            ]}
          />
        </>
      }
      description={config.since}
      foot={
        <AssignPanel
          process={process}
          selectedCount={live.length}
          selectedProvinces={selectedProvinces}
          onClear={() => setSelected(new Set())}
          onAssign={assign}
          busyId={busyId}
        />
      }
    >
      {error && !rows ? (
        <StepError stepName={step.name} onRetry={retry} />
      ) : rows && rows.length === 0 ? (
        <EmptyStep stepName={step.name} />
      ) : (
        <SiteTable
          label={step.name}
          rows={visible}
          filterIds={shown.map((r) => r.work_item_id)}
          rowId={(r) => r.work_item_id}
          columns={columns}
          selected={new Set(live)}
          onSelect={onSelect}
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
