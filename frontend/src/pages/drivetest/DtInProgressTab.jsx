import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import SiteHistoryDrawer, { SiteCodeButton } from '../../components/SiteHistoryDrawer'
import { EmptyState, Loading } from '../../components/ui'

/**
 * Sites out with a drive-test contractor, waiting on them.
 *
 * The step between Assignment and Review, and the one that had no screen. A
 * site handed to a contractor left the assignment queue and reached the review
 * queue only once something was submitted, so for however long that took it
 * appeared nowhere — "who is late" and "what did I send back" were both
 * unanswerable without opening sites one at a time.
 *
 * Read-only, deliberately. Every row here is waiting on the contractor, not on
 * the person reading it, so there is nothing to tick and nothing to press: a
 * bulk bar would offer an action that belongs to somebody else. The two things
 * a row has to say are how long it has been out, and whether a reviewer has
 * already sent it back.
 */
export default function DtInProgressTab({ onCountChange }) {
  const [rows, setRows] = useState(null)
  const [query, setQuery] = useState('')
  const [history, setHistory] = useState({ id: null, code: null })

  useEffect(() => {
    api
      .get('/hc/queues/dt-in-progress')
      .then((r) => {
        setRows(r.data)
        onCountChange?.(r.data.length)
      })
      .catch(() => setRows([]))
  }, [])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    if (!q) return rows
    return rows.filter((r) => (r.site_code || '').toLowerCase().includes(q))
  }, [rows, query])

  if (!rows) return <Loading label="Loading sites with contractors" />

  if (rows.length === 0) {
    return (
      <div className="card card-pad">
        <EmptyState
          title="Nothing with contractors right now"
          hint="Sites appear here once assigned, until the contractor submits the drive test."
        />
      </div>
    )
  }

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div style={{ position: 'relative' }}>
          <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }} />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Search site ID…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Site ID</th>
            <th>Province</th>
            <th>Contractor</th>
            <th>Status</th>
            <th>Since assigned</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((r) => {
            const sentBack = r.status === 'sent_back'
            return (
              <tr key={r.work_item_id}>
                <td>
                  <SiteCodeButton
                    workItemId={r.work_item_id}
                    siteCode={r.site_code}
                    onOpen={(id, code) => setHistory({ id, code })}
                  />
                </td>
                <td className="text-data dim">{r.province || '—'}</td>
                <td className="text-data dim">{r.contractor_name || '—'}</td>
                <td>
                  {/* Sent back is the one that needs chasing, so it is the one
                      that carries colour — and the reviewer's own words with
                      it, because "what did I send back" is half of why this
                      queue exists. */}
                  <span
                    className={`pill ${sentBack ? 'pill-red' : 'pill-dim'}`}
                    style={{ fontSize: 11.5 }}
                    title={sentBack ? r.sent_back_comment || undefined : undefined}
                  >
                    {sentBack ? 'Sent back' : 'With contractor'}
                  </span>
                  {sentBack && r.sent_back_comment && (
                    <div className="dim" style={{ fontSize: 11.5, marginTop: 4, maxWidth: 360 }}>
                      {r.sent_back_comment}
                    </div>
                  )}
                </td>
                <td>
                  <span className="tnum">{r.days_since_assigned}</span> days
                </td>
              </tr>
            )
          })}
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
