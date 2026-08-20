import { motion } from 'framer-motion'
import { Search, Filter, ShieldCheck, Landmark } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading, StatusPill } from '../../components/ui'
import VillageDrawer from './VillageDrawer'

const SITE_CLASS = {
  Closed: 'pill-green',
  'Open - Partial': 'pill-amber',
  Open: 'pill-dim',
}

const FILTERS = [
  { key: '', label: 'All' },
  { key: 'Pending', label: 'Pending' },
  { key: 'Approved', label: 'Approved' },
  { key: 'Rejected', label: 'Rejected' },
]

/**
 * Village-by-village acceptance.
 *
 * The list is the unit of work: acceptance is granted per village and per
 * technology, and a site is only closed once every one of its villages is
 * approved, so this deliberately does not roll up to one row per site.
 */
export default function VillageList({ canReview, mineOnly, emptyHint }) {
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [openVillage, setOpenVillage] = useState(null)

  const load = useCallback(() => {
    const params = { limit: 200 }
    if (status) params.status = status
    if (query) params.search = query
    if (mineOnly) params.mine_only = true
    api
      .get('/acceptance/villages', { params })
      .then((r) => setData(r.data))
      .catch(() => setData({ total: 0, rows: [] }))
  }, [status, query, mineOnly])

  useEffect(load, [load])

  if (!data) return <Loading label="Loading villages" />

  return (
    <>
      <div className="card card-pad mt-16">
        <div className="row wrap" style={{ gap: 10 }}>
          <div className="row" style={{ gap: 6 }}>
            <Filter size={14} className="dim" />
            {FILTERS.map((f) => (
              <button
                key={f.key || 'all'}
                className={`btn btn-sm ${status === f.key ? 'btn-primary' : ''}`}
                onClick={() => setStatus(f.key)}
              >
                {f.label}
              </button>
            ))}
          </div>
          <div className="spacer" />
          <form
            className="row" style={{ gap: 6 }}
            onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()) }}
          >
            <input
              className="input" style={{ minWidth: 220 }}
              placeholder="Village or site code"
              value={search} onChange={(e) => setSearch(e.target.value)}
            />
            <button className="btn btn-sm" type="submit"><Search size={14} /></button>
          </form>
        </div>
      </div>

      {data.rows.length === 0 ? (
        <div className="card card-pad mt-16">
          <EmptyState
            title="No villages here"
            hint={emptyHint || 'Acceptance covers villages whose drive test is done.'}
          />
        </div>
      ) : (
        <div className="card mt-16">
          <div className="table-wrap">
            <table>
              <thead>
                <tr>
                  <th>Village</th>
                  <th>Site</th>
                  <th>Requested</th>
                  <th><span className="row" style={{ gap: 5 }}><ShieldCheck size={13} /> ICT</span></th>
                  <th><span className="row" style={{ gap: 5 }}><Landmark size={13} /> CRA</span></th>
                  <th>Village</th>
                  <th>Site status</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <motion.tr
                    key={row.village_id}
                    initial={{ opacity: 0 }} animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.01, 0.2) }}
                  >
                    <td>
                      <div style={{ fontWeight: 600 }}>{row.village_name || '—'}</div>
                      <div className="dim" style={{ fontSize: 11.5 }}>{row.village_code}</div>
                    </td>
                    <td>
                      <div>{row.site_code}</div>
                      <div className="dim" style={{ fontSize: 11.5 }}>{row.province_name || '—'}</div>
                    </td>
                    <td>
                      <div className="row" style={{ gap: 4 }}>
                        {row.requested_technologies.map((t) => (
                          <span key={t} className="pill pill-dim">{t}</span>
                        ))}
                      </div>
                    </td>
                    <td><StatusPill status={row.ict_verdict} /></td>
                    <td><StatusPill status={row.cra_verdict} /></td>
                    <td><StatusPill status={row.verdict} /></td>
                    <td>
                      <span className={`pill ${SITE_CLASS[row.site_status] || 'pill-dim'}`}>
                        {row.site_status}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {row.pending_authorities.length > 0 && (
                        <span className="pill pill-amber" style={{ marginRight: 6 }}>
                          {row.pending_authorities.join('/')} in review
                        </span>
                      )}
                      {row.returned_authorities.length > 0 && (
                        <span className="pill pill-red" style={{ marginRight: 6 }}>
                          {row.returned_authorities.join('/')} returned
                        </span>
                      )}
                      <button className="btn btn-sm" onClick={() => setOpenVillage(row.village_id)}>
                        Open
                      </button>
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="dim" style={{ padding: '10px 14px', fontSize: 12 }}>
            {data.rows.length} of {data.total} villages
          </div>
        </div>
      )}

      <VillageDrawer
        villageId={openVillage}
        canReview={canReview}
        onClose={() => setOpenVillage(null)}
        onChanged={load}
      />
    </>
  )
}
