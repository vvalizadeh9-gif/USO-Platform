// Filing's right column (UEP-22 §3.1): the case's timeline, written by every
// save. Event dates are Gregorian ("18 Sep"); letter dates Shamsi in Persian.
import { formatDayMonth } from '../../lib/dates'
import { toPersianDigits } from '../../lib/persianDigits'
import { viewScan } from '../mywork/api'

const dotClass = (step) => {
  if (step.kind === 'now') return `is-now is-${step.state}`
  if (step.kind === 'rejected') return 'is-rejected'
  if (step.kind === 'approved') return 'is-approved'
  if (step.kind === 'submitted' || step.kind === 'fixed') return 'is-waiting'
  if (step.kind === 'comment') return 'is-comment'
  return 'is-neutral'
}

function Letter({ letter }) {
  if (!letter) return null
  const parts = [letter.no && `Letter ${toPersianDigits(letter.no)}`, letter.date_shamsi && toPersianDigits(letter.date_shamsi)]
    .filter(Boolean).join(' · ')
  return (
    <span className="fl-step-sub fa">
      {parts}
      {letter.evidence_id && (
        <button type="button" className="fl-link" onClick={() => viewScan(letter.evidence_id, 'letter').catch(() => {})}>
          View letter
        </button>
      )}
    </span>
  )
}

function Step({ step, last }) {
  const delta = step.status_step && step.delta_days != null && step.kind !== 'dt'
  return (
    <li className="fl-step">
      <span className="fl-step-delta">
        {delta && <span className={`fl-delta${step.kind === 'now' ? (step.over_sla ? ' is-late' : ' is-now') : ''}`}>+{step.delta_days} d</span>}
      </span>
      <span className="fl-step-rail" aria-hidden="true">
        <span className={`fl-step-dot ${dotClass(step)}`} />
        {!last && <span className="fl-step-line" />}
      </span>
      <div className="fl-step-body">
        <div className="fl-step-head">
          <span className={`fl-step-title${step.kind === 'rejected' ? ' is-rejected' : ''}${step.kind === 'comment' ? ' is-comment' : ''}${step.kind === 'now' && step.over_sla ? ' fl-danger' : ''}`}>
            {step.title}
          </span>
          <span className="fl-step-date">{step.kind === 'now' ? 'Today' : formatDayMonth(step.date)}</span>
        </div>
        {step.sub && <span className="fl-step-sub">{step.sub}</span>}
        <Letter letter={step.letter} />
        {step.note && <span className="fl-step-note">{step.note}</span>}
      </div>
    </li>
  )
}

export default function HistoryPanel({ authority, history, error, onRetry }) {
  return (
    <section className="fl-history" aria-label={`${authority} history`}>
      <div className="fl-history-head">
        <span>
          <h2 className="fl-history-title">{authority} history</h2>
          {history && (
            <span className="fl-history-sub">
              {history.dt_legacy ? 'Imported from CPM' : 'DT approved'} {formatDayMonth(history.dt_date)}
            </span>
          )}
        </span>
        {history && (
          <span className="fl-history-total">
            <span className="fl-history-days">{history.days_since_dt} d</span>
            <span className="fl-history-sub">since DT</span>
          </span>
        )}
      </div>
      <div className="fl-history-list">
        {error && (
          <div className="fl-error" role="alert">
            <span>{error}</span>
            <button type="button" className="uw-btn uw-btn-sm" onClick={onRetry}>Retry</button>
          </div>
        )}
        {!history && !error && <div className="fl-skeleton" aria-hidden="true">{[0, 1, 2, 3].map((i) => <span key={i} className="fl-skel-row" />)}</div>}
        {history && (
          <ol className="fl-steps">
            {history.steps.map((step, i) => <Step key={`${step.kind}-${i}`} step={step} last={i === history.steps.length - 1} />)}
          </ol>
        )}
      </div>
    </section>
  )
}
