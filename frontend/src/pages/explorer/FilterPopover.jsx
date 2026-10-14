import { useEffect, useId, useRef, useState } from 'react'
import Icon from '../../components/Icon'
import { Fa } from '../../components/work/parts'
import { FILTER_FIELDS, fieldOptions } from './listModel'

/**
 * The Filter button and its popover (UEP-11a §B2): "FILTER BY", the four
 * fields, then one field's values behind a back row. Choosing a value applies
 * it and closes; choosing the active value again removes it. Escape or a
 * click outside closes, and focus goes back to the button.
 */
export default function FilterPopover({ options, filters, onToggle }) {
  const [open, setOpen] = useState(false)
  const [field, setField] = useState(null)
  const wrap = useRef(null)
  const button = useRef(null)
  const panel = useRef(null)
  const id = useId()

  const close = (refocus = true) => {
    setOpen(false)
    setField(null)
    if (refocus) button.current?.focus()
  }

  useEffect(() => {
    if (!open) return undefined
    panel.current?.querySelector('button')?.focus()
    const outside = (e) => !wrap.current?.contains(e.target) && close(false)
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [open, field])

  const pick = (f, value) => {
    onToggle(f.key, filters[f.key] === value ? null : value)
    close()
  }

  const onKeyDown = (e) => {
    if (e.key !== 'Escape' || !open) return
    e.stopPropagation()
    close()
  }

  return (
    <div className="exl-filter" ref={wrap} onKeyDown={onKeyDown}>
      <button
        ref={button}
        type="button"
        className={`uw-btn ${open ? 'is-current' : ''}`.trim()}
        aria-expanded={open}
        aria-controls={id}
        aria-haspopup="dialog"
        onClick={() => (open ? close() : setOpen(true))}
      >
        <Icon name="filter" size={16} /> Filter
      </button>
      {open && (
        <div className="exl-popover" id={id} role="dialog" aria-label="Filter by" ref={panel}>
          {field ? (
            <>
              <button type="button" className="exl-pop-back" onClick={() => setField(null)}>
                <Icon name="chevron--left" size={16} /> {field.label}
              </button>
              <ul className="exl-pop-list">
                {fieldOptions(field, options).map((o) => {
                  const on = filters[field.key] === o.value
                  return (
                    <li key={o.value}>
                      <button type="button" className="exl-pop-item" aria-pressed={on} onClick={() => pick(field, o.value)}>
                        <span className="exl-pop-label">{field.persian ? <Fa>{o.label}</Fa> : o.label}</span>
                        {on && <Icon name="checkmark" size={16} />}
                      </button>
                    </li>
                  )
                })}
                {fieldOptions(field, options).length === 0 && <li className="exl-pop-empty">No values</li>}
              </ul>
            </>
          ) : (
            <>
              <p className="exl-pop-title" aria-hidden="true">Filter by</p>
              <ul className="exl-pop-list">
                {FILTER_FIELDS.map((f) => (
                  <li key={f.key}>
                    <button type="button" className="exl-pop-item" onClick={() => setField(f)}>
                      <span className="exl-pop-label">{f.label}</span>
                      <Icon name="chevron--right" size={16} />
                    </button>
                  </li>
                ))}
              </ul>
            </>
          )}
        </div>
      )}
    </div>
  )
}
