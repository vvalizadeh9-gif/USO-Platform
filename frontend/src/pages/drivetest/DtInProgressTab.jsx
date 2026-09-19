import { Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import ProvinceFilter from '../../components/ProvinceFilter'
import SiteHistoryDrawer, { SiteCodeButton } from '../../components/SiteHistoryDrawer'
import WaitingPill from '../../components/WaitingPill'
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
        <div className="row between wrap" style={{ gap: 12 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="Search site ID…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <ProvinceFilter
            options={provinceOptions}
            selected={provinceSel}
            onToggle={toggleProvince}
            onClear={() => setProvinceSel(new Set())}
          />
          <select
            className="input text-data"
            style={{ minWidth: 160 }}
            value={contractorFilter}
            onChange={(e) => setContractorFilter(e.target.value)}
          >
            <option value="">All contractors</option>
            {contractorOptions.map((name) => (
              <option key={name} value={name}>{name}</option>
            ))}
          </select>
        </div>
        <div className="row between" style={{ marginTop: 8 }}>
          <span className="dim" style={{ fontSize: 11.5 }}>Sorted: waiting longest first</span>
          {(query.trim() || provinceSel.size > 0 || contractorFilter) && (
            <span className="dim" style={{ fontSize: 11.5 }}>
              {filtered.length} of {rows.length}
            </span>
          )}
        </div>
      </div>

      <table>
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
                  <WaitingPill days={r.days_since_assigned} />
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
