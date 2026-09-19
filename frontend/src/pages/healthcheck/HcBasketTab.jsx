import { ClipboardCheck, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import { EmptyState, Loading } from '../../components/ui'
import BulkActionBar from '../../components/BulkActionBar'
import ProvinceFilter from '../../components/ProvinceFilter'
import WaitingPill from '../../components/WaitingPill'

/** How each pool state reads, and whether it is worth shouting about.
 *
 * The pool holds every on-air site whose drive test is not Done — that is
 * the quantity the programme is managed against. Most of those sites are not
 * waiting to be assigned: they are inside a check, waiting on a PM's triage,
 * or waiting on somebody's fix. The state used to decide whether the row
 * existed at all, which made the pool figure answer a different question
 * from the one it is labelled with; now it decides how the row reads.
 */
const STATE_PILL = {
  New: null, // the ordinary case stays quiet
  'In health check': { cls: 'pill-dim', title: 'Out with a subcontractor' },
  'Awaiting triage': {
    cls: 'pill-amber',
    title: 'Failed its check — a PM owes a categorisation',
  },
  'Fix in progress': { cls: 'pill-amber', title: 'An owner is working on a fix' },
  'Health check passed': { cls: 'pill-dim', title: 'Passed — waiting on its drive test' },
}

//: How many rows the table draws before folding the rest behind a button.
//
// The pool is a programme quantity now, not a shortlist: on a full CPM import
// it is every on-air site in the country whose drive test is not Done, which
// is thousands of rows. Drawing all of them costs a visibly slow page for a
// list nobody scrolls to the end of — the search box and the province filter
// are how a Coordinator actually finds a site. The count above the table is
// always the whole pool, so the cap never changes what the screen claims.
const RENDER_LIMIT = 200

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

export default function HcBasketTab({ onCountChange } = {}) {
  const toast = useToast()
  const [basket, setBasket] = useState(null)
  const [contractors, setContractors] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [contractorId, setContractorId] = useState('')
  const [query, setQuery] = useState('')
  const [provinceSel, setProvinceSel] = useState(new Set())
  const [busy, setBusy] = useState(false)

  function load() {
    setSelected(new Set())
    api
      .get('/hc/basket')
      .then((r) => {
        setBasket(r.data)
        onCountChange?.(r.data.length)
      })
      .catch(() => setBasket([]))
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

  const [showAll, setShowAll] = useState(false)
  const visible = showAll ? filtered : filtered.slice(0, RENDER_LIMIT)
  const folded = filtered.length - visible.length

  // Only assignable rows can be selected, and only drawn ones: a site inside
  // an open check is refused by the server (409), and selecting rows that are
  // folded away would assign sites nobody has looked at. The assignment
  // endpoint caps a request at 500 ids, which the render limit keeps under.
  const assignable = useMemo(() => visible.filter((b) => b.assignable), [visible])

  // A filter can hide a row that is still selected, and a reload can turn a
  // selected row unassignable. Selection only ever covers what is on screen
  // and can still be acted on, so such a row drops out rather than being
  // sent to an endpoint that will refuse it.
  useEffect(() => {
    setSelected((prev) => {
      const live = new Set(assignable.map((b) => b.work_item_id))
      const next = new Set([...prev].filter((id) => live.has(id)))
      return next.size === prev.size ? prev : next
    })
  }, [assignable])

  function toggle(id) {
    if (!visible.find((b) => b.work_item_id === id)?.assignable) return
    setSelected((s) => {
      const next = new Set(s)
      next.has(id) ? next.delete(id) : next.add(id)
      return next
    })
  }
  function toggleAll() {
    if (selected.size === assignable.length) setSelected(new Set())
    else setSelected(new Set(assignable.map((b) => b.work_item_id)))
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
      // 409 means somebody assigned one of these while this page was open.
      // Reloading is the answer the message tells them to give.
      if (err.response?.status === 409) load()
    } finally {
      setBusy(false)
    }
  }

  if (!basket) return <Loading label="Loading health check basket" />

  return (
    <div className="card" style={{ overflow: 'hidden' }}>
      <div className="card-pad" style={{ paddingBottom: 12 }}>
        <div className="row" style={{ gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <h3 style={{ fontSize: 15 }}>Health Check Pool</h3>
          <BasketBadge count={basket.length} />
          {/* What the figure counts, said next to it. It is every on-air site
              whose drive test is not Done — not the subset that can be
              assigned this minute, which is the second number. */}
          <span className="dim" style={{ fontSize: 12.5 }}>
            on-air site{basket.length === 1 ? '' : 's'} without a completed drive test
            {' · '}
            {basket.filter((b) => b.assignable).length} ready to assign
          </span>
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
          <ProvinceFilter
            options={provinceOptions}
            selected={provinceSel}
            onToggle={toggleProvince}
            onClear={() => setProvinceSel(new Set())}
          />
        </div>
        <div className="row between" style={{ marginTop: 8 }}>
          <span className="dim" style={{ fontSize: 11.5 }}>Sorted: waiting longest first</span>
          {(query.trim() || provinceSel.size > 0) && (
            <span className="dim" style={{ fontSize: 11.5 }}>
              {filtered.length} of {basket.length}
            </span>
          )}
        </div>
      </div>

      {filtered.length === 0 ? (
        <div style={{ padding: 20 }}>
          <EmptyState
            title="No sites in the health check pool"
            hint="On-air sites appear here once imported, and leave only when their drive test is Done."
          />
        </div>
      ) : (
        <div style={{ maxHeight: 520, overflowY: 'auto' }}>
          <table>
            <thead>
              <tr>
                <th style={{ width: 40 }}>
                  <input
                    type="checkbox"
                    checked={selected.size === assignable.length && assignable.length > 0}
                    onChange={toggleAll}
                    disabled={assignable.length === 0}
                    title="Select every site that can be assigned"
                  />
                </th>
                <th>Site ID</th>
                <th>Province</th>
                <th>Type</th>
                <th>Requested Tech</th>
                <th>DT status</th>
                <th>Status</th>
                <th>Waiting</th>
              </tr>
            </thead>
            <tbody>
              {visible.map((b) => (
                <tr
                  key={b.work_item_id}
                  onClick={() => toggle(b.work_item_id)}
                  className={selected.has(b.work_item_id) ? 'row-selected' : ''}
                  style={{
                    cursor: b.assignable ? 'pointer' : 'default',
                    // A site that cannot be assigned right now still belongs
                    // to the pool figure, so it stays on screen — dimmed,
                    // which is what says "counted, not actionable".
                    opacity: b.assignable ? 1 : 0.62,
                    // Only set an inline background when selected; leaving it
                    // unset lets the CSS `tbody tr:hover` rule show the hover
                    // highlight on non-selected rows (an inline 'transparent'
                    // here would override and kill the hover effect).
                    ...(selected.has(b.work_item_id)
                      ? { background: 'var(--signal-glow)' }
                      : {}),
                  }}
                >
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(b.work_item_id)}
                      disabled={!b.assignable}
                      title={b.assignable ? undefined : STATE_PILL[b.hc_state]?.title}
                      onChange={() => toggle(b.work_item_id)}
                      onClick={(e) => e.stopPropagation()}
                    />
                  </td>
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
                  {/* Why this site is in the pool. Ongoing and Problematic
                      both belong here — only a Done drive test takes a site
                      out — and a blank column is a drive test not started. */}
                  <td>
                    <span className="dim" style={{ fontSize: 12.5 }}>
                      {b.dt_status || 'Not started'}
                    </span>
                  </td>
                  {/* Where the site is in the health-check loop. A returning
                      site names its round and what was fixed; anything that
                      is not plainly assignable says so, because the pool is
                      the quantity rather than the queue. */}
                  <td>
                    {b.hc_state === 'Ready for re-check' && b.round_no > 1 ? (
                      <span
                        className="pill pill-cyan"
                        style={{ fontSize: 11.5 }}
                        title={`Round ${b.round_no} — returned after its fixes were closed`}
                      >
                        {b.returning_reason || `Round ${b.round_no}`}
                      </span>
                    ) : STATE_PILL[b.hc_state] ? (
                      <span
                        className={`pill ${STATE_PILL[b.hc_state].cls}`}
                        style={{ fontSize: 11.5 }}
                        title={STATE_PILL[b.hc_state].title}
                      >
                        {b.hc_state}
                      </span>
                    ) : (
                      <span className="dim" style={{ fontSize: 12.5 }}>{b.hc_state}</span>
                    )}
                  </td>
                  <td><WaitingPill days={b.days_waiting} /></td>
                </tr>
              ))}
            </tbody>
          </table>
          {folded > 0 && (
            <div className="row center" style={{ padding: '10px 0 14px' }}>
              <button
                type="button"
                className="btn btn-sm btn-ghost"
                onClick={() => setShowAll(true)}
              >
                Show all {filtered.length} — {folded} more not drawn
              </button>
            </div>
          )}
        </div>
      )}

      {basket.length > 0 && (
        <BulkActionBar
          selectedCount={selected.size}
          onClear={() => setSelected(new Set())}
          contractors={contractors}
          contractorId={contractorId}
          onSelectContractor={setContractorId}
          onAssign={assign}
          busy={busy}
          primaryLabel={`Assign health check (${selected.size})`}
          primaryIcon={ClipboardCheck}
        />
      )}
    </div>
  )
}
