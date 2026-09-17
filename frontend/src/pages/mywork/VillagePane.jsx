import { useCallback, useEffect, useMemo, useState } from 'react'
import { MapPin } from 'lucide-react'
import api from '../../api/client'
import { Loading } from '../../components/ui'
import AuthorityBlock from './AuthorityBlock'
import HistoryDrawer from './HistoryDrawer'
import { ROLLUP_PILL } from './status'

const AUTHORITIES = ['ICT', 'CRA']

/**
 * The right pane: one village, and the one thing to do about it.
 *
 * ICT and CRA are stacked, one block each, because they are two separate
 * letters from two separate offices and each is filed on its own. The block
 * that needs attention is on top and open; the other is closed but can be
 * opened to read what was accepted. Nothing has to be chosen first — the
 * person fills in the block they have a letter for.
 */
export default function VillagePane({ villageId, canReview, onDone, onSkip, onError }) {
  const [detail, setDetail] = useState(null)
  const [failed, setFailed] = useState(false)
  const [historyOpen, setHistoryOpen] = useState(false)
  // Only the blocks the reader has opened or closed by hand. Everything else
  // follows what is actionable, which changes as rounds are filed and decided.
  const [toggled, setToggled] = useState({})

  const load = useCallback(() => {
    setFailed(false)
    return api
      .get(`/acceptance/villages/${villageId}`)
      .then((r) => {
        setDetail(r.data)
        return r.data
      })
      .catch(() => setFailed(true))
  }, [villageId])

  useEffect(() => {
    setDetail(null)
    setToggled({})
    load()
  }, [load])

  const village = detail?.village
  const submissions = useMemo(() => detail?.submissions || [], [detail])

  // Which authority this person is here to act on. A reviewer acts on a round
  // that is waiting; a submitter on an authority still open to a letter.
  const actionable = useMemo(() => {
    if (!village) return []
    if (canReview) {
      return AUTHORITIES.filter((a) =>
        submissions.some((s) => s.authority === a && s.review_status === 'Pending')
      )
    }
    return AUTHORITIES.filter((a) => village.can_submit.includes(a))
  }, [village, submissions, canReview])

  // Attention first: a returned or rejected authority outranks an unfiled one,
  // because someone is waiting on it. Ties keep ICT before CRA — sort is
  // stable, so equal ranks stay in the order above.
  const ordered = useMemo(() => {
    if (!village) return []
    return [...AUTHORITIES].sort((a, b) => rank(village, b) - rank(village, a))
  }, [village])

  if (failed) {
    return (
      <div className="card card-pad">
        <div className="empty">Could not load this village.</div>
      </div>
    )
  }
  if (!detail) {
    return (
      <div className="card">
        <Loading label="Loading village" />
      </div>
    )
  }

  const rounds = submissions.length

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16, minWidth: 0 }}>
      <section className="card card-pad">
        <div className="row between village-head" style={{ alignItems: 'flex-start', gap: 16 }}>
          {/* flex:1 so the 24px village name has the card's width to wrap
              into. Left to size itself, the block takes the width of its
              narrowest line and the name spills out of it. */}
          <div style={{ minWidth: 0, flex: 1 }}>
            <div className="caps" style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <MapPin size={12} />
              Village · Site {village.site_code || '—'} · {village.province_name || 'Unknown province'}
            </div>
            <h2 className="village-name" style={{ marginTop: 6 }}>
              {village.village_name || village.village_code || 'Village'}
            </h2>
            <div className="muted" style={{ fontSize: 12.5, marginTop: 6 }}>
              Requested {village.requested_technologies.join(' · ') || '—'}
              {detail.dt_status ? ` · Drive test ${detail.dt_status.toLowerCase()}` : ''}
            </div>
          </div>

          <div style={{ textAlign: 'right', flexShrink: 0 }}>
            <div className="caps">Village status</div>
            <div style={{ marginTop: 5 }}>
              <span className={`pill ${ROLLUP_PILL[village.village_status] || 'pill-dim'}`}>
                {village.village_status}
              </span>
            </div>
          </div>
        </div>
      </section>

      <section className="card">
        {ordered.map((name) => (
          <AuthorityBlock
            key={name}
            village={village}
            authority={name}
            status={name === 'ICT' ? village.ict_status : village.cra_status}
            rounds={submissions.filter((s) => s.authority === name)}
            mode={canReview ? 'review' : 'submit'}
            expanded={toggled[name] ?? actionable.includes(name)}
            onToggle={() =>
              setToggled((cur) => ({
                ...cur,
                [name]: !(cur[name] ?? actionable.includes(name)),
              }))
            }
            onDone={onDone}
            onError={onError}
            onRefresh={load}
          />
        ))}

        {actionable.length === 0 && (
          <div className="empty" style={{ padding: '26px 20px' }}>
            {canReview
              ? 'Nothing here is waiting for your validation.'
              : 'Nothing to file for this village. It is either approved or already with a reviewer.'}
          </div>
        )}

        <div className="form-foot">
          <button className="btn btn-sm btn-ghost" onClick={() => setHistoryOpen(true)} disabled={rounds === 0}>
            {rounds === 0 ? 'No past rounds' : `View ${rounds} past round${rounds === 1 ? '' : 's'}`}
          </button>
          <span className="spacer" />
          <button className="btn btn-sm" onClick={onSkip}>Next village</button>
        </div>
      </section>

      {historyOpen && (
        <HistoryDrawer
          village={village}
          submissions={submissions}
          onClose={() => setHistoryOpen(false)}
        />
      )}
    </div>
  )
}

/** Returned and rejected come first: someone is waiting on those. */
function rank(village, authority) {
  const status = authority === 'ICT' ? village.ict_status : village.cra_status
  return { Returned: 3, Rejected: 2, NotFiled: 1 }[status] || 0
}
