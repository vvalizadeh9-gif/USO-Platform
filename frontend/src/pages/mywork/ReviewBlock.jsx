import { useState } from 'react'
import { Check } from 'lucide-react'
import { viewScan } from './api'
import { shown } from './roundText'

/**
 * A filed side, as a coordinator or PM checks it: the letter, who filed it,
 * the scan, and each technology's claim with its reason. Confirm records it
 * as decided; Return sends it back with a reason the contractor will read;
 * Confirm all decides every filed village on the same letter at once.
 */
export default function ReviewBlock({ round, contractor, sameLetter, onConfirm, onConfirmAll, onReturn, busy }) {
  const [returning, setReturning] = useState(false)
  const [reason, setReason] = useState('')
  const [tried, setTried] = useState(false)
  const missing = tried && !reason.trim()

  const sendBack = () => {
    if (!reason.trim()) {
      setTried(true)
      return
    }
    onReturn(reason.trim())
  }

  return (
    <div className="mw-review">
      <div className="mw-filed">
        <div className="mw-filed-head">
          <span className="mw-filed-letter mw-fa-ltr">{shown(round.letter_number)}</span>
          <span className="mw-filed-date mw-fa-ltr">{shown(round.letter_date_shamsi)}</span>
          <span className="mw-filed-by">{contractor || round.submitted_by_name}</span>
          {round.scan && (
            <button
              type="button"
              className="mw-link-btn"
              onClick={() => viewScan(round.scan.evidence_id, round.scan.filename).catch(() => {})}
            >
              View scan
            </button>
          )}
        </div>
        <ul className="mw-claims">
          {round.claims.map((claim) => (
            <li key={claim.tech} className="mw-claim">
              <span className="mw-pill" data-tone={claim.result === 'rejected' ? 'danger' : 'success'}>
                {claim.tech} {claim.result}
              </span>
              {claim.reason && <span className="mw-claim-reason" title={claim.reason}>{claim.reason}</span>}
            </li>
          ))}
        </ul>
      </div>
      {returning ? (
        <>
          <input
            className={`mw-input${missing ? ' is-invalid' : ''}`}
            aria-label="Why it goes back"
            aria-invalid={missing || undefined}
            placeholder={missing ? 'Reason missing' : 'Reason'}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
          />
          <div className="mw-actions">
            <button type="button" className="btn" onClick={() => { setReturning(false); setTried(false) }}>Cancel</button>
            <button type="button" className="btn mw-btn-danger-outline" onClick={sendBack} disabled={busy}>
              Return to contractor
            </button>
          </div>
        </>
      ) : (
        <div className="mw-actions">
          {sameLetter && sameLetter.count > 1 && (
            <button type="button" className="btn mw-confirm-all" onClick={onConfirmAll} disabled={busy}>
              Confirm all {sameLetter.count} on this letter
            </button>
          )}
          <button type="button" className="btn mw-btn-danger-text" onClick={() => setReturning(true)} disabled={busy}>
            Return
          </button>
          <span className="mw-grow" />
          <button type="button" className="btn btn-primary" onClick={onConfirm} disabled={busy}>
            <Check size={16} aria-hidden="true" />
            Confirm
          </button>
        </div>
      )}
    </div>
  )
}
