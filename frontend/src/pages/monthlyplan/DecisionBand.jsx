import { useId } from 'react'
import Icon from '../../components/Icon'
import { signedNumber } from './history'
import { Chip } from './parts'
import { decisionLabel } from './planBoard'
import Stepper from './Stepper'

const STATUS = {
  waiting: { tone: 'neutral', word: 'Waiting' },
  approved: { tone: 'approved', word: 'Approved' },
  notFiled: { tone: 'danger', word: 'Not filed' },
}

const MAX_COMMENT = 1000

/**
 * One stream of the selected contractor: DT delivery or Acceptance. A band is
 * a full-width card, the two stacked and sharing the height.
 *
 * Left to right: the title and status; what was asked; the PM's decision (a
 * stepper, no typing); a comment that opens only when the number differs from
 * what was asked, and the one cobalt button. A decided stream shows the plan
 * in force instead, a stream nobody filed shows only that.
 *
 * `decision` is `{ value, comment }` or undefined; the page owns it because
 * the KPI bar above reads the same numbers.
 */
export default function DecisionBand({ title, contractor, cell, decision, canDecide, busy, onValue, onComment, onSubmit }) {
  const ids = { title: useId(), comment: useId() }
  const status = STATUS[cell.state]
  const waiting = cell.state === 'waiting'
  const value = decision?.value ?? cell.asked
  const comment = decision?.comment ?? ''
  const changed = waiting && value !== cell.asked
  const blocked = busy || (changed && !comment.trim())

  return (
    <section className="mp2-band" aria-labelledby={ids.title} data-state={cell.state}>
      <div className="mp2-band-title">
        <h2 id={ids.title}>{title}</h2>
        <Chip tone={status.tone}>{status.word}</Chip>
      </div>

      {waiting && (
        <>
          <div className="mp2-asked">
            <span className="mp2-label">Asked</span>
            <span className="mp2-big tnum">{cell.asked}</span>
          </div>
          {canDecide && (
            <>
              <div className="mp2-decision">
                <div className="mp2-decision-head">
                  <span className="mp2-label">Your decision</span>
                  <Chip tone={changed ? 'accent' : 'neutral'}>{changed ? `${signedNumber(value - cell.asked)} vs asked` : 'As asked'}</Chip>
                </div>
                <Stepper
                  value={value}
                  onChange={onValue}
                  changed={changed}
                  disabled={busy}
                  label={`${title}, ${contractor}`}
                />
              </div>
              <div className="mp2-act">
                {changed && (
                  <div className="mp2-comment">
                    <label htmlFor={ids.comment}>
                      Comment <span className="mp2-required">Required</span>
                    </label>
                    <textarea
                      id={ids.comment}
                      rows={3}
                      value={comment}
                      maxLength={MAX_COMMENT}
                      disabled={busy}
                      aria-required="true"
                      onChange={(e) => onComment(e.target.value)}
                    />
                  </div>
                )}
                <button type="button" className="mp2-primary" disabled={blocked} onClick={onSubmit}>
                  {busy ? 'Saving…' : decisionLabel(cell.asked, value)}
                </button>
              </div>
            </>
          )}
        </>
      )}

      {cell.state === 'approved' && (
        <div className="mp2-decided">
          <span className="mp2-tick" aria-hidden="true">
            <Icon name="checkmark" size={20} />
          </span>
          <div>
            <span className="mp2-label">Plan in force</span>
            <span className="mp2-big tnum">{cell.number}</span>
          </div>
          <p className="mp2-note">
            {cell.changedFrom != null && cell.changedFrom !== cell.number
              ? `Asked ${cell.changedFrom}, changed to ${cell.number}${cell.comment ? ` — ${cell.comment}` : ''}`
              : 'Confirmed as asked'}
          </p>
        </div>
      )}

      {cell.state === 'notFiled' && <p className="mp2-notfiled">Not filed</p>}
    </section>
  )
}

/** Two bands' worth of skeleton while the board loads. */
export function BandSkeleton() {
  return (
    <>
      <div className="mp2-band mp2-skel" aria-hidden="true" />
      <div className="mp2-band mp2-skel" aria-hidden="true" />
    </>
  )
}
