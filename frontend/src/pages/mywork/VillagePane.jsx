import { useCallback, useEffect, useMemo, useState } from 'react'
import { Landmark, MapPin, ShieldCheck } from 'lucide-react'
import api from '../../api/client'
import LetterRef from '../../components/LetterRef'
import { Loading } from '../../components/ui'
import HistoryDrawer from './HistoryDrawer'
import SubmissionForm from './SubmissionForm'
import {
  AUTHORITY_LABEL,
  AUTHORITY_PILL,
  AUTHORITY_TONE,
  AUTHORITY_WHERE,
  ROLLUP_PILL,
} from './status'

const AUTHORITIES = ['ICT', 'CRA']
const ICONS = { ICT: ShieldCheck, CRA: Landmark }

function shortDate(value) {
  if (!value) return ''
  const d = new Date(value)
  return Number.isNaN(d.getTime())
    ? ''
    : d.toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: 'numeric' })
}

/**
 * The right pane: one village, and the one thing to do about it.
 *
 * ICT and CRA are shown side by side because that is the question — where does
 * this village stand — and only one of them is ever being acted on at a time,
 * so the form below names which.
 */
export default function VillagePane({ villageId, canReview, onDone, onSkip, onError }) {
  const [detail, setDetail] = useState(null)
  const [failed, setFailed] = useState(false)
  const [authority, setAuthority] = useState(null)
  const [historyOpen, setHistoryOpen] = useState(false)

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
    load()
  }, [load])

  const village = detail?.village
  const submissions = detail?.submissions || []

  // Which authority this person is here to act on. A returned or rejected one
  // outranks an unfiled one, because it is the one someone is waiting for.
  const actionable = useMemo(() => {
    if (!village) return []
    if (canReview) {
      return AUTHORITIES.filter((a) =>
        submissions.some((s) => s.authority === a && s.review_status === 'Pending')
      )
    }
    const open = AUTHORITIES.filter((a) => village.can_submit.includes(a))
    return open.sort((a, b) => rank(village, b) - rank(village, a))
  }, [village, submissions, canReview])

  const active = authority && actionable.includes(authority) ? authority : actionable[0]

  useEffect(() => setAuthority(null), [villageId])

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

        <div
          className="grid authority-grid mt-16"
          style={{ gridTemplateColumns: 'repeat(2, minmax(0, 1fr))', gap: 12 }}
        >
          {AUTHORITIES.map((name) => (
            <AuthorityCard
              key={name}
              authority={name}
              status={name === 'ICT' ? village.ict_status : village.cra_status}
              rounds={submissions.filter((s) => s.authority === name)}
            />
          ))}
        </div>
      </section>

      <SubmissionForm
        village={village}
        submissions={submissions}
        authority={active}
        choices={actionable}
        onAuthority={setAuthority}
        mode={canReview ? 'review' : 'submit'}
        onHistory={() => setHistoryOpen(true)}
        onDone={onDone}
        onSkip={onSkip}
        onError={onError}
        onRefresh={load}
      />

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

function AuthorityCard({ authority, status, rounds }) {
  const Icon = ICONS[authority]
  const latest = rounds[0]
  const returned = latest?.review_status === 'Returned' ? latest : null

  return (
    <div className={`surface-soft auth-card ${AUTHORITY_TONE[status] || 'is-idle'}`}>
      <div className="who">
        <Icon size={15} />
        <div style={{ minWidth: 0 }}>
          <div className="role">{authority}</div>
          <div className="where">{AUTHORITY_WHERE[authority]}</div>
        </div>
        <span className="spacer" />
        <span className={`pill ${AUTHORITY_PILL[status] || 'pill-dim'}`}>
          {AUTHORITY_LABEL[status] || status}
        </span>
      </div>

      <div className="letter">
        {latest ? (
          <>
            Letter <LetterRef value={latest.letter_number} />
            {latest.letter_date_shamsi ? (
              <>
                {' · '}
                <LetterRef value={latest.letter_date_shamsi} />
              </>
            ) : null}
            {' · round '}
            {latest.round_no}
          </>
        ) : (
          <span className="dim">No {authority} letter filed yet.</span>
        )}
      </div>

      {returned && (
        <div className="reason" style={{ marginTop: 10 }}>
          <strong>Returned by {returned.reviewed_by_name || 'a reviewer'}</strong>
          {returned.reviewed_at ? ` on ${shortDate(returned.reviewed_at)}` : ''}.{' '}
          {returned.review_comment}
        </div>
      )}
    </div>
  )
}
