// Small pieces every Roles Performance tab uses.
import { AlertTriangle } from 'lucide-react'
import { deltaTone, fmtCount, fmtDelta } from './model'
import { useCountUp } from './hooks'

/**
 * A number in its own left-to-right span, apart from any name beside it, so
 * the bidi algorithm can never move a sign to the wrong end of a Persian name.
 */
export function Num({ children, className = '' }) {
  return (
    <span dir="ltr" className={`rp-num ${className}`.trim()}>
      {children}
    </span>
  )
}

/** A count that counts up, in its LTR span. */
export function CountUp({ value, format = fmtCount, className = '' }) {
  const shown = useCountUp(value)
  return <Num className={className}>{value == null ? '—' : format(shown)}</Num>
}

/** The +/- chip: green when good, red when bad, inverted where lower is better. */
export function DeltaChip({ delta, lowerIsBetter = false, suffix = '', small = false }) {
  if (delta === undefined) return null
  const tone = deltaTone(delta, lowerIsBetter)
  return (
    <Num className={`rp-delta rp-delta-${tone}${small ? ' rp-delta-sm' : ''}`}>
      {fmtDelta(delta, suffix)}
    </Num>
  )
}

/** A card with its own loading skeleton, error and empty states. */
export function RpCard({ title, aside, loading, error, empty, emptyText = 'Nothing to show yet.',
  className = '', children, style }) {
  let body = children
  if (loading) body = <Skeleton />
  else if (error) {
    body = (
      <p className="rp-state rp-state-error" role="alert">
        <AlertTriangle size={16} aria-hidden="true" /> {error}
      </p>
    )
  } else if (empty) body = <p className="rp-state">{emptyText}</p>
  return (
    <section className={`rp-card ${className}`.trim()} style={style} aria-busy={loading || undefined}>
      {(title || aside) && (
        <header className="rp-card-head">
          {title && <h2 className="rp-card-title">{title}</h2>}
          {aside && <div className="rp-card-aside">{aside}</div>}
        </header>
      )}
      {body}
    </section>
  )
}

export function Skeleton({ lines = 3 }) {
  return (
    <div className="rp-skeleton" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="rp-skeleton-line" style={{ width: `${90 - i * 18}%` }} />
      ))}
    </div>
  )
}

/** A horizontal bar with an optional tick (the national rate). 0..100. */
export function RateBar({ value, tick, colour = 'var(--rp-accent)', max = 100, label }) {
  const width = value == null ? 0 : Math.min(Math.max((value / max) * 100, 0), 100)
  return (
    <span className="rp-ratebar" role="img" aria-label={label}>
      <span className="rp-ratebar-fill" style={{ width: `${width}%`, background: colour }} />
      {tick != null && (
        <span className="rp-ratebar-tick" style={{ left: `${Math.min((tick / max) * 100, 100)}%` }} />
      )}
    </span>
  )
}

/** "Not compared": grey, unranked, last. */
export function NotCompared() {
  return <span className="rp-not-compared">Not compared</span>
}

/** A Persian label (a month, a name) set in Vazirmatn, direction from content. */
export function Fa({ children, className = '' }) {
  return (
    <span dir="auto" className={`rp-fa ${className}`.trim()}>
      {children}
    </span>
  )
}
