import { waitingTone } from '../lib/waiting'

const TONE_CLASS = {
  grey: 'pill-dim',
  amber: 'pill-amber',
  red: 'pill-red',
}

// [n] days, coloured by lib/waiting's D1 thresholds. Unknown (no waiting_since
// at all -- see the HC Pool's round-1 rule) renders as a plain dash rather
// than a grey pill, so "just started waiting" and "we don't know" never look
// the same.
export default function WaitingPill({ days }) {
  if (days == null) {
    return <span className="dim tnum">—</span>
  }
  return (
    <span className={`pill ${TONE_CLASS[waitingTone(days)]} tnum`} style={{ fontSize: 11.5 }}>
      {days} day{days === 1 ? '' : 's'}
    </span>
  )
}
