// The small marks the Monthly Plan pages share: a chip and the loading, error
// and denied states. Status is never colour alone: the word is always there.
import Icon from '../../components/Icon'

/**
 * A small word in a pill (UEP-18). `tone` is `neutral` (default), `accent`,
 * `danger` or `approved` -- green, for Approved and nothing else.
 */
export function Chip({ tone = 'neutral', children, ...rest }) {
  return (
    <span className="mp2-chip" data-tone={tone} {...rest}>
      {children}
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
