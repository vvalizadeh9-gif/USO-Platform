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

/** The row's per-authority bar: three small segments and the status word. */
export function MiniBar({ authority, status, view }) {
  const s = statusOf(status)
  return (
    <span className="mw-mini" aria-label={`${authority}: ${s.label}`}>
      <span className="mw-mini-segs" aria-hidden="true">
        {segmentsFor(status, view).map((seg, i) => (
          <span key={i} className="mw-seg mw-seg-mini" data-tone={seg.tone} data-lit={seg.lit} data-outline={seg.outline} />
        ))}
      </span>
      <span className="mw-mini-label" data-tone={s.tone}>{s.label}</span>
    </span>
  )
}

/** The legend under the village list. */
export function BarLegend({ view }) {
  const items = [
    { tone: 'pending', label: view === 'staff' ? 'Contractor' : 'You' },
    { tone: 'ongoing', label: view === 'staff' ? 'You check' : 'Coordinator' },
    { tone: 'success', label: 'Approved' },
    { tone: 'danger', label: 'Rejected' },
    { tone: 'danger', label: 'Returned', outline: true },
  ]
  return (
    <div className="mw-legend">
      {items.map((item) => (
        <span key={item.label} className="mw-legend-item">
          <span className="mw-seg mw-seg-key" data-tone={item.tone} data-lit="true" data-outline={Boolean(item.outline)} />
          {item.label}
        </span>
      ))}
    </div>
  )
}
