import { useState } from 'react'
import { Check, CornerUpLeft, Dot, X } from 'lucide-react'
import { roundSummary, shown } from './roundText'

const MARK = {
  approved: { tone: 'success', Icon: Check },
  rejected: { tone: 'danger', Icon: X },
  returned: { tone: 'danger', Icon: CornerUpLeft, outline: true },
  pending: { tone: 'ongoing', Icon: Dot },
  withdrawn: { tone: 'neutral', Icon: Dot },
}

const VISIBLE = 2

/** A side's rounds, newest first: two visible, the rest behind "Show all N". */
export default function RoundHistory({ rounds }) {
  const [all, setAll] = useState(false)
  const list = all ? rounds : rounds.slice(0, VISIBLE)
  return (
    <div className="mw-history">
      <div className="mw-history-head">
        <span className="mw-history-title">History</span>
        {rounds.length > VISIBLE && (
          <button type="button" className="mw-link-btn" onClick={() => setAll(!all)}>
            {all ? 'Show less' : `Show all ${rounds.length}`}
          </button>
        )}
      </div>
      {rounds.length === 0 && <span className="mw-muted">No letters yet</span>}
      <ul className="mw-history-list">
        {list.map((round) => {
          const [short, full] = roundSummary(round)
          const mark = MARK[round.result] || MARK.pending
          return (
            <li key={round.submission_id} className="mw-history-line" title={`${full} · ${shown(round.letter_number)} · ${shown(round.letter_date_shamsi)}`}>
              <span className="mw-history-mark" data-tone={mark.tone} data-outline={Boolean(mark.outline)} aria-hidden="true">
                <mark.Icon size={12} strokeWidth={2.5} />
              </span>
              <span className="mw-history-round">R{round.round_no}</span>
              <span className="mw-history-letter mw-fa-ltr">{shown(round.letter_number)}</span>
              <span className="mw-history-short" data-tone={mark.tone}>{short}</span>
              <span className="mw-history-date mw-fa-ltr">{shown(round.letter_date_shamsi)}</span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}
