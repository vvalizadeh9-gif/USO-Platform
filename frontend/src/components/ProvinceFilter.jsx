import { ChevronDown } from 'lucide-react'
import { useState } from 'react'

/**
 * A province multi-select, extracted from the HC Pool unchanged so every
 * queue that needs a province filter gets the same behaviour and markup.
 */
export default function ProvinceFilter({ options, selected, onToggle, onClear }) {
  const [open, setOpen] = useState(false)

  return (
    <div style={{ position: 'relative' }}>
      <button
        type="button"
        className="input text-data row between"
        style={{ minWidth: 180, gap: 8, cursor: 'pointer' }}
        onClick={() => setOpen((o) => !o)}
      >
        <span>
          {selected.size === 0
            ? 'All provinces'
            : `${selected.size} province${selected.size > 1 ? 's' : ''}`}
        </span>
        <ChevronDown size={15} style={{ color: 'var(--text-dim)' }} />
      </button>
      {open && (
        <>
          <div
            style={{ position: 'fixed', inset: 0, zIndex: 40 }}
            onClick={() => setOpen(false)}
          />
          <div
            className="card"
            style={{
              position: 'absolute', top: 'calc(100% + 4px)', left: 0, zIndex: 50,
              width: 240, maxHeight: 300, overflowY: 'auto', padding: 6,
              boxShadow: 'var(--shadow-lg, 0 10px 30px rgba(0,0,0,0.15))',
            }}
          >
            <div className="row between" style={{ padding: '4px 8px 6px' }}>
              <span className="dim" style={{ fontSize: 12 }}>{selected.size} selected</span>
              {selected.size > 0 && (
                <button className="btn btn-ghost btn-sm" style={{ fontSize: 11.5 }} onClick={onClear}>
                  Clear
                </button>
              )}
            </div>
            {options.length === 0 && (
              <div className="dim" style={{ padding: '6px 8px', fontSize: 12.5 }}>No provinces</div>
            )}
            {options.map((p) => (
              <label
                key={p}
                className="row"
                style={{ gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
              >
                <input
                  type="checkbox"
                  checked={selected.has(p)}
                  onChange={() => onToggle(p)}
                />
                <span className="text-data">{p}</span>
              </label>
            ))}
          </div>
        </>
      )}
    </div>
  )
}
