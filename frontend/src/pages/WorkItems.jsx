import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'
import api from '../api/client'
import { useFillPage } from '../components/pageMode'
import AssignPanel from '../components/work/AssignPanel'
import PageHeading from '../components/work/PageHeading'
import RecentActions from '../components/work/RecentActions'
import SiteTable from '../components/work/SiteTable'
import { WorkProvider, useWork } from '../components/work/WorkContext'
import { EmptyStep, Fa, SearchBox, StepError, TechChips, WorkListCard } from '../components/work/parts'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { describeBlobError, saveBlob } from '../lib/download'
import { toPersianDigits } from '../lib/persianDigits'
import { canReview } from '../lib/roles'
import AppFooter from '../shell/AppFooter'
import { useHomeData } from '../shell/HomeData'
import '../styles/home.css'
import '../styles/work.css'

// The stages, in lifecycle order: chip label and the `current_stage` value.
// Approval IS completion, so an approved drive test terminates at DT Done.
const STAGES = [
  { label: 'All', value: 'All' },
  { label: 'HC in progress', value: 'HC In Progress' },
  { label: 'HC review', value: 'HC Review' },
  { label: 'Ready for assignment', value: 'Ready for Assignment' },
  { label: 'Assigned', value: 'Assigned' },
  { label: 'Returned', value: 'Returned by Contractor' },
  { label: 'DT submitted', value: 'DT Submitted' },
  { label: 'DT done', value: 'DT Done' },
  { label: 'Problematic', value: 'Problematic' },
]

// Contractors never act on the assignment queue itself.
const HIDDEN_FOR_CONTRACTOR = new Set(['Ready for Assignment'])

/** The stages bulk assignment applies to: the sites awaiting one. */
const ASSIGNABLE = new Set(['Ready for Assignment', 'Returned by Contractor'])

const PAGE = 100

/** "2G/4G" as chips. The server's parser (tech_parser) is what decides a
 * site's technologies; this only splits the stored text for display. */
const techsOf = (text) => (text || '').split(/[\s,/+&]+/).filter(Boolean)

const STAGE_TONE = {
  Problematic: 'is-problem',
  'DT Done': 'is-done',
  Assigned: 'is-ongoing',
  'DT Submitted': 'is-ongoing',
  'Ready for Assignment': 'is-pending',
  'Returned by Contractor': 'is-pending',
}

const fmtDate = (value) => {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : <span className="uw-num">{d.toISOString().slice(0, 10)}</span>
}

// The columns each stage adds after the common ones: only the dates that
// carry information at that point in the lifecycle.
const STAGE_EXTRA = {
  Assigned: [
    { key: 'assignment_date', label: 'Assigned', render: (r) => fmtDate(r.assignment_date) },
    { key: 'assigned_aging_days', label: 'Aging (days)', render: (r) => <span className="uw-num">{r.assigned_aging_days ?? '—'}</span> },
    { key: 'assignment_user', label: 'Assigned by', render: (r) => r.assignment_user || '—' },
  ],
  'Returned by Contractor': [
    { key: 'assignment_date', label: 'Assigned', render: (r) => fmtDate(r.assignment_date) },
    { key: 'returned_date', label: 'Returned', render: (r) => fmtDate(r.returned_date) },
  ],
  'DT Submitted': [
    { key: 'assignment_date', label: 'Assigned', render: (r) => fmtDate(r.assignment_date) },
    { key: 'dt_submission_date', label: 'DT submitted', render: (r) => fmtDate(r.dt_submission_date) },
  ],
  'DT Done': [
    { key: 'dt_submission_date', label: 'DT submitted', render: (r) => fmtDate(r.dt_submission_date) },
    { key: 'aging_days', label: 'Aging (days)', render: (r) => <span className="uw-num">{r.aging_days ?? '—'}</span> },
    { key: 'dt_approval_date', label: 'Approved', render: (r) => fmtDate(r.dt_approval_date) },
    { key: 'dt_approval_user', label: 'Approved by', render: (r) => r.dt_approval_user || '—' },
  ],
}

const BASE_COLUMNS = [
  { key: 'site', label: 'Site ID', width: '13%', render: (r) => <Link className="uw-site-id" to={`/work-items/${r.id}`}>{r.site_code || `#${r.id}`}</Link> },
  { key: 'province', label: 'Province', width: '15%', render: (r) => <Fa>{r.province}</Fa> },
  { key: 'type', label: 'Type', width: '10%', render: (r) => r.site_type || '—' },
  { key: 'tech', label: 'Requested tech', width: '17%', render: (r) => <TechChips techs={techsOf(r.requested_technology)} /> },
  {
    key: 'stage', label: 'Stage', width: '19%',
    render: (r) => (
      <span className={`uw-stage ${STAGE_TONE[r.current_stage] || ''}`.trim()}>
        <i aria-hidden="true" />
        {r.current_stage}
      </span>
    ),
  },
  { key: 'contractor', label: 'Contractor', width: '14%', render: (r) => <Fa>{r.contractor_name}</Fa> },
  { key: 'onair', label: 'On air', render: (r) => <Fa>{r.launch_date_shamsi ? toPersianDigits(r.launch_date_shamsi) : null}</Fa> },
]

/**
 * All sites (UEP-06 §9): every site in scope, by stage. The stage chips are
 * a tab list over the one list card; a stage adds its own date columns. Sites
 * awaiting an assignment can be bulk-assigned with the same selection and
 * contractor cards as the Drive test page. Kept generic: this page becomes
 * Explorer.
 */
export default function WorkItems() {
  useFillPage()
  return (
    <WorkProvider>
      <AllSites />
    </WorkProvider>
  )
}

function useJson(url, params, version) {
  const [state, setState] = useState({ data: null, error: false })
  const [attempt, setAttempt] = useState(0)
  const key = JSON.stringify(params)
  useEffect(() => {
    let live = true
    setState((s) => ({ data: s.data, error: false, loading: true }))
    api
      .get(url, { params })
      .then((r) => live && setState({ data: r.data, error: false }))
      .catch(() => live && setState({ data: null, error: true }))
    return () => {
      live = false
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [url, key, version, attempt])
  return { ...state, retry: () => setAttempt((n) => n + 1) }
}

function AllSites() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const { headingRef, version, confirmAction, notice, clearNotice } = useWork()
  const { data: home, error: homeError } = useHomeData()
  const [searchParams, setSearchParams] = useSearchParams()
  const isContractor = user?.role?.name === 'Contractor'
  const stages = STAGES.filter((s) => !isContractor || !HIDDEN_FOR_CONTRACTOR.has(s.value))
  const requested = searchParams.get('stage')
  const stage = stages.some((s) => s.value === requested) ? requested : 'All'
  const historyOpen = searchParams.get('view') === 'history'

  const [query, setQuery] = useState('')
  const [q, setQ] = useState('')
  const [provinceId, setProvinceId] = useState('')
  const [offset, setOffset] = useState(0)
  const [provinces, setProvinces] = useState([])
  const [selected, setSelected] = useState(() => new Set())
  const [busyId, setBusyId] = useState(null)
  const [exporting, setExporting] = useState(false)

  // The search reaches the server a moment after typing stops.
  useEffect(() => {
    const t = setTimeout(() => setQ(query.trim()), 300)
    return () => clearTimeout(t)
  }, [query])
  useEffect(() => {
    setOffset(0)
    setSelected(new Set())
  }, [stage, q, provinceId])
  useEffect(() => {
    api.get('/reference/provinces').then((r) => Array.isArray(r.data) && setProvinces(r.data)).catch(() => {})
  }, [])

  const filters = { q: q || undefined, province_id: provinceId || undefined }
  const counts = useJson('/work-items/counts', filters, version)
  const list = useJson('/work-items', { ...filters, stage: stage === 'All' ? undefined : stage, limit: PAGE, offset }, version)
  const rows = list.data
  const total = counts.data ? counts.data[stage] ?? (stage === 'All' ? counts.data.All : 0) : null

  const selectable = canReview(user) && ASSIGNABLE.has(stage)
  const columns = useMemo(() => [...BASE_COLUMNS, ...(STAGE_EXTRA[stage] || [])], [stage])
  const byId = useMemo(() => new Map((rows || []).map((r) => [r.id, r])), [rows])

  const setStage = (next) => {
    clearNotice()
    setSearchParams(next === 'All' ? {} : { stage: next }, { replace: true })
  }

  const onSelect = useCallback(
    (ids, on) => {
      if (notice) clearNotice()
      setSelected((prev) => {
        const next = new Set(prev)
        for (const id of ids) on ? next.add(id) : next.delete(id)
        return next
      })
    },
    [notice, clearNotice],
  )

  async function assign(contractor) {
    const ids = [...selected]
    setBusyId(contractor.contractor_id)
    try {
      const { data } = await api.post('/work-items/assign', {
        work_item_ids: ids, contractor_id: contractor.contractor_id, assignment_type: 'official',
      })
      setSelected(new Set())
      confirmAction({
        text: `✓ ${ids.length} ${ids.length === 1 ? 'site' : 'sites'} assigned to ${contractor.name}.`,
        undoUrl: `/work-items/assign/${data.batch_id}/undo`,
      })
    } catch (err) {
      toast.error('Assign failed', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusyId(null)
    }
  }

  // The list as a spreadsheet: the same rows, the same scope and filters.
  async function exportExcel() {
    setExporting(true)
    try {
      const res = await api.get('/work-items/export', {
        params: { ...filters, stage: stage === 'All' ? undefined : stage },
        responseType: 'blob',
      })
      saveBlob(res.data, `${stage.toLowerCase().replace(/ /g, '_')}_sites.xlsx`)
    } catch (err) {
      toast.error('Export failed', await describeBlobError(err))
    } finally {
      setExporting(false)
    }
  }

  return (
    <div className="uep-home uw-page">
      <PageHeading
        title="All sites"
        count={counts.data?.All}
        headingRef={headingRef}
        historyOpen={historyOpen}
        onHistory={() => navigate(historyOpen ? '/work-items' : '/work-items?view=history')}
        onExport={historyOpen ? undefined : exportExcel}
        exporting={exporting}
      />
      {historyOpen ? (
        <div className="uw-content">
          <RecentActions panelProps={{ id: 'sites-panel', 'aria-label': 'History' }} />
        </div>
      ) : (
        <>
          <StageChips stages={stages} value={stage} counts={counts.data} onChange={setStage} />
          <div className="uw-content">
            <WorkListCard
              id="sites-panel"
              role="tabpanel"
              aria-labelledby={`stage-chip-${stage.replace(/\W+/g, '-')}`}
              busy={!rows && !list.error}
              tools={
                <>
                  <SearchBox value={query} onChange={setQuery} label="Search site ID, village or province" placeholder="Search site, village, province…" />
                  <select className="uw-select" aria-label="Province" value={provinceId} onChange={(e) => setProvinceId(e.target.value)}>
                    <option value="">All provinces</option>
                    {provinces.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </>
              }
              description={total != null ? `${total.toLocaleString('en-US')} ${total === 1 ? 'site' : 'sites'}` : null}
              foot={
                <>
                  <Pager offset={offset} shown={rows?.length ?? 0} total={total} onMove={setOffset} />
                  {selectable && (
                    <AssignPanel
                      process="dt"
                      selectedCount={selected.size}
                      selectedProvinces={[...selected].map((id) => byId.get(id)?.province)}
                      onClear={() => setSelected(new Set())}
                      onAssign={assign}
                      busyId={busyId}
                    />
                  )}
                </>
              }
            >
              {list.error && !rows ? (
                <StepError stepName="All sites" onRetry={list.retry} />
              ) : rows && rows.length === 0 ? (
                <EmptyStep stepName={stage === 'All' ? 'this list' : stage} />
              ) : (
                <SiteTable
                  label={`Sites: ${stage}`}
                  rows={rows || []}
                  rowId={(r) => r.id}
                  columns={columns}
                  selected={selected}
                  onSelect={selectable ? onSelect : undefined}
                  siteLabel={(r) => r.site_code}
                  loading={!rows}
                />
              )}
            </WorkListCard>
          </div>
        </>
      )}
      <AppFooter data={home} failed={Boolean(homeError) && !home} />
    </div>
  )
}

/** The stage chips: a tab list with arrow, Home and End keys and a roving
 * tab stop. Scrolls sideways inside itself when it does not fit. */
function StageChips({ stages, value, counts, onChange }) {
  const ref = useRef(null)
  const index = stages.findIndex((s) => s.value === value)
  const onKeyDown = (e) => {
    const last = stages.length - 1
    const next = { ArrowRight: Math.min(last, index + 1), ArrowLeft: Math.max(0, index - 1), Home: 0, End: last }[e.key]
    if (next === undefined) return
    e.preventDefault()
    onChange(stages[next].value)
    ref.current?.querySelectorAll('[role="tab"]')[next]?.focus()
  }
  return (
    <div className="uw-chip-row" role="tablist" aria-label="Stage" ref={ref} onKeyDown={onKeyDown}>
      {stages.map((s) => {
        const on = s.value === value
        const n = counts ? counts[s.value] ?? 0 : null
        return (
          <button
            key={s.value}
            id={`stage-chip-${s.value.replace(/\W+/g, '-')}`}
            type="button"
            role="tab"
            aria-selected={on}
            aria-controls="sites-panel"
            tabIndex={on ? 0 : -1}
            className={`uw-stage-chip ${on ? 'is-selected' : ''}`.trim()}
            onClick={() => !on && onChange(s.value)}
          >
            {s.label}
            {n != null && <span className="uw-stage-count">{n.toLocaleString('en-US')}</span>}
          </button>
        )
      })}
    </div>
  )
}

function Pager({ offset, shown, total, onMove }) {
  if (!total || total <= PAGE) return null
  const last = Math.min(offset + shown, total)
  return (
    <nav className="uw-pager" aria-label="Pages">
      <span className="uw-muted uw-num">
        {(offset + 1).toLocaleString('en-US')}–{last.toLocaleString('en-US')} of {total.toLocaleString('en-US')}
      </span>
      <button type="button" className="uw-btn uw-btn-sm" disabled={offset === 0} onClick={() => onMove(Math.max(0, offset - PAGE))}>
        Previous
      </button>
      <button type="button" className="uw-btn uw-btn-sm" disabled={last >= total} onClick={() => onMove(offset + PAGE)}>
        Next
      </button>
    </nav>
  )
}
