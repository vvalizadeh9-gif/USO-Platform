import { ClipboardCheck, Search, ChevronDown } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { EmptyState, Loading } from '../../components/ui'

function BasketBadge({ count }) {
  // iOS-style pill badge: a red rounded count that shows how many sites are
  // currently sitting in the basket awaiting assignment.
  const label = count > 99 ? '99+' : String(count)
  return (
    <span
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        minWidth: 22,
        height: 22,
        padding: '0 7px',
        borderRadius: 11,
        background: count > 0 ? 'var(--red)' : 'var(--surface-3)',
        color: count > 0 ? '#fff' : 'var(--text-dim)',
        fontSize: 12.5,
        fontWeight: 700,
        lineHeight: 1,
      }}
    >
      {label}
    </span>
  )
}

export default function HcBasketTab() {
  const toast = useToast()
  const [basket, setBasket] = useState(null)
  const [contractors, setContractors] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [contractorId, setContractorId] = useState('')
  const [query, setQuery] = useState('')
  const [provinceSel, setProvinceSel] = useState(new Set())
  const [provMenu, setProvMenu] = useState(false)
  const [busy, setBusy] = useState(false)

  function load() {
    setSelected(new Set())
    api.get('/hc/basket').then((r) => setBasket(r.data)).catch(() => setBasket([]))
  }
  useEffect(() => {
    load()
    api.get('/reference/contractors').then((r) => setContractors(r.data)).catch(() => {})
  }, [])

  const provinceOptions = useMemo(() => {
    if (!basket) return []
    return [...new Set(basket.map((b) => b.province).filter(Boolean))].sort()
  }, [basket])

  const filtered = useMemo(() => {
    if (!basket) return []
    const q = query.trim().toLowerCase()
    return basket.filter((b) => {
      if (provinceSel.size && !provinceSel.has(b.province)) return false
      if (!q) return true
      return (
        (b.site_code || '').toLowerCase().includes(q) ||
        (b.site_type || '').toLowerCase().includes(q)
      )
    })
  }, [basket, query, provinceSel])

  function toggleProvince(p) {
    setProvinceSel((s) => {
      const next = new Set(s)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  function toggle(id) {
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleAll() {
    if (selected.size === filtered.length) setSelected(new Set())
    else setSelected(new Set(filtered.map((b) => b.work_item_id)))
  }

  async function assign() {
    if (!contractorId || selected.size === 0) return
    setBusy(true)
    try {
      const { data } = await api.post('/hc/assignments', {
        contractor_id: Number(contractorId),
        work_item_ids: [...selected],
      })
      toast.success('Assignment created', `${data.code} · ${selected.size} sites assigned.`)
      load()
    } catch (err) {
      toast.error('Assignment failed', err.response?.data?.detail || 'Please try again.')
    } finally {
      setBusy(false)
    }
  }

  if (!basket) return <Loading label="Loading health check basket" />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 15 }}>Health Check Basket</h3>
          <BasketBadge count={basket.length} />
          <span className="dim" style={{ fontSize: 12.5 }}>site{basket.length === 1 ? '' : 's'} awaiting assignment</span>
        </div>
        <div className="row between wrap" style={{ gap: 12 }}>
          <div style={{ position: 'relative', flex: 1, minWidth: 200 }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: 11, color: 'var(--text-dim)' }} />
            <input
              className="input"
              style={{ paddingLeft: 32 }}
              placeholder="Search site ID or type…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
          <div style={{ position: 'relative' }}>
            <button
              type="button"
              className="input text-data row between"
              style={{ minWidth: 180, gap: 8, cursor: 'pointer' }}
              onClick={() => setProvMenu((o) => !o)}
            >
              <span>
                {provinceSel.size === 0
                  ? 'All provinces'
                  : `${provinceSel.size} province${provinceSel.size > 1 ? 's' : ''}`}
              </span>
              <ChevronDown size={15} style={{ color: 'var(--text-dim)' }} />
            </button>
            {provMenu && (
              <>
                <div
                  style={{ position: 'fixed', inset: 0, zIndex: 40 }}
                  onClick={() => setProvMenu(false)}
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
                    <span className="dim" style={{ fontSize: 12 }}>{provinceSel.size} selected</span>
                    {provinceSel.size > 0 && (
                      <button className="btn btn-ghost btn-sm" style={{ fontSize: 11.5 }} onClick={() => setProvinceSel(new Set())}>
                        Clear
                      </button>
                    )}
                  </div>
                  {provinceOptions.length === 0 && (
                    <div className="dim" style={{ padding: '6px 8px', fontSize: 12.5 }}>No provinces</div>
                  )}
                  {provinceOptions.map((p) => (
                    <label
                      key={p}
                      className="row"
                      style={{ gap: 8, padding: '6px 8px', borderRadius: 6, cursor: 'pointer', fontSize: 13 }}
                    >
                      <input
                        type="checkbox"
                        checked={provinceSel.has(p)}
                        onChange={() => toggleProvince(p)}
                      />
                      <span className="text-data">{p}</span>
                    </label>
                  ))}
                </div>
              </>
            )}
          </div>
        </div>

        {/* Subcontractor is a small, fixed set — clickable chips are quicker
            for the PM than opening a dropdown. */}
        <div className="row between wrap" style={{ gap: 12, marginTop: 12, alignItems: 'flex-end' }}>
          <div style={{ flex: 1, minWidth: 240 }}>
            <label className="dim" style={{ fontSize: 11.5, textTransform: 'uppercase', letterSpacing: 0.3, display: 'block', marginBottom: 6 }}>
              Assign to subcontractor
            </label>
            <div className="row wrap" style={{ gap: 8 }}>
              {contractors.length === 0 ? (
                <span className="dim" style={{ fontSize: 12.5 }}>No subcontractors available</span>
              ) : (
                contractors.map((c) => {
                  const active = String(contractorId) === String(c.id)
                  return (
                    <button
                      key={c.id}
                      type="button"
                      className="btn btn-sm"
                      onClick={() => setContractorId(active ? '' : String(c.id))}
                      style={{
                        background: active ? 'var(--signal)' : 'var(--surface-2)',
                        color: active ? '#fff' : 'var(--text-muted)',
                        border: active ? 'none' : '1px solid var(--border)',
                      }}
                    >
                      {c.name}
                    </button>
                  )
                })
              )}
            </div>
          </div>
          <button
            className="btn btn-primary"
            disabled={!contractorId || selected.size === 0 || busy}
            onClick={assign}
          >
            {busy ? <div className="spinner" /> : <><ClipboardCheck size={15} /> Assign ({selected.size})</>}
          </button>
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 20 }}>
          <EmptyState title="No sites awaiting health check" hint="On-air sites appear here once imported." />
        </div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input type="checkbox" checked={selected.size === filtered.length && filtered.length > 0} onChange={toggleAll} />
                </th>
                <th>Site ID</th>
                <th>Province</th>
                <th>Type</th>
                <th>Requested Tech</th>
                <th>Status</th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((b) => (
                <tr
                  key={b.work_item_id}
                  onClick={() => toggle(b.work_item_id)}
                  className={selected.has(b.work_item_id) ? 'row-selected' : ''}
                  style={{
                    cursor: 'pointer',
                    // Only set an inline background when selected; leaving it
                    // unset lets the CSS `tbody tr:hover` rule show the hover
                    // highlight on non-selected rows (an inline 'transparent'
                    // here would override and kill the hover effect).
                    ...(selected.has(b.work_item_id)
                      ? { background: 'var(--signal-glow)' }
                      : {}),
                  }}
                >
                  <td><input type="checkbox" checked={selected.has(b.work_item_id)} onChange={() => toggle(b.work_item_id)} onClick={(e) => e.stopPropagation()} /></td>
                  <td className="text-data" style={{ fontWeight: 500 }}>{b.site_code || '—'}</td>
                  <td className="text-data dim">{b.province || '—'}</td>
                  <td className="text-data">{b.site_type}</td>
                  <td>
                    <div className="row" style={{ gap: 5 }}>
                      {b.requested_technologies.map((t) => (
                        <span key={t} className="pill pill-dim" style={{ fontSize: 11.5 }}>{t}</span>
                      ))}
                    </div>
                  </td>
                  {/* Only returning sites say anything here. A first-ever
                      check is the normal case and stays quiet, so a re-check
                      stands out without having to read the whole row. */}
                  <td>
                    {b.round_no > 1 ? (
                      <span
                        className="pill pill-cyan"
                        style={{ fontSize: 11.5 }}
                        title={`Round ${b.round_no} — returned after its fixes were closed`}
                      >
                        {b.returning_reason || `Round ${b.round_no}`}
                      </span>
                    ) : (
                      <span className="dim" style={{ fontSize: 12.5 }}>New</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
