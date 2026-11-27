import { useEffect, useId, useRef, useState } from 'react'
import Icon from '../../components/Icon'
import { Fa } from '../../components/work/parts'
import { FILTER_FIELDS, fieldOptions } from './listModel'

/** Persian-aware "contains" for the Province menu's search box. */
const contains = (label, term) => !term || String(label).toLowerCase().includes(term.trim().toLowerCase())

/** One pill's menu: its values, Province with a search box. Escape or a
 * click outside closes; focus goes back to the pill. */
function PillMenu({ field, options, value, onChoose, onClose, anchor }) {
  const ref = useRef(null)
  const [term, setTerm] = useState('')
  const searchable = field.key === 'province'
  const shown = options.filter((o) => contains(o.label, term))

  useEffect(() => {
    ref.current?.querySelector(searchable ? 'input' : 'button')?.focus()
    const outside = (e) => !ref.current?.contains(e.target) && !anchor.current?.contains(e.target) && onClose(false)
    document.addEventListener('mousedown', outside)
    return () => document.removeEventListener('mousedown', outside)
  }, [anchor, onClose, searchable])

  const onKeyDown = (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation()
      onClose(true)
      return
    }
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    const items = [...ref.current.querySelectorAll('.exf-option')]
    const at = items.indexOf(document.activeElement)
    const next = items[Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)))]
    if (next) {
      e.preventDefault()
      next.focus()
    }
  }

  return (
    <div className="exf-menu" ref={ref} onKeyDown={onKeyDown} role="group" aria-label={`${field.label} values`}>
      {searchable && (
        <input
          className="exf-menu-search"
          type="search"
          value={term}
          placeholder="Search provinces"
          aria-label="Search provinces"
          onChange={(e) => setTerm(e.target.value)}
        />
      )}
      <div className="exf-menu-list">
        {shown.map((o) => (
          <button
            key={o.value}
            type="button"
            className={`exf-option ${o.value === value ? 'is-on' : ''}`.trim()}
            aria-pressed={o.value === value}
            onClick={() => onChoose(o.value)}
          >
            {field.persian ? <Fa>{o.label}</Fa> : o.label}
            {o.value === value && <Icon name="checkmark" size={16} />}
          </button>
        ))}
        {shown.length === 0 && <p className="exf-menu-empty">No match</p>}
      </div>
    </div>
  )
}

/** One filter as a pill: dashed when empty, solid cobalt tint with its value
 * and a × once chosen. One click opens it, one click chooses. */
function FilterPill({ field, options, value, open, onOpen, onChoose, onRemove }) {
  const anchor = useRef(null)
  const menuId = useId()
  const values = fieldOptions(field, options)
  const label = values.find((o) => o.value === value)?.label ?? value
  const close = (refocus) => {
    onOpen(null)
    if (refocus) anchor.current?.querySelector('.exf-pill-button')?.focus()
  }
  return (
    <div className={`exf-pill ${value ? 'is-on' : ''}`.trim()} ref={anchor}>
      <button
        type="button"
        className="exf-pill-button"
        aria-expanded={open}
        aria-controls={open ? menuId : undefined}
        onClick={() => onOpen(open ? null : field.key)}
      >
        <span className="exf-pill-label">{field.label}</span>
        {value ? <b>{field.persian ? <Fa>{label}</Fa> : label}</b> : <Icon name="chevron--down" size={16} />}
      </button>
      {value && (
        <button type="button" className="exf-pill-remove" aria-label={`Remove ${field.label} filter`} onClick={onRemove}>
          <Icon name="close" size={16} />
        </button>
      )}
      {open && (
        <div id={menuId}>
          <PillMenu field={field} options={values} value={value} anchor={anchor} onClose={close} onChoose={(v) => { onChoose(v); close(true) }} />
        </div>
      )}
    </div>
  )
}

/**
 * The list's filters as pills (UEP-28 §A2), replacing the Filter button and
 * its two-level popover: Province, Site type, Technology, DT contractor, and
 * "Clear filters" once any is set. Values come from GET /explorer/sites/filters;
 * the URL parameters are unchanged.
 */
export default function FilterPills({ options, filters, onChange, onClear }) {
  const [open, setOpen] = useState(null)
  const any = FILTER_FIELDS.some((f) => filters[f.key])
  return (
    <div className="exf" role="group" aria-label="Filters">
      {FILTER_FIELDS.map((f) => (
        <FilterPill
          key={f.key}
          field={f}
          options={options}
          value={filters[f.key]}
          open={open === f.key}
          onOpen={setOpen}
          onChoose={(v) => onChange(f.key, v)}
          onRemove={() => onChange(f.key, null)}
        />
      ))}
      {any && <button type="button" className="exf-clear" onClick={onClear}>Clear filters</button>}
    </div>
  )
}
