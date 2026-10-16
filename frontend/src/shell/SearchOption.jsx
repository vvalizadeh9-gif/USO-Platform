import { Fragment } from 'react'
import Icon from '../components/Icon'
import { isPersian, matchRuns } from './searchLook'

/** One label or meta part, isolated so "کرمان · Acceptance" never reorders. */
function Part({ text, children }) {
  const fa = isPersian(text)
  return (
    <bdi lang={fa ? 'fa' : undefined} className={fa ? 'uep-search-fa' : undefined}>
      {children ?? text}
    </bdi>
  )
}

/**
 * A result row: tinted icon tile, label with the matched text in bold, its
 * meta right after it, and an Enter arrow on the active row. `rise` is the
 * row's place in the entrance stagger, or null when it does not animate.
 */
export default function SearchOption({ id, item, look, term, active, rise, onHover, onPick }) {
  const meta = [].concat(item.meta ?? []).filter(Boolean)
  return (
    <button
      id={id}
      type="button"
      role="option"
      tabIndex={-1}
      aria-selected={active}
      aria-label={[item.label, ...meta].join(', ')}
      className={`uep-search-option${active ? ' is-active' : ''}${rise != null ? ' is-rising' : ''}`}
      style={rise != null ? { '--rise': rise } : undefined}
      onMouseEnter={onHover}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onPick}
    >
      <span className="uep-search-tile" data-tone={look.tone}>
        <Icon name={look.icon} size={16} />
      </span>
      <span className="uep-search-option-label">
        <Part text={item.label}>
          {matchRuns(item.label, term).map((r, i) => (r.hit ? <b key={i}>{r.text}</b> : r.text))}
        </Part>
      </span>
      {meta.length > 0 && (
        <span className="uep-search-option-meta">
          {meta.map((m, i) => (
            <Fragment key={i}>
              {i > 0 && ' · '}
              <Part text={m} />
            </Fragment>
          ))}
        </span>
      )}
      <Icon name="return" size={16} className="uep-search-enter" />
    </button>
  )
}
