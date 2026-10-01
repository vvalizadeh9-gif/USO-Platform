import { Send } from 'lucide-react'
import { useState } from 'react'
import { toLatinDigits } from '../../lib/persianDigits'
import { sendToAuthority } from './api'

const OUTCOME_TEXT = {
  already_with_authority: 'is already with the authority',
  not_requestable: 'does not need a request in its current state',
  not_found: 'could not be found',
}

/**
 * "Sent to ICT": record that the request letter for this side went out.
 *
 * From then until the authority's answer is filed, the village is on the
 * staff "With authority" tab and on the PM's Action Center follow-up ticket.
 * The letter number is optional -- not every office numbers what it receives.
 */
export default function SendToAuthority({ authority, villageId }) {
  const [open, setOpen] = useState(false)
  const [number, setNumber] = useState('')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState(null)

  const record = () => {
    setBusy(true)
    sendToAuthority({
      authority,
      village_ids: [villageId],
      letter_number: toLatinDigits(number).trim() || null,
    })
      .then((result) => {
        const outcome = result.outcomes[0]
        setMessage(outcome.recorded
          ? { tone: 'ongoing', text: `Recorded as sent to ${authority}. It stays with ${authority} until the answer is filed.` }
          : { tone: 'neutral', text: `This village ${OUTCOME_TEXT[outcome.reason] || 'was not recorded'}.` })
        setOpen(false)
      })
      .catch(() => setMessage({ tone: 'danger', text: 'Could not record the request. Try again.' }))
      .finally(() => setBusy(false))
  }

  if (!open) {
    return (
      <div className="mw-send-authority">
        {message && <div className="mw-note" data-tone={message.tone} role="status">{message.text}</div>}
        <button type="button" className="btn btn-sm" onClick={() => { setMessage(null); setOpen(true) }}>
          <Send size={14} aria-hidden="true" /> Mark as sent to {authority}
        </button>
      </div>
    )
  }
  return (
    <div className="mw-send-authority">
      <label className="mw-send-authority-field">
        <span>Request letter number (optional)</span>
        <input
          className="input"
          value={number}
          onChange={(e) => setNumber(e.target.value)}
          maxLength={120}
          dir="auto"
        />
      </label>
      <div className="row" style={{ gap: 8 }}>
        <button type="button" className="btn btn-primary btn-sm" disabled={busy} onClick={record}>
          Record as sent
        </button>
        <button type="button" className="btn btn-ghost btn-sm" disabled={busy} onClick={() => setOpen(false)}>
          Cancel
        </button>
      </div>
    </div>
  )
}
