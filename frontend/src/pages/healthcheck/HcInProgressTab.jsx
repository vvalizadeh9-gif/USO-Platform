import { ChevronDown, ChevronRight, Timer } from 'lucide-react'
import { Fragment, useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { Card, EmptyState, Loading, Meter, SegmentedControl } from '../../components/ui'
import { HC_LATE_AFTER_DAYS } from '../../lib/waiting'

const LATENESS = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'late', label: 'Late', match: (a) => a.days_outstanding > HC_LATE_AFTER_DAYS },
  { key: 'on-time', label: 'On time', match: (a) => a.days_outstanding <= HC_LATE_AFTER_DAYS },
]

/**
 * Health checks currently out with a subcontractor.
 *
 * This fills a gap rather than adding a feature: between assignment and
 * submission a site had left the pool and reached no results table, so it was
 * visible on no screen at all. The only trace was the assignment-level history
 * tab, which the Coordinator could not open -- meaning the role that assigns
 * health checks could not see which of them were late.
 *
 * Read-only, longest outstanding first. There is nothing to do here except
 * know who to chase: filter to the late ones, or to one subcontractor.
 */
export default function HcInProgressTab({ onCountChange }) {
  const [rows, setRows] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())
  const [lateness, setLateness] = useState('all')
  const [contractor, setContractor] = useState('')

  useEffect(() => {
    api
      .get('/hc/queues/in-progress')
      .then((r) => {
        setRows(r.data)
        onCountChange?.(r.data.reduce((n, a) => n + a.sites_pending, 0))
      })
      .catch(() => setRows([]))
  }, [onCountChange])

  const contractorOptions = useMemo(
    () => [...new Set((rows ?? []).map((a) => a.contractor_name).filter(Boolean))].sort(),
    [rows],
  )
  const shown = useMemo(() => {
    const match = LATENESS.find((l) => l.key === lateness).match
    return (rows ?? []).filter((a) => match(a) && (!contractor || a.contractor_name === contractor))
  }, [rows, lateness, contractor])

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  if (!rows) return <Loading label="Loading health checks in progress" />

  return (
    <Card
      className="card-fill queue-card"
      icon={Timer}
      title="Health checks in progress"
      description={`Out with a subcontractor, longest outstanding first. Late is more than ${HC_LATE_AFTER_DAYS} days.`}
      actions={
        <>
          <SegmentedControl label="Lateness" options={LATENESS} value={lateness} onChange={setLateness} />
          <select
            className="input queue-select"
            aria-label="Subcontractor"
            value={contractor}
            onChange={(e) => setContractor(e.target.value)}
          >
            <option value="">All subcontractors</option>
            {contractorOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </>
      }
    >
      {rows.length === 0 ? (
        <EmptyState title="No health checks outstanding" hint="Every assigned site has reported back." />
      ) : shown.length === 0 ? (
        <EmptyState title="Nothing matches" hint="No assignment fits this filter." />
      ) : (
        <div className="table-scroll">
          <table className="table table-compact queue-table">
            <thead>
              <tr>
                <th className="col-check"><span className="dt-sr-only">Expand</span></th>
                <th>Assignment</th>
                <th>Subcontractor</th>
                <th>Assigned</th>
                <th>Submitted</th>
                <th>Outstanding</th>
                <th>Still pending</th>
              </tr>
            </thead>
            <tbody>
              {shown.map((a) => (
                <AssignmentRows
                  key={a.assignment_id}
                  assignment={a}
                  open={expanded.has(a.assignment_id)}
                  onToggle={() => toggle(a.assignment_id)}
                />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  )
}

function AssignmentRows({ assignment: a, open, onToggle }) {
  // Nothing shouts until it has actually been a while. A row still inside a
  // normal turnaround stays quiet.
  const late = a.days_outstanding > HC_LATE_AFTER_DAYS
  const Chevron = open ? ChevronDown : ChevronRight
  return (
    <Fragment>
      <tr className="row-action" onClick={onToggle}>
        <td className="col-check">
          <button
            type="button"
            className="queue-expand"
            aria-expanded={open}
            aria-label={`${open ? 'Hide' : 'Show'} the sites pending in ${a.code}`}
            onClick={(e) => {
              e.stopPropagation()
              onToggle()
            }}
          >
            <Chevron size={16} aria-hidden="true" />
          </button>
        </td>
        <td className="queue-code">{a.code}</td>
        <td className="text-farsi">{a.contractor_name || '—'}</td>
        <td className="queue-date tnum">{fmt(a.assigned_at)}</td>
        <td>
          <span className="queue-progress">
            <Meter className="queue-meter" value={(100 * a.sites_submitted) / Math.max(1, a.sites_total)} />
            <span className="tnum">
              {a.sites_submitted} of {a.sites_total}
            </span>
          </span>
        </td>
        <td>
          <span className="queue-outstanding">
            <span className={`tnum${late ? ' is-late' : ''}`}>
              {a.days_outstanding} day{a.days_outstanding === 1 ? '' : 's'}
            </span>
            {late && <span className="pill pill-red">Late</span>}
          </span>
        </td>
        <td className="tnum">
          {a.sites_pending} site{a.sites_pending === 1 ? '' : 's'}
        </td>
      </tr>
      {open && (
        <tr className="queue-detail">
          <td />
          <td colSpan={6}>
            <div className="queue-detail-label">Still awaiting a result</div>
            <div className="tech-chips">
              {a.pending_sites.filter(Boolean).map((code) => (
                <span key={code} className="pill pill-dim">{code}</span>
              ))}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  )
}

function fmt(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10)
}
