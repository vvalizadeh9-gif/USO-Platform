// The small marks the Monthly Plan tabs share: a contractor's circle, the 6px
// bar with its 2px tick, and a status in words with its marker. Status is
// never colour alone: the word is always there.
import Icon from '../../components/Icon'
import { initials } from './planBoard'

/** A contractor's initials in a circle; `muted` (dashed) for one who has not shared. */
export function Avatar({ name, muted = false, size = 'md' }) {
  return (
    <span className={`mp-avatar mp-avatar-${size}${muted ? ' mp-avatar-muted' : ''}`} aria-hidden="true">
      {initials(name)}
    </span>
  )
}

/**
 * A 6px bar: `value` filled in the accent against a 2px ink tick at `tick`,
 * on a scale wide enough for both. Named by `label` for assistive technology.
 */
export function PlanBar({ value, tick, label }) {
  const max = Math.max(value ?? 0, tick ?? 0) * 1.1 || 1
  const at = (v) => `${Math.min(100, (100 * Math.max(0, v)) / max)}%`
  return (
    <span className="mp-bar" role="img" aria-label={label}>
      <i className="mp-bar-fill" style={{ width: at(value ?? 0) }} />
      {tick != null && <i className="mp-bar-tick" style={{ left: at(tick) }} />}
    </span>
  )
}

const STATUS_WORD = { approved: 'Approved', waiting: 'Waiting', returned: 'Sent back', none: 'Not shared' }

/** A plan's state as text and a small marker: green for Approved only. */
export function PlanStatus({ state }) {
  return (
    <span className="mp-status" data-state={state}>
      {state === 'approved' ? (
        <Icon name="checkmark" size={16} className="mp-status-mark" />
      ) : (
        <span className="mp-status-mark" aria-hidden="true" />
      )}
      {STATUS_WORD[state]}
    </span>
  )
}

/** The same loading, error and denied states on every tab. */
export function TabState({ state, what, onRetry }) {
  if (state === 'denied') {
    return <div className="mp-state">{`${what} are not open to your role.`}</div>
  }
  if (state === 'failed') {
    return (
      <div className="mp-state" role="alert">
        {`Could not load ${what.toLowerCase()}.`}
        {onRetry && (
          <button type="button" className="mp-btn" onClick={onRetry}>
            <Icon name="renew" size={16} /> Retry
          </button>
        )}
      </div>
    )
  }
  return (
    <div className="mp-state" role="status">
      <span className="spinner" aria-hidden="true" />
      {`Loading ${what.toLowerCase()}…`}
    </div>
  )
}
