import { Children, Fragment, isValidElement, useEffect, useId, useMemo, useRef, useState } from 'react'
import Icon from './Icon'

/**
 * The one dropdown (UEP-13 §3.10): a single select drawn by UEP, in place of
 * every native <select>.
 *
 * Written as a drop-in for <select>: give it the same `value`, `<option>`
 * children (an `<optgroup>` labels its options) and an `onChange` that reads
 * `e.target.value` -- or pass `options` as [{ value, label, disabled }].
 * Values are strings, as a native select's are.
 *
 * Trigger 34px, 8px radius, chevron; open: accent border and ring. The menu
 * is a listbox: Enter/Space/↓ open it, ↑/↓ move, typing jumps to a match,
 * Enter selects, Esc closes and returns focus. Above 10 options a search box
 * sits on top. Motion: a 120ms fade/scale, none under reduced motion.
 */
export default function Select({
  value,
  onChange,
  options: optionsProp,
  children,
  id,
  name,
  disabled = false,
  required,
  className = '',
  icon,
  placeholder,
  searchable,
  'aria-label': ariaLabel,
  'aria-labelledby': ariaLabelledBy,
  'aria-describedby': ariaDescribedBy,
  'aria-invalid': ariaInvalid,
  title,
  style,
}) {
  const options = useMemo(() => optionsProp?.map(normalise) ?? readOptions(children), [optionsProp, children])
  const current = options.find((o) => o.value === String(value ?? ''))
  const [open, setOpen] = useState(false)
  const [active, setActive] = useState(-1)
  const [query, setQuery] = useState('')
  const typed = useRef({ text: '', at: 0 })
  const triggerRef = useRef(null)
  const listRef = useRef(null)
  const searchRef = useRef(null)
  const wrapRef = useRef(null)
  const listId = useId()
  const autoId = useId()
  const triggerId = id || autoId
  const withSearch = searchable ?? options.length > 10

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? options.filter((o) => o.text.toLowerCase().includes(q)) : options
  }, [options, query])

  useEffect(() => {
    if (!open) return undefined
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('pointerdown', onDown)
    return () => document.removeEventListener('pointerdown', onDown)
  }, [open])

  useEffect(() => {
    if (open && withSearch) searchRef.current?.focus()
  }, [open, withSearch])

  useEffect(() => {
    if (!open || active < 0) return
    listRef.current?.querySelector(`[data-index="${active}"]`)?.scrollIntoView?.({ block: 'nearest' })
  }, [open, active])

  function openMenu() {
    if (disabled) return
    setQuery('')
    setActive(Math.max(0, options.findIndex((o) => o.value === current?.value)))
    setOpen(true)
  }

  function close(focusTrigger = true) {
    setOpen(false)
    if (focusTrigger) triggerRef.current?.focus()
  }

  function choose(option) {
    if (!option || option.disabled) return
    if (option.value !== current?.value) onChange?.({ target: { value: option.value, name }, currentTarget: { value: option.value, name } })
    close()
  }

  function move(delta) {
    if (shown.length === 0) return
    let next = active
    for (let i = 0; i < shown.length; i += 1) {
      next = (next + delta + shown.length) % shown.length
      if (!shown[next].disabled) break
    }
    setActive(next)
  }

  function typeAhead(key) {
    const now = Date.now()
    const t = typed.current
    t.text = now - t.at > 700 ? key : t.text + key
    t.at = now
    const start = open ? active + 1 : options.findIndex((o) => o.value === current?.value) + 1
    const list = open ? shown : options
    for (let i = 0; i < list.length; i += 1) {
      const o = list[(start + i) % list.length]
      if (!o.disabled && o.text.toLowerCase().startsWith(t.text.toLowerCase())) {
        if (open) setActive((start + i) % list.length)
        else choose(o)
        return
      }
    }
  }

  function onTriggerKey(e) {
    if (disabled) return
    if (!open) {
      if (['Enter', ' ', 'ArrowDown', 'ArrowUp'].includes(e.key)) {
        e.preventDefault()
        openMenu()
      } else if (e.key.length === 1 && /\S/.test(e.key)) {
        typeAhead(e.key)
      }
      return
    }
    onMenuKey(e)
  }

  function onMenuKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault()
      e.stopPropagation()
      close()
    } else if (e.key === 'ArrowDown') {
      e.preventDefault()
      move(1)
    } else if (e.key === 'ArrowUp') {
      e.preventDefault()
      move(-1)
    } else if (e.key === 'Home') {
      e.preventDefault()
      setActive(0)
    } else if (e.key === 'End') {
      e.preventDefault()
      setActive(shown.length - 1)
    } else if (e.key === 'Enter' || (e.key === ' ' && !withSearch)) {
      e.preventDefault()
      choose(shown[active])
    } else if (e.key === 'Tab') {
      close(false)
    } else if (!withSearch && e.key.length === 1 && /\S/.test(e.key)) {
      typeAhead(e.key)
    }
  }

  const label = current ? current.label : placeholder ?? ''
  return (
    <div className={`uep-select ${open ? 'is-open' : ''} ${className}`.trim()} ref={wrapRef} style={style}>
      <button
        ref={triggerRef}
        id={triggerId}
        type="button"
        className="uep-select-trigger"
        role="combobox"
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-controls={open ? listId : undefined}
        aria-activedescendant={open && !withSearch && active >= 0 ? `${listId}-${active}` : undefined}
        aria-label={ariaLabel}
        aria-labelledby={ariaLabelledBy}
        aria-describedby={ariaDescribedBy}
        aria-invalid={ariaInvalid}
        aria-required={required || undefined}
        disabled={disabled}
        title={title}
        onClick={() => (open ? close() : openMenu())}
        onKeyDown={onTriggerKey}
      >
        {icon && <Icon name={icon} size={16} />}
        <span className={`uep-select-value ${current ? '' : 'is-placeholder'}`.trim()}>{label}</span>
        <Icon name={open ? 'chevron--up' : 'chevron--down'} size={16} className="uep-select-chevron" />
      </button>
      {open && (
        <div className="uep-select-menu" onKeyDown={onMenuKey}>
          {withSearch && (
            <input
              ref={searchRef}
              className="uep-select-search"
              type="search"
              aria-label="Search options"
              aria-controls={listId}
              aria-activedescendant={active >= 0 ? `${listId}-${active}` : undefined}
              value={query}
              onChange={(e) => {
                setQuery(e.target.value)
                setActive(0)
              }}
            />
          )}
          <ul id={listId} ref={listRef} role="listbox" aria-label={ariaLabel} aria-labelledby={ariaLabel ? undefined : triggerId}>
            {shown.map((o, i) => (
              <Fragment key={`${o.group ?? ''}|${o.value}`}>
                {o.group && (i === 0 || shown[i - 1].group !== o.group) && (
                  <li role="presentation" className="uep-select-group">{o.group}</li>
                )}
                <li
                  id={`${listId}-${i}`}
                  data-index={i}
                  data-value={o.value}
                  role="option"
                  aria-selected={o.value === current?.value}
                  aria-disabled={o.disabled || undefined}
                  className={`uep-select-option ${i === active ? 'is-active' : ''}`.trim()}
                  onPointerEnter={() => setActive(i)}
                  onPointerDown={(e) => e.preventDefault()}
                  onClick={() => choose(o)}
                >
                  <span>{o.label}</span>
                  {o.value === current?.value && <Icon name="checkmark" size={16} className="uep-select-check" />}
                </li>
              </Fragment>
            ))}
            {shown.length === 0 && <li className="uep-select-empty" role="presentation">No matches</li>}
          </ul>
        </div>
      )}
    </div>
  )
}

function textOf(node) {
  if (node == null || typeof node === 'boolean') return ''
  if (typeof node === 'string' || typeof node === 'number') return String(node)
  if (Array.isArray(node)) return node.map(textOf).join('')
  if (isValidElement(node)) return textOf(node.props.children)
  return ''
}

function normalise(o) {
  const value = String(o.value ?? '')
  return { value, label: o.label ?? value, text: textOf(o.label ?? value), disabled: Boolean(o.disabled), group: o.group }
}

/** <option> / <optgroup> children (through fragments and arrays) as options. */
function readOptions(children, group) {
  const out = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) return
    if (child.type === Fragment) {
      out.push(...readOptions(child.props.children, group))
    } else if (child.type === 'optgroup') {
      out.push(...readOptions(child.props.children, child.props.label))
    } else if (child.type === 'option') {
      const label = child.props.children
      const value = child.props.value ?? textOf(label)
      out.push(normalise({ value, label, disabled: child.props.disabled, group }))
    }
  })
  return out
}
