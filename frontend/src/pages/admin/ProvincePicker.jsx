import { Check, Search, X } from 'lucide-react'
import { useMemo, useState } from 'react'

// Searchable multi-select province picker. Clearer than a flat button list
// when there are many provinces: search box, select-all / clear, live count,
// and scrollable checkbox list.
//
// Lifted out of UsersTab when that file grew a status dialog, a reset dialog
// and a history drawer. It has nothing to do with users specifically — it is
// the province half of "what may this person see".
export default function ProvincePicker({ provinces, selected, onChange }) {
  const [query, setQuery] = useState('')

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return provinces
    return provinces.filter((p) => p.name.toLowerCase().includes(q))
  }, [provinces, query])

  function toggle(id) {
    onChange(
      selected.includes(id)
        ? selected.filter((x) => x !== id)
        : [...selected, id],
    )
  }
  const selectAllFiltered = () =>
    onChange([...new Set([...selected, ...filtered.map((p) => p.id)])])
  const clearAll = () => onChange([])

  if (provinces.length === 0) {
    return (
      <div className="field">
        <label>Grant province access</label>
        <span className="dim">Import a CPM file first to populate provinces.</span>
      </div>
    )
  }

  return (
    <div className="field">
      <div className="row between" style={{ marginBottom: 6 }}>
        <label style={{ margin: 0 }}>Grant province access</label>
        <span className="dim" style={{ fontSize: 12 }}>
          {selected.length} selected
        </span>
      </div>

      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <div style={{ position: 'relative', flex: 1 }}>
          <Search
            size={15}
            style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }}
          />
          <input
            className="input"
            style={{ paddingLeft: 32 }}
            placeholder="Search provinces…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <button type="button" className="btn btn-sm" onClick={selectAllFiltered}>
          <Check size={14} /> All
        </button>
        <button type="button" className="btn btn-sm btn-ghost" onClick={clearAll}>
          <X size={14} /> Clear
        </button>
      </div>

      <div
        style={{
          maxHeight: 220,
          overflowY: 'auto',
          border: '1px solid var(--border)',
          borderRadius: 'var(--radius-sm)',
          padding: 6,
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
          gap: 2,
        }}
      >
        {filtered.map((p) => {
          const on = selected.includes(p.id)
          return (
            <label
              key={p.id}
              className="row"
              style={{
                gap: 9,
                padding: '7px 10px',
                borderRadius: 6,
                cursor: 'pointer',
                background: on ? 'var(--signal-glow)' : 'transparent',
                transition: 'background 0.13s',
              }}
            >
              <input type="checkbox" checked={on} onChange={() => toggle(p.id)} />
              <span className="text-data" style={{ color: on ? 'var(--signal-strong)' : 'var(--text)' }}>
                {p.name}
              </span>
            </label>
          )
        })}
        {filtered.length === 0 && (
          <span className="dim" style={{ padding: 10, fontSize: 13 }}>
            No provinces match “{query}”.
          </span>
        )}
      </div>
    </div>
  )
}
