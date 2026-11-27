import { Link } from 'react-router-dom'
import { StepError } from '../../components/work/parts'
import { todayIso } from '../../lib/dates'
import { formatNumber } from '../../lib/numbers'
import JourneyRibbon from './JourneyRibbon'
import VillageAcceptance from './VillageAcceptance'

/** Total aging's context: since the health check, or why there is no number. */
function totalContext(record) {
  if (record.journey.aging.total_days != null) return 'since health check'
  const check = record.journey.steps.find((s) => s.key === 'health_check')
  return check?.state === 'done' ? 'health check date unknown' : 'health check not done'
}

/** At most two numbers (UEP-28 §B3): total aging, and the oldest pending side. */
function JourneyStats({ record }) {
  const { total_days: total, oldest_pending: oldest } = record.journey.aging
  const stats = [
    { key: 'total', label: 'Total aging', value: total, context: totalContext(record) },
    oldest && {
      key: 'oldest',
      label: 'Oldest pending',
      value: oldest.days,
      context: `${oldest.authority} · ${oldest.villages} ${oldest.villages === 1 ? 'village' : 'villages'}`,
      waiting: true,
    },
  ].filter(Boolean)
  return (
    <dl className="exj-stats">
      {stats.map((s) => (
        <div key={s.key} className={`exj-stat ${s.waiting ? 'is-waiting' : ''}`.trim()}>
          <dt>{s.label}</dt>
          <dd>
            <b className="uw-num">{s.value != null ? formatNumber(s.value) : '—'}</b>
            {s.value != null && <small>days</small>}
            <span>{s.context}</span>
          </dd>
        </div>
      ))}
    </dl>
  )
}

/** The latest batch the site went to ICT HQ in, as a link (UEP-21 §5.9). */
function SentBatch({ sends }) {
  const last = sends?.[sends.length - 1]
  if (!last || last.outside_uep || last.batch_number == null) return null
  return (
    <Link className="exj-batch" to={`/submissions/batches/${last.batch_number}`}>
      Sent to ICT in batch #{last.batch_number}
    </Link>
  )
}

function JourneySkeleton() {
  return (
    <div className="exj-body" aria-hidden="true">
      <span className="h-skel exj-skel-ribbon" />
      <span className="h-skel exj-skel-table" />
    </div>
  )
}

/**
 * The Journey card (UEP-28 §B3–B5): its numbers, the timeline ribbon and
 * acceptance by village.
 */
export default function JourneyCard({ record, status, onRetry, highlight }) {
  return (
    <section className="hw-card exj" aria-labelledby="exj-title" aria-busy={status === 'loading' || undefined}>
      <header className="exj-head">
        <h2 id="exj-title" className="ex-card-title">Journey</h2>
        {record && <SentBatch sends={record.journey.sent_to_ict} />}
        {record && <JourneyStats record={record} />}
      </header>
      {status === 'error' ? (
        <StepError stepName="the journey" onRetry={onRetry} />
      ) : !record ? (
        <JourneySkeleton />
      ) : (
        <div className="exj-body">
          <JourneyRibbon record={record} today={todayIso()} />
          <VillageAcceptance
            villages={record.villages}
            counts={record.counts}
            started={record.acceptance_started}
            highlight={highlight}
          />
        </div>
      )}
    </section>
  )
}
