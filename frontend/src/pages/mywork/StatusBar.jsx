import { segmentsFor, statusOf } from './status'

/**
 * The three-segment traffic light for one side: submitter, checker, approved.
 * The lit segment carries the status ink (an outline for Returned); the others
 * show their soft tints. Always paired with its words -- the full bar labels
 * every segment, the mini bar names the status under it.
 */
export function StatusBar({ status, view }) {
  const segments = segmentsFor(status, view)
  return (
    <div className="mw-bar" role="img" aria-label={`Status: ${statusOf(status).label}`}>
      {segments.map((s) => (
        <span key={s.label} className="mw-bar-part">
          <span className="mw-seg" data-tone={s.tone} data-lit={s.lit} data-outline={s.outline} />
          <span className="mw-seg-label" data-tone={s.tone} data-lit={s.lit}>{s.label}</span>
        </span>
      ))}
    </div>
  )
}

const SYMBOLS = { waiting: '•', filled: '↑', approved: '✓', rejected: '✕', returned: '↩' }

/** A status dot with its symbol: colour is never the only signal. */
export function StatusDot({ status, small = false }) {
  return (
    <span className={`mw-dot${small ? ' mw-dot-sm' : ''}`} data-status={status} aria-hidden="true">
      {SYMBOLS[status] || ''}
    </span>
  )
}

/** The row's per-authority dot, named in its tooltip and aria-label. */
export function MiniBar({ authority, status }) {
  const text = `${authority}: ${statusOf(status).label}`
  return (
    <span className="mw-dot-cell" title={text} aria-label={text} role="img">
      <StatusDot status={status} />
    </span>
  )
}

/** The key under the village list. */
export function BarLegend() {
  const items = ['waiting', 'filled', 'approved', 'rejected', 'returned']
  return (
    <div className="mw-legend">
      {items.map((key) => (
        <span key={key} className="mw-legend-item">
          <StatusDot status={key} small />
          {statusOf(key).label}
        </span>
      ))}
    </div>
  )
}
