import { Search, Timer } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import ProvinceFilter from '../../components/ProvinceFilter'
import SiteHistoryDrawer, { SiteCodeButton } from '../../components/SiteHistoryDrawer'
import WaitingPill from '../../components/WaitingPill'
import { Card, EmptyState, Loading } from '../../components/ui'

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
  const [provinceSel, setProvinceSel] = useState(() => new Set())
  const [contractorFilter, setContractorFilter] = useState('')
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

  const provinceOptions = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map((r) => r.province).filter(Boolean))].sort()
  }, [rows])

  const contractorOptions = useMemo(() => {
    if (!rows) return []
    return [...new Set(rows.map((r) => r.contractor_name).filter(Boolean))].sort()
  }, [rows])

  const filtered = useMemo(() => {
    if (!rows) return []
    const q = query.trim().toLowerCase()
    return rows.filter((r) => {
      if (provinceSel.size && !provinceSel.has(r.province)) return false
      if (contractorFilter && r.contractor_name !== contractorFilter) return false
      if (!q) return true
      return (r.site_code || '').toLowerCase().includes(q)
    })
  }, [rows, query, provinceSel, contractorFilter])

  function toggleProvince(p) {
    setProvinceSel((s) => {
      const next = new Set(s)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  if (!rows) return <Loading label="Loading sites with contractors" />

  const filtering = query.trim() || provinceSel.size > 0 || contractorFilter

  return (
    <Card
      className="card-fill queue-card"
      icon={Timer}
      title="In progress"
      description="Out with a drive-test contractor, waiting on them. Sent back first, then longest waiting."
      actions={
        <>
          <label className="search-box">
            <Search size={16} aria-hidden="true" />
            <input
              className="input"
              placeholder="Search site ID…"
              aria-label="Search site ID"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </label>
          <ProvinceFilter
            options={provinceOptions}
            selected={provinceSel}
            onToggle={toggleProvince}
            onClear={() => setProvinceSel(new Set())}
          />
          <select
            className="input queue-select"
            aria-label="Contractor"
            value={contractorFilter}
            onChange={(e) => setContractorFilter(e.target.value)}
          >
            <option value="">All contractors</option>
            {contractorOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </>
      }
    >
      <div className="queue-toolbar">
        <span className="queue-meta">Sorted: waiting longest first</span>
        {filtering && (
          <span className="queue-meta tnum">
            {filtered.length} of {rows.length}
          </span>
        )}
      </div>

      {rows.length === 0 ? (
        <EmptyState
          title="Nothing with contractors right now"
          hint="Sites appear here once assigned, until the contractor submits the drive test."
        />
      ) : (
        <div className="table-scroll">
          <table className="table table-compact queue-table">
            <thead>
              <tr>
                <th>Site ID</th>
                <th>Province</th>
                <th>Contractor</th>
                <th>Status</th>
                <th>Waiting</th>
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
                    <td className="text-farsi">{r.province || '—'}</td>
                    <td className="text-farsi">{r.contractor_name || '—'}</td>
                    <td>
                      {/* Sent back is the one that needs chasing, so it is the
                          one that carries colour -- and the reviewer's own
                          words with it, because "what did I send back" is half
                          of why this queue exists. */}
                      <span
                        className={`pill ${sentBack ? 'pill-red' : 'pill-dim'}`}
                        title={sentBack ? r.sent_back_comment || undefined : undefined}
                      >
                        {sentBack ? 'Sent back' : 'With contractor'}
                      </span>
                      {sentBack && r.sent_back_comment && (
                        <div className="queue-note" dir="auto">{r.sent_back_comment}</div>
                      )}
                    </td>
                    <td>
                      <WaitingPill days={r.days_since_assigned} />
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}

      <SiteHistoryDrawer
        workItemId={history.id}
        siteCode={history.code}
        onClose={() => setHistory({ id: null, code: null })}
      />
    </Card>
  )
}
