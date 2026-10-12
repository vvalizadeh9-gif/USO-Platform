import { useId } from 'react'
import Icon from '../Icon'
import { shamsiDayLabel } from '../../lib/shamsi'
import { Fa, WaitingCell } from './parts'

const MIN_COMMENT = 3

/**
 * One drive-test submission, beside the review list (UEP-06 §5.2): the
 * facts, the report files, a comment for the contractor and the decision.
 * Send back needs a comment of at least three characters; the help text that
 * says so is linked to both the field and the button.
 */
export default function ReviewPanel({ row, slaDays, comment, onComment, onDecide, onDownload, busy }) {
  const helpId = useId()
  const fieldId = useId()
  if (!row) {
    return (
      <aside className="uw-review-panel is-empty" aria-label="Drive test">
        <p>Pick a site in the list to review its drive test.</p>
      </aside>
    )
  }
  const canSendBack = (comment || '').trim().length >= MIN_COMMENT
  return (
    <aside className="uw-review-panel" aria-label={`Drive test of ${row.site_code}`}>
      <header className="uw-review-head">
        <h2>{row.site_code}</h2>
        <p>
          {row.site_type || '—'} · <Fa>{row.province}</Fa> · <Fa>{row.contractor_name}</Fa>
        </p>
      </header>
      <dl className="uw-review-facts">
        <div>
          <dt>Carried out</dt>
          <dd>{shamsiDayLabel(row.execution_date) || '—'}</dd>
        </div>
        <div>
          <dt>Submitted</dt>
          <dd>{shamsiDayLabel(row.submitted_at) || '—'}</dd>
        </div>
        <div>
          <dt>Waiting</dt>
          <dd><WaitingCell days={row.days_waiting} slaDays={slaDays} /></dd>
        </div>
      </dl>
      <section className="uw-review-files" aria-label="Report">
        <h3>Report</h3>
        {row.evidence.length === 0 ? (
          <p className="uw-review-note">No report attached. Approve only if you have seen it elsewhere.</p>
        ) : (
          row.evidence.map((e) => (
            <button key={e.id} type="button" className="uw-btn uw-file" onClick={() => onDownload(e)}>
              <Icon name="attachment" size={16} />
              <span className="uw-file-name">{e.original_filename}</span>
              <span className="uw-file-size">{Math.max(1, Math.round(e.size_bytes / 1024))} KB</span>
            </button>
          ))
        )}
      </section>
      <div className="uw-review-comment">
        <label htmlFor={fieldId}>Comment for the contractor</label>
        <textarea
          id={fieldId}
          rows={3}
          value={comment || ''}
          aria-describedby={helpId}
          onChange={(e) => onComment(e.target.value)}
        />
        <p id={helpId} className="uw-help">To send back, add a comment of at least 3 characters.</p>
      </div>
      <footer className="uw-review-actions">
        <button
          type="button"
          className="uw-btn uw-btn-primary"
          disabled={busy}
          aria-busy={busy === 'Approved' || undefined}
          onClick={() => onDecide('Approved')}
        >
          <Icon name="checkmark" size={16} /> Approve
        </button>
        <button
          type="button"
          className="uw-btn uw-btn-danger"
          aria-disabled={!canSendBack || Boolean(busy) || undefined}
          aria-describedby={helpId}
          aria-busy={busy === 'Rejected' || undefined}
          onClick={() => canSendBack && !busy && onDecide('Rejected')}
        >
          Send back
        </button>
      </footer>
    </aside>
  )
}
