// Small pieces every Roles Performance tab uses.
import Icon from '../../../components/Icon'
import { fmtCount } from './model'
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

/** A Persian label (a month, a name) set in Vazirmatn, direction from content. */
export function Fa({ children, className = '' }) {
  return (
    <span dir="auto" className={`rp-fa ${className}`.trim()}>
      {children}
    </span>
  )
}

/** The accent-soft square an icon sits on: 24px in a list, 40px in a panel head. */
export function IconTile({ name, large = false }) {
  return (
    <span className={`rp-tile${large ? ' rp-tile-lg' : ''}`} aria-hidden="true">
      <Icon name={name} size={large ? 20 : 16} />
    </span>
  )
}

/**
 * A card with its own loading skeleton, error (with retry) and empty states.
 * The skeleton shows only before the first data: a refetch keeps the last
 * figures on screen, so the control that asked for it keeps its focus.
 */
export function RpCard({ loading, error, onRetry, empty, emptyText = 'Nothing to show yet.',
  className = '', label, children }) {
  let body = children
  if (error) {
    body = (
      <div className="rp-state rp-state-error" role="alert">
        <Icon name="warning--alt" size={16} />
        <span>{error}</span>
        {onRetry && (
          <button type="button" className="rp-retry" onClick={onRetry}>Retry</button>
        )}
      </div>
    )
  } else if (loading) body = <Skeleton />
  else if (empty) body = <p className="rp-state">{emptyText}</p>
  return (
    <section className={`rp-card ${className}`.trim()} aria-label={label}
      aria-busy={loading || undefined}>
      {body}
    </section>
  )
}

export function Skeleton({ lines = 4 }) {
  return (
    <div className="rp-skeleton" aria-label="Loading">
      {Array.from({ length: lines }, (_, i) => (
        <span key={i} className="rp-skeleton-line" style={{ width: `${90 - i * 16}%` }} />
      ))}
    </div>
  )
}
