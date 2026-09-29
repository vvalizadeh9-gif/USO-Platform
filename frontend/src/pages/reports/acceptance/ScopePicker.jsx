import { Check, ChevronDown, SlidersHorizontal } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import api from '../../../api/client'

/**
 * The page's one filter: which contractor and which province every card on
 * the page counts. A button in the PageBar's context slot ("All contractors,
 * all provinces"), opening a menu of two radio groups.
 *
 * Staff only -- the page hides it for a contractor, whose scope is its own
 * company whatever it asks for. The lists are read when the menu first
 * opens. Arrow keys move through the items, Escape closes the menu and gives
 * focus back to the button.
 */
export default function ScopePicker({ scope, onChange }) {
  const [open, setOpen] = useState(false)
  const [options, setOptions] = useState({ contractors: [], provinces: [] })
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const names = useNames(scope, options)

  useEffect(() => {
    let live = true
    Promise.all([
      api.get('/reference/contractors').then((r) => r.data).catch(() => []),
      api.get('/reference/provinces').then((r) => r.data).catch(() => []),
    ]).then(([contractors, provinces]) => live && setOptions({ contractors, provinces }))
    return () => {
      live = false
    }
  }, [])

  useEffect(() => {
    if (!open) return undefined
    menuRef.current?.querySelector('[role="menuitemradio"]')?.focus()
    const onDown = (e) => {
      if (!wrapRef.current?.contains(e.target)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [open])

  const close = () => {
    setOpen(false)
    buttonRef.current?.focus()
  }
  const pick = (field, id) => {
    onChange({ ...scope, [field]: id })
  }
  const onMenuKey = (e) => {
    const items = [...menuRef.current.querySelectorAll('[role="menuitemradio"]')]
    const i = items.indexOf(document.activeElement)
    if (e.key === 'Escape') {
      e.preventDefault()
      close()
    } else if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault()
      const step = e.key === 'ArrowDown' ? 1 : -1
      items[(i + step + items.length) % items.length]?.focus()
    } else if (e.key === 'Tab') {
      setOpen(false)
    }
  }

  const scoped = scope.contractor_id != null || scope.province_id != null
  const label = `${names.contractor}, ${names.province}`

  return (
    <div className="dt-scope accd-scope" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`dt-scope-btn${scoped ? ' is-scoped' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`Scope: ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        <SlidersHorizontal size={16} strokeWidth={1.9} aria-hidden="true" />
        <span dir="auto">{label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {open && (
        <div className="dt-scope-menu accd-scope-menu" role="menu" aria-label="Scope" ref={menuRef} onKeyDown={onMenuKey}>
          <Group
            title="Contractor"
            all="All contractors"
            items={options.contractors}
            value={scope.contractor_id}
            onPick={(id) => pick('contractor_id', id)}
          />
          <Group
            title="Province"
            all="All provinces"
            items={options.provinces}
            value={scope.province_id}
            onPick={(id) => pick('province_id', id)}
          />
        </div>
      )}
    </div>
  )
}

function Group({ title, all, items, value, onPick }) {
  const rows = [{ id: null, name: all }, ...items]
  return (
    <div role="group" aria-label={title} className="accd-scope-group">
      <div className="accd-scope-title">{title}</div>
      {rows.map((row) => {
        const checked = (value ?? null) === row.id
        return (
          <button
            key={row.id ?? 'all'}
            type="button"
            role="menuitemradio"
            aria-checked={checked}
            tabIndex={-1}
            className="dt-scope-option"
            onClick={() => onPick(row.id)}
          >
            <span className={row.id == null ? undefined : 'dt-farsi'} dir="auto">{row.name}</span>
            {checked && <Check size={16} aria-hidden="true" />}
          </button>
        )
      })}
    </div>
  )
}

function useNames(scope, options) {
  const find = (list, id) => list.find((x) => x.id === id)?.name
  return {
    contractor:
      scope.contractor_id == null ? 'All contractors' : find(options.contractors, scope.contractor_id) ?? 'One contractor',
    province:
      scope.province_id == null ? 'all provinces' : find(options.provinces, scope.province_id) ?? 'one province',
  }
}
