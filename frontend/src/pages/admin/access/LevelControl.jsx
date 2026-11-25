import { useRef } from 'react'
import { LEVEL_LABEL, levelsOf } from './accessModel'

/**
 * None · View · Edit: a compact segmented control. Edit is cobalt, View light
 * cobalt, None grey -- never green. Only the levels the feature supports are
 * shown. Arrow keys move between them, as in every UEP segmented control.
 */
export default function LevelControl({ feature, value, onChange, disabled = false, label }) {
  const ref = useRef(null)
  const options = levelsOf(feature)
  const current = value || 'none'

  function onKeyDown(event) {
    if (disabled) return
    const i = options.indexOf(current)
    let next = null
    if (event.key === 'ArrowRight') next = (i + 1) % options.length
    else if (event.key === 'ArrowLeft') next = (i - 1 + options.length) % options.length
    if (next === null) return
    event.preventDefault()
    onChange(options[next])
    ref.current?.querySelectorAll('button')[next]?.focus()
  }

  return (
    <div className="ac-level" role="group" aria-label={label || feature.label} ref={ref} onKeyDown={onKeyDown}>
      {options.map((level) => (
        <button
          key={level}
          type="button"
          className={`ac-level-opt is-${level}`}
          aria-pressed={current === level}
          disabled={disabled}
          tabIndex={current === level ? 0 : -1}
          onClick={() => onChange(level)}
        >
          {LEVEL_LABEL[level]}
        </button>
      ))}
    </div>
  )
}
