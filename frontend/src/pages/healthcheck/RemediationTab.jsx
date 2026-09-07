import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import SiteHistoryDrawer, { SiteCodeButton } from '../../components/SiteHistoryDrawer'
import { EmptyState, Loading } from '../../components/ui'
import { roleLabel } from '../../lib/roles'

/**
 * Every open fix, across every category.
 *
 * The owning teams already have their own queue; this is the view the people
 * who route the work never had. A PM or Coordinator saw remediation only as
 * individual overdue nudges in the Action Center, so the shape of what was
 * outstanding — which category is drowning, which site has two teams on it —
 * was not visible anywhere.
 *
 * Read-only on purpose. Closing a fix stays with the team doing it; a staff
 * user who genuinely needs to close one on their behalf still does it from the
 * fix itself, so this screen cannot become a way to tidy the board.
 */
export default function RemediationTab({ onCountChange }) {
  const [rows, setRows] = useState(null)
  const [category, setCategory] = useState('all')
  const [history, setHistory] = useState({ id: null, code: null })

  useEffect(() => {
    api
      .get('/hc/queues/remediations')
      .then((r) => {
        setRows(r.data)
        onCountChange?.(r.data.length)
      })
      .catch(() => setRows([]))
  }, [onCountChange])

  const categories = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map((r) => r.category).filter(Boolean))].sort()
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    return category === 'all' ? rows : rows.filter((r) => r.category === category)
  }, [rows, category])

  if (!rows) return <Loading label="Loading open problems" />

  if (rows.length === 0) {
    return (
      <div className="card card-pad">
        <EmptyState
          title="No open problems"
          hint="Sites appear here when a health check fails and gets routed to a team."
        />
      </div>
    )
  }

  const late = rows.filter((r) => r.days_late > 0).length

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div className="row wrap" style={{ gap: 8, alignItems: 'center' }}>
          <Chip active={category === 'all'} onClick={() => setCategory('all')}>
            All ({rows.length})
          </Chip>
          {categories.map((c) => (
            <Chip key={c} active={category === c} onClick={() => setCategory(c)}>
              {c} ({rows.filter((r) => r.category === c).length})
            </Chip>
          ))}
          {late > 0 && (
            <span className="pill pill-red" style={{ marginLeft: 'auto' }}>
              {late} past due
            </span>
          )}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Site ID</th>
            <th>Province</th>
            <th>Category</th>
            <th>Owning team</th>
            <th>Round</th>
            <th>Issue</th>
            <th>Open</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => (
            <tr key={r.id}>
              <td onClick={(e) => e.stopPropagation()}>
                <SiteCodeButton
                  workItemId={r.work_item_id}
                  siteCode={r.site_code}
                  onOpen={(id, code) => setHistory({ id, code })}
                />
              </td>
              <td className="text-data dim">{r.province || '—'}</td>
              <td>{r.category || '—'}</td>
              <td className="dim">{r.owner_role ? roleLabel(r.owner_role) : '—'}</td>
              <td className="tnum">{r.round_no}</td>
              <td style={{ maxWidth: 320 }}>
                {r.technologies.length > 0 && (
                  <b className="text-data" style={{ marginRight: 6 }}>
                    {r.technologies.join(', ')}:
                  </b>
                )}
                <span className="dim">{r.issue || 'No detail recorded'}</span>
              </td>
              <td>
                <span className="tnum">{r.days_open}d</span>
                {r.days_late > 0 && (
                  <span className="pill pill-red" style={{ marginLeft: 6, fontSize: 11 }}>
                    {r.days_late}d late
                  </span>
                )}
                {r.reroute_pending && (
                  <span className="pill pill-amber" style={{ marginLeft: 6, fontSize: 11 }}>
                    Disputed
                  </span>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />
    </div>
  )
}

function Chip({ active, onClick, children }) {
  return (
    <button
      className="btn btn-sm"
      onClick={onClick}
      style={{
        background: active ? 'var(--signal)' : 'var(--surface-2)',
        color: active ? '#fff' : 'var(--text-muted)',
        border: active ? 'none' : '1px solid var(--border)',
      }}
    >
      {children}
    </button>
  )
}
