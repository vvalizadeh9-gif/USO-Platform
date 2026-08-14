import { motion } from 'framer-motion'
import { useEffect, useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import api from '../api/client'
import { useAuth } from '../context/AuthContext'
import { useToast } from '../context/ToastContext'
import { EmptyState, Loading, PageHead, StatusPill } from '../components/ui'

// "DT Completed" is gone: coordinator approval IS completion, so an approved
// drive test terminates at "Coordinator Approved" (see services/workflow.py).
const STAGES = [
  'All',
  'Ready for Assignment',
  'Assigned',
  'Returned by Contractor',
  'DT Submitted',
  'Coordinator Approved',
  'Problematic',
]

// Contractors never act on the assignment queue itself — they only see work
// once it has been assigned to them.
const STAGES_HIDDEN_FOR_CONTRACTOR = new Set(['Ready for Assignment'])

// ---------------------------------------------------------------------------
// Per-stage column sets.
//
// Each tab shows exactly the columns that carry information at that point in
// the lifecycle — an assignment date is meaningless on an unassigned site, an
// approval user is meaningless before approval. The list endpoint returns the
// union of every field; this table decides what each tab renders.
// ---------------------------------------------------------------------------
const COL = {
  id: { label: 'ID', render: (r) => <span className="tnum dim">#{r.id}</span> },
  site_code: { label: 'Site ID', render: (r) => <span className="text-data">{r.site_code || '—'}</span> },
  site_type: { label: 'Site Type', render: (r) => <span style={{ fontWeight: 500 }}>{r.site_type}</span> },
  requested_technology: { label: 'Requested Tech', render: (r) => r.requested_technology || '—' },
  assignment_date: { label: 'Assignment Date', render: (r) => fmtDate(r.assignment_date) },
  assignment_user: { label: 'Assignment User', render: (r) => <span className="muted">{r.assignment_user || '—'}</span> },
  contractor_name: { label: 'Contractor', render: (r) => <span className="text-data">{r.contractor_name || '—'}</span> },
  returned_date: { label: 'Returned Date', render: (r) => fmtDate(r.returned_date) },
  dt_submission_date: { label: 'DT Submission Date', render: (r) => fmtDate(r.dt_submission_date) },
  aging_days: {
    label: 'Aging (days)',
    render: (r) => (r.aging_days == null ? '—' : <span className="tnum">{r.aging_days}</span>),
  },
  dt_approval_date: { label: 'DT Approval Date', render: (r) => fmtDate(r.dt_approval_date) },
  dt_approval_user: { label: 'DT Approval User', render: (r) => <span className="muted">{r.dt_approval_user || '—'}</span> },
  stage: { label: 'Stage', render: (r) => <StatusPill status={r.current_stage} /> },
}

const BASE = ['id', 'site_code', 'site_type', 'requested_technology']

const STAGE_COLUMNS = {
  All: [...BASE, 'stage'],
  'Ready for Assignment': [...BASE, 'stage'],
  Assigned: [...BASE, 'assignment_date', 'assignment_user', 'stage'],
  'Returned by Contractor': [...BASE, 'assignment_date', 'assignment_user', 'returned_date', 'stage'],
  'DT Submitted': [...BASE, 'assignment_date', 'contractor_name', 'dt_submission_date', 'stage'],
  'Coordinator Approved': [
    ...BASE, 'assignment_date', 'contractor_name', 'dt_submission_date',
    'aging_days', 'dt_approval_date', 'dt_approval_user', 'stage',
  ],
  Problematic: [...BASE, 'stage'],
}

function fmtDate(value) {
  if (!value) return '—'
  const d = new Date(value)
  if (Number.isNaN(d.getTime())) return '—'
  return <span className="tnum">{d.toISOString().slice(0, 10)}</span>
}

export default function WorkItems() {
  const { user } = useAuth()
  const toast = useToast()
  const navigate = useNavigate()
  const canAssign = ['Admin', 'PM'].includes(user?.role?.name)
  const isContractor = user?.role?.name === 'Contractor'
  const visibleStages = STAGES.filter(
    (s) => !isContractor || !STAGES_HIDDEN_FOR_CONTRACTOR.has(s)
  )

  const [items, setItems] = useState(null)
  const [stage, setStage] = useState('All')
  const [contractors, setContractors] = useState([])
  const [selected, setSelected] = useState(() => new Set())

  const load = () => {
    setItems(null)
    setSelected(new Set())
    const params = stage === 'All' ? {} : { stage }
    api.get('/work-items', { params }).then((r) => setItems(r.data)).catch(() => setItems([]))
  }

  useEffect(load, [stage])
  useEffect(() => {
    if (canAssign) api.get('/reference/contractors').then((r) => setContractors(r.data)).catch(() => {})
  }, [canAssign])

  const toggle = (id) =>
    setSelected((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  const allVisibleIds = useMemo(() => (items || []).map((i) => i.id), [items])
  const allSelected = allVisibleIds.length > 0 && allVisibleIds.every((id) => selected.has(id))
  const toggleAll = () => setSelected(allSelected ? new Set() : new Set(allVisibleIds))

  // Bulk assignment only makes sense on sites that are actually awaiting one.
  const canBulkAssign = canAssign && ['All', 'Ready for Assignment', 'Returned by Contractor'].includes(stage)
  const columns = STAGE_COLUMNS[stage] || STAGE_COLUMNS.All

  return (
    <>
      <PageHead
        eyebrow="Operations"
        title="Work Items"
        subtitle="Every deployment unit (Site + Type) within your assigned provinces."
      />

      <div className="row wrap mb-16" style={{ gap: 8 }}>
        {visibleStages.map((s) => (
          <button
            key={s}
            className={`btn btn-sm ${stage === s ? 'btn-primary' : ''}`}
            onClick={() => setStage(s)}
          >
            {s}
          </button>
        ))}
      </div>

      {canBulkAssign && selected.size > 0 && (
        <BulkAssignBar
          count={selected.size}
          contractors={contractors}
          onClear={() => setSelected(new Set())}
          onAssign={async (contractorId) => {
            try {
              await api.post('/work-items/assign', {
                work_item_ids: [...selected],
                contractor_id: contractorId,
                assignment_type: 'official',
              })
              toast.success(`${selected.size} site(s) assigned`)
              load()
            } catch (err) {
              toast.error('Assign failed', err.response?.data?.detail || 'Please try again.')
            }
          }}
        />
      )}

      {!items ? (
        <Loading label="Loading work items" />
      ) : items.length === 0 ? (
        <div className="card"><EmptyState title="No work items found" hint="Try a different stage filter, or import a CPM file." /></div>
      ) : (
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                {canBulkAssign && (
                  <th style={{ width: 32 }}>
                    <input type="checkbox" checked={allSelected} onChange={toggleAll} />
                  </th>
                )}
                {columns.map((key) => (
                  <th key={key}>{COL[key].label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((it, i) => (
                <motion.tr
                  key={it.id}
                  initial={{ opacity: 0, y: 6 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(i * 0.02, 0.4) }}
                  style={{ cursor: 'pointer' }}
                  onClick={() => navigate(`/work-items/${it.id}`)}
                >
                  {canBulkAssign && (
                    <td onClick={(e) => e.stopPropagation()}>
                      <input
                        type="checkbox"
                        checked={selected.has(it.id)}
                        onChange={() => toggle(it.id)}
                      />
                    </td>
                  )}
                  {columns.map((key) => (
                    <td key={key}>{COL[key].render(it)}</td>
                  ))}
                </motion.tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  )
}

function BulkAssignBar({ count, contractors, onAssign, onClear }) {
  const [contractorId, setContractorId] = useState('')
  const [busy, setBusy] = useState(false)

  const assign = async () => {
    if (!contractorId) return
    setBusy(true)
    await onAssign(Number(contractorId))
    setBusy(false)
    setContractorId('')
  }

  return (
    <div
      className="card card-pad mb-16 row between wrap"
      style={{ gap: 12, alignItems: 'center', borderColor: 'var(--signal)' }}
    >
      <span style={{ fontWeight: 500 }}>{count} selected</span>
      <div className="row" style={{ gap: 8, alignItems: 'center' }}>
        <select
          className="input"
          style={{ minWidth: 200 }}
          value={contractorId}
          onChange={(e) => setContractorId(e.target.value)}
        >
          <option value="">Assign to contractor…</option>
          {contractors.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={!contractorId || busy} onClick={assign}>
          {busy ? 'Assigning…' : 'Assign (official)'}
        </button>
        <button className="btn" onClick={onClear}>Clear</button>
      </div>
    </div>
  )
}
