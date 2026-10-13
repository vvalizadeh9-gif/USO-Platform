import { Check, ChevronDown, Download, MapPin, RefreshCw, X } from 'lucide-react'
import { useEffect, useRef, useState } from 'react'
import { freshness } from './format'

/**
 * The province the dashboard is narrowed to, as a button in the PageBar's
 * context slot: "All provinces", or the province's name with a clear button
 * beside it. Opening it lists every province to pick from, so the scope can
 * be set here as well as from the province table.
 */
export function ProvinceScope({ provinces, provinceId, provinceName, onChange }) {
  return (
    <ScopeMenu
      icon={<MapPin size={16} strokeWidth={1.9} aria-hidden="true" />}
      what="Province"
      all="All provinces"
      options={provinces}
      value={provinceId}
      valueName={provinceName}
      onChange={onChange}
      clearLabel={
        provinceName
          ? `Show every province again, not just ${provinceName}`
          : 'Show every province again'
      }
    />
  )
}

/**
 * One scope as a button: `all` when nothing is picked, or the picked
 * option's name with a clear button beside it. Shared by the Drive test and
 * Acceptance dashboards, so a scope reads and works the same on both.
 *
 * A menu of radio items: one is checked, arrows move between them, Escape
 * closes it and gives focus back to the button. `what` names it ("Province"
 * gives "Province scope: …"); option names are Farsi.
 */
export function ScopeMenu({ icon, what, all, options: items, value, valueName, onChange, clearLabel }) {
  const [open, setOpen] = useState(false)
  const wrapRef = useRef(null)
  const buttonRef = useRef(null)
  const menuRef = useRef(null)
  const scoped = value != null
  const options = [{ id: null, name: all }, ...(items ?? [])]

  useEffect(() => {
    if (!open) return undefined
    const checked = menuRef.current?.querySelector('[aria-checked="true"]')
    ;(checked ?? menuRef.current?.querySelector('[role="menuitemradio"]'))?.focus()
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
  const pick = (id) => {
    close()
    if (id !== value) onChange(id)
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

  const label = scoped ? valueName ?? `${what} ${value}` : all

  return (
    <div className="dt-scope" ref={wrapRef}>
      <button
        ref={buttonRef}
        type="button"
        className={`dt-scope-btn${scoped ? ' is-scoped' : ''}`}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={`${what} scope: ${label}`}
        onClick={() => setOpen((o) => !o)}
      >
        {icon}
        <span className={scoped && valueName ? 'dt-farsi' : undefined}>{label}</span>
        <ChevronDown size={16} aria-hidden="true" />
      </button>
      {scoped && (
        <button
          type="button"
          className="dt-clear"
          onClick={() => onChange(null)}
          aria-label={clearLabel}
        >
          <X size={14} aria-hidden="true" />
        </button>
      )}
      {open && (
        <div className="dt-scope-menu" role="menu" aria-label={what} ref={menuRef} onKeyDown={onMenuKey}>
          {options.map((p) => {
            const checked = p.id === (value ?? null)
            return (
              <button
                key={p.id ?? 'all'}
                type="button"
                role="menuitemradio"
                aria-checked={checked}
                tabIndex={-1}
                className="dt-scope-option"
                onClick={() => pick(p.id)}
              >
                <span className={p.id == null ? undefined : 'dt-farsi'}>{p.name}</span>
                {checked && <Check size={16} aria-hidden="true" />}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}

/** The header's actions: how fresh the figures are, Refresh, and Export. */
export default function DashboardActions({ onRefresh, refreshing, generatedAt, onExport, exporting }) {
  const age = useTicking(generatedAt)
  return (
    <>
      {age && (
        <span className="dt-freshness" title={new Date(generatedAt).toLocaleString()}>
          <span className="dt-freshness-dot" aria-hidden="true" />
          Updated {age}
        </span>
      )}
      {/* The province is the one filter this page has; it is set from the
          scope button or the province table. Controls with nothing behind
          them (saved views, vendor, date range) stay off until they do
          something: a control that looks live and does nothing teaches a
          reader to distrust the ones that work. */}
      <button
        type="button"
        className="btn dt-icon-btn"
        onClick={onRefresh}
        disabled={refreshing}
        aria-label="Refresh"
        title={refreshing ? 'Refreshing…' : 'Refresh the dashboard'}
      >
        <RefreshCw size={16} aria-hidden="true" className={refreshing ? 'dt-spin' : undefined} />
      </button>
      <button type="button" className="btn" onClick={onExport} disabled={exporting}>
        <Download size={16} aria-hidden="true" />
        {exporting ? 'Preparing…' : 'Export'}
      </button>
    </>
  )
}

function useTicking(generatedAt) {
  const [, setTick] = useState(0)
  useEffect(() => {
    if (!generatedAt) return undefined
    const id = setInterval(() => setTick((t) => t + 1), 60000)
    return () => clearInterval(id)
  }, [generatedAt])
  return freshness(generatedAt)
}
