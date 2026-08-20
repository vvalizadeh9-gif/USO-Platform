import { motion } from 'framer-motion'
import { Search, ShieldCheck, Landmark } from 'lucide-react'
import { useCallback, useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { useAuth } from '../../context/AuthContext'
import { EmptyState, Loading, StatusPill } from '../../components/ui'
import VillageDrawer from './VillageDrawer'

const REVIEW_ROLES = ['PM', 'Coordinator']

// "Needs me" leads, because that is what the person opening this screen came
// to do. Everything else is one chip away.
const FILTERS = [
  { key: 'mine', label: 'Needs me' },
  { key: '', label: 'All' },
  { key: 'Pending', label: 'Pending' },
  { key: 'Approved', label: 'Approved' },
  { key: 'Rejected', label: 'Rejected' },
]

const SITE_CLASS = { Closed: 'is-closed', 'Open - Partial': 'is-partial' }

function Waiting({ days, verdict }) {
  // An approved village is not waiting for anything, so an ageing figure there
  // would read as a problem where there is none. Only villages still in play
  // carry a number, and only they turn amber and then red.
  if (verdict === 'Approved') return <span className="dim">—</span>
  if (days === null || days === undefined) return <span className="dim">not filed</span>
  const tone = days >= 30 ? 'var(--red)' : days >= 14 ? 'var(--amber)' : 'var(--text-muted)'
  return (
    <span className="acc-num" style={{ color: tone, fontWeight: days >= 14 ? 600 : 400 }}>
      {days === 0 ? 'today' : `${days}d`}
    </span>
  )
}

/**
 * Village-by-village acceptance — the screen contractors and coordinators live
 * in.
 *
 * Acceptance is granted per village and per technology, and a site closes only
 * when every one of its villages is approved, so this deliberately does not
 * roll up to one row per site.
 */
export default function VillageList() {
  const { user } = useAuth()
  const canReview = REVIEW_ROLES.includes(user?.role?.name)

  const [filter, setFilter] = useState('mine')
  const [search, setSearch] = useState('')
  const [query, setQuery] = useState('')
  const [data, setData] = useState(null)
  const [total, setTotal] = useState(null)
  const [openVillage, setOpenVillage] = useState(null)

  const load = useCallback(() => {
    const params = { limit: 300 }
    if (filter === 'mine') params.mine_only = true
    else if (filter) params.status = filter
    if (query) params.search = query
    api
      .get('/acceptance/villages', { params })
      .then((r) => setData(r.data))
      .catch(() => setData({ total: 0, rows: [] }))
  }, [filter, query])

  useEffect(load, [load])

  // The unfiltered count, so "Needs me" can be read against the whole book of
  // work rather than in isolation.
  useEffect(() => {
    api
      .get('/acceptance/villages', { params: { limit: 1 } })
      .then((r) => setTotal(r.data.total))
      .catch(() => setTotal(null))
  }, [])

  const emptyHint = useMemo(() => {
    if (filter === 'mine') {
      return canReview
        ? 'Nothing is waiting for your validation right now.'
        : 'Every village assigned to you is either filed or already approved.'
    }
    return 'Acceptance covers villages whose drive test is done.'
  }, [filter, canReview])

  if (!data) return <Loading label="Loading villages" />

  return (
    <>
      <div className="acc-bar mt-16">
        <div className="seg">
          {FILTERS.map((f) => (
            <button
              key={f.key || 'all'}
              aria-pressed={filter === f.key}
              onClick={() => setFilter(f.key)}
            >
              {f.label}
              {f.key === '' && total !== null && <span className="seg-count">{total}</span>}
            </button>
          ))}
        </div>

        <div className="spacer" />

        <form
          className="acc-search"
          onSubmit={(e) => { e.preventDefault(); setQuery(search.trim()) }}
        >
          <Search size={14} className="dim" />
          <input
            placeholder="Village or site code"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            aria-label="Search villages"
          />
        </form>
      </div>

      {data.rows.length === 0 ? (
        <div className="card card-pad mt-16">
          <EmptyState title="Nothing here" hint={emptyHint} />
        </div>
      ) : (
        <div className="card card-pad mt-16">
          <div className="table-wrap">
            <table className="acc-table">
              <thead>
                <tr>
                  <th>Village</th>
                  <th>Site</th>
                  <th>Province</th>
                  <th>Requested</th>
                  <th><span className="row" style={{ gap: 5 }}><ShieldCheck size={12} /> ICT</span></th>
                  <th><span className="row" style={{ gap: 5 }}><Landmark size={12} /> CRA</span></th>
                  <th>Final</th>
                  <th>Waiting</th>
                  <th aria-label="Open" />
                </tr>
              </thead>
              <tbody>
                {data.rows.map((row, i) => (
                  <motion.tr
                    key={row.village_id}
                    initial={{ opacity: 0 }}
                    animate={{ opacity: 1 }}
                    transition={{ delay: Math.min(i * 0.008, 0.18) }}
                    onClick={() => setOpenVillage(row.village_id)}
                    style={{ cursor: 'pointer' }}
                  >
                    <td>
                      <div className="acc-primary">{row.village_name || '—'}</div>
                      <div className="acc-secondary acc-num">{row.village_code}</div>
                    </td>
                    <td>
                      <div className="acc-num" style={{ fontSize: 13.5 }}>{row.site_code}</div>
                      <div className={`acc-site-state ${SITE_CLASS[row.site_status] || ''}`}>
                        {row.site_status}
                      </div>
                    </td>
                    <td style={{ fontSize: 13.5 }}>{row.province_name || '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {row.requested_technologies.map((t) => (
                        <span key={t} className="tech-chip">{t}</span>
                      ))}
                    </td>
                    <td><StatusPill status={row.ict_verdict} /></td>
                    <td><StatusPill status={row.cra_verdict} /></td>
                    <td><StatusPill status={row.verdict} /></td>
                    <td><Waiting days={row.waiting_days} verdict={row.verdict} /></td>
                    <td style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                      {row.returned_authorities.length > 0 ? (
                        <span className="acc-flag is-returned">
                          {row.returned_authorities.join('/')} returned
                        </span>
                      ) : row.pending_authorities.length > 0 ? (
                        <span className="acc-flag is-review">
                          {row.pending_authorities.join('/')} in review
                        </span>
                      ) : null}
                    </td>
                  </motion.tr>
                ))}
              </tbody>
            </table>
          </div>

          <div className="dim mt-8" style={{ fontSize: 12 }}>
            {data.rows.length} {data.rows.length === 1 ? 'village' : 'villages'}
            {total !== null && filter !== '' ? ` of ${total}` : ''}
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
