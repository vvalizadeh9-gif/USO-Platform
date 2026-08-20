import { ShieldCheck, Landmark, Clock } from 'lucide-react'
import { useCallback, useEffect, useState } from 'react'
import api from '../../api/client'
import { EmptyState, Loading } from '../../components/ui'
import LetterRef from './LetterRef'
import VillageDrawer from './VillageDrawer'

const AUTHORITY_ICON = { ICT: ShieldCheck, CRA: Landmark }

function waitingDays(since) {
  const then = new Date(since)
  if (Number.isNaN(then.getTime())) return null
  return Math.floor((Date.now() - then.getTime()) / 86400000)
}

/**
 * What is waiting for a coordinator or PM to validate.
 *
 * Ordered oldest first: a submission nobody has looked at for a fortnight is
 * the one holding a village up, and it should be the one you see.
 */
export default function ReviewQueue() {
  const [queue, setQueue] = useState(null)
  const [openVillage, setOpenVillage] = useState(null)

  const load = useCallback(() => {
    api.get('/acceptance/queue').then((r) => setQueue(r.data)).catch(() => setQueue([]))
  }, [])
  useEffect(load, [load])

  if (!queue) return <Loading label="Loading the review queue" />

  if (queue.length === 0) {
    return (
      <div className="card card-pad mt-16">
        <EmptyState
          title="Nothing waiting for review"
          hint="Submissions from contractors and coordinators appear here."
        />
      </div>
    )
  }

  return (
    <>
      <div className="card mt-16">
        <div className="table-wrap">
          <table>
            <thead>
              <tr>
                <th>Authority</th>
                <th>Village</th>
                <th>Site</th>
                <th>Letter</th>
                <th>Claimed</th>
                <th>Submitted by</th>
                <th>Waiting</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {queue.map((s) => {
                const Icon = AUTHORITY_ICON[s.authority]
                const days = waitingDays(s.submitted_at)
                return (
                  <tr key={s.id}>
                    <td>
                      <span className="row" style={{ gap: 6 }}>
                        <Icon size={13} /> {s.authority}
                        {s.round_no > 1 && (
                          <span className="dim" style={{ fontSize: 11.5 }}>round {s.round_no}</span>
                        )}
                      </span>
                    </td>
                    <td>
                      <div style={{ fontWeight: 600 }}>{s.village_name || '—'}</div>
                      <div className="dim" style={{ fontSize: 11.5 }}>{s.village_code}</div>
                    </td>
                    <td>
                      <div>{s.site_code}</div>
                      <div className="dim" style={{ fontSize: 11.5 }}>{s.province_name || '—'}</div>
                    </td>
                    <td>
                      <div><LetterRef value={s.letter_number} /></div>
                      <div className="dim" style={{ fontSize: 11.5 }}>
                        <LetterRef value={s.letter_date_shamsi} />
                      </div>
                    </td>
                    <td>
                      <div className="row wrap" style={{ gap: 4 }}>
                        {s.technologies.map((t) => (
                          <span
                            key={t.technology}
                            className={`pill ${t.claimed_status === 'Approved' ? 'pill-green' : 'pill-red'}`}
                          >
                            {t.technology}
                          </span>
                        ))}
                      </div>
                    </td>
                    <td>
                      <div>{s.submitted_by_name || '—'}</div>
                      <div className="dim" style={{ fontSize: 11.5 }}>{s.source}</div>
                    </td>
                    <td>
                      <span className={`pill ${days >= 7 ? 'pill-amber' : 'pill-dim'}`}>
                        <Clock size={11} style={{ marginRight: 4 }} />
                        {days === 0 ? 'today' : `${days}d`}
                      </span>
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      <button className="btn btn-sm btn-primary" onClick={() => setOpenVillage(s.village_id)}>
                        Review
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>

      <VillageDrawer
        villageId={openVillage}
        canReview
        onClose={() => setOpenVillage(null)}
        onChanged={load}
      />
    </>
  )
}
