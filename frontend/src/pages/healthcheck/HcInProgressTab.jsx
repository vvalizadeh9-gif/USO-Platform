import { ChevronDown, ChevronRight } from 'lucide-react'
import { Fragment, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading } from '../../components/ui'

/**
 * Health checks currently out with a subcontractor.
 *
 * This fills a gap rather than adding a feature: between assignment and
 * submission a site had left the pool and reached no results table, so it was
 * visible on no screen at all. The only trace was the assignment-level history
 * tab, which the Coordinator could not open — meaning the role that assigns
 * health checks could not see which of them were late.
 *
 * Read-only, longest outstanding first. There is nothing to do here except
 * know who to chase.
 */
export default function HcInProgressTab({ onCountChange }) {
  const [rows, setRows] = useState(null)
  const [expanded, setExpanded] = useState(() => new Set())

  useEffect(() => {
    api
      .get('/hc/queues/in-progress')
      .then((r) => {
        setRows(r.data)
        onCountChange?.(r.data.reduce((n, a) => n + a.sites_pending, 0))
      })
      .catch(() => setRows([]))
  }, [onCountChange])

  const toggle = (id) =>
    setExpanded((prev) => {
      const next = new Set(prev)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })

  if (!rows) return <Loading label="Loading health checks in progress" />

  if (rows.length === 0) {
    return (
      <div className="card card-pad">
        <EmptyState
          title="No health checks outstanding"
          hint="Every assigned site has reported back."
        />
      </div>
    )
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <table>
        <thead>
          <tr>
            <th style={{ width: 28 }}></th>
            <th>Assignment</th>
            <th>Subcontractor</th>
            <th>Assigned</th>
            <th>Submitted</th>
            <th>Outstanding</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((a) => {
            const isOpen = expanded.has(a.assignment_id)
            // Nothing shouts until it has actually been a while. A row still
            // inside a normal turnaround stays quiet.
            const late = a.days_outstanding > 14
            return (
              <Fragment key={a.assignment_id}>
                <tr onClick={() => toggle(a.assignment_id)} style={{ cursor: 'pointer' }}>
                  <td style={{ color: 'var(--text-dim)' }}>
                    {isOpen ? <ChevronDown size={15} /> : <ChevronRight size={15} />}
                  </td>
                  <td style={{ fontWeight: 500 }}>{a.code}</td>
                  <td className="text-data">{a.contractor_name || '—'}</td>
                  <td className="dim" style={{ fontSize: 12.5 }}>{fmt(a.assigned_at)}</td>
                  <td className="tnum">
                    {a.sites_submitted}/{a.sites_total}
                  </td>
                  <td>
                    <span
                      className="tnum"
                      style={{ color: late ? 'var(--red)' : undefined, fontWeight: late ? 600 : 400 }}
                    >
                      {a.days_outstanding} day{a.days_outstanding === 1 ? '' : 's'}
                    </span>
                    <span className="dim" style={{ marginLeft: 8, fontSize: 12.5 }}>
                      {a.sites_pending} site{a.sites_pending === 1 ? '' : 's'} pending
                    </span>
                  </td>
                </tr>
                {isOpen && (
                  <tr>
                    <td></td>
                    <td colSpan={5} style={{ background: 'var(--surface-2)', padding: '10px 14px' }}>
                      <div className="dim" style={{ fontSize: 12, marginBottom: 6 }}>
                        Still awaiting a result
                      </div>
                      <div className="row wrap" style={{ gap: 6 }}>
                        {a.pending_sites.filter(Boolean).map((code) => (
                          <span key={code} className="pill pill-dim text-data" style={{ fontSize: 11.5 }}>
                            {code}
                          </span>
                        ))}
                      </div>
                    </td>
                  </tr>
                )}
              </Fragment>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

function fmt(value) {
  if (!value) return '—'
  const d = new Date(value)
  return Number.isNaN(d.getTime()) ? '—' : d.toISOString().slice(0, 10)
}
