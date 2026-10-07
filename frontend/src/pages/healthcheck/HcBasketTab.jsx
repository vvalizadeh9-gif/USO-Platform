import { ClipboardList, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { useToast } from '../../context/ToastContext'
import AssignDock from '../../components/AssignDock'
import { Card, EmptyState, Loading, SegmentedControl } from '../../components/ui'
import ProvinceFilter from '../../components/ProvinceFilter'
import WaitingPill from '../../components/WaitingPill'
import { HC_POOL_WAITING } from '../../lib/waiting'

/** The pool's states, as the filter above the table offers them.
 *
 * The pool holds every on-air site whose drive test is not Done -- the
 * quantity the programme is managed against. Most of those sites are not
 * waiting to be assigned: they are inside a check, waiting on a PM's triage,
 * or waiting on somebody's fix. The state used to decide whether the row
 * existed at all, which made the pool figure answer a different question
 * from the one it is labelled with; now it decides how the row reads, and
 * the filter narrows to one state at a time.
 */
const STATES = [
  { key: 'all', label: 'All', match: () => true },
  { key: 'ready', label: 'Ready to assign', match: (b) => b.hc_state === 'New' || b.hc_state === 'Ready for re-check' },
  { key: 'checking', label: 'In health check', match: (b) => b.hc_state === 'In health check' },
  { key: 'triage', label: 'Awaiting triage', match: (b) => b.hc_state === 'Awaiting triage' },
  { key: 'fixing', label: 'Fix in progress', match: (b) => b.hc_state === 'Fix in progress' },
  { key: 'passed', label: 'Passed', match: (b) => b.hc_state === 'Health check passed' },
]

/** How a row names its state beside the site ID, when it is not the
 * ordinary "New". Every one says it in words, not colour alone. */
const STATE_PILL = {
  'In health check': { cls: 'pill-dim', title: 'Out with a subcontractor' },
  'Awaiting triage': { cls: 'pill-amber', title: 'Failed its check — a PM owes a categorisation' },
  'Fix in progress': { cls: 'pill-amber', title: 'An owner is working on a fix' },
  'Health check passed': { cls: 'pill-dim', title: 'Passed — waiting on its drive test' },
}

/** The drive-test status that keeps a site in the pool. */
const DT_PILL = { Ongoing: 'pill-violet', Problematic: 'pill-red' }

//: How many rows the table draws at a time. The pool is a programme quantity
//: -- on a full CPM import, every on-air site in the country whose drive test
//: is not Done -- and drawing thousands of rows costs a visibly slow page for
//: a list nobody scrolls to the end of. The search box, the province filter
//: and the state filter are how a Coordinator finds a site; "Load 200 more"
//: is there for the rest. The count above the table is always the whole
//: pool, so the cap never changes what the screen claims.
const PAGE = 200

export default function HcBasketTab({ onCountChange, initialState } = {}) {
  const toast = useToast()
  const [basket, setBasket] = useState(null)
  const [contractors, setContractors] = useState([])
  const [selected, setSelected] = useState(new Set())
  const [contractorId, setContractorId] = useState('')
  const [query, setQuery] = useState('')
  const [provinceSel, setProvinceSel] = useState(new Set())
  // ?state=ready (read by the page) opens the pool on one state -- the Action
  // Center's "Assign sites" ticket counts exactly the "Ready to assign" rows.
  const [state, setState] = useState(() =>
    STATES.some((s) => s.key === initialState) ? initialState : 'all',
  )
  const [limit, setLimit] = useState(PAGE)
  const [busy, setBusy] = useState(false)
  const [assigned, setAssigned] = useState(0)

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

  // Search and province narrow first; the state filter's counts are then
  // counts of what those left, so each option says how many it would show.
  const searched = useMemo(() => {
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

  const stateOptions = useMemo(
    () =>
      STATES.map((s) => ({
        key: s.key,
        label: (
          <>
            {s.label} <span className="seg-count tnum">{searched.filter(s.match).length.toLocaleString('en-US')}</span>
          </>
        ),
      })),
    [searched],
  )

  const filtered = useMemo(() => {
    const match = STATES.find((s) => s.key === state)?.match ?? (() => true)
    return searched.filter(match)
  }, [searched, state])

  function toggleProvince(p) {
    setProvinceSel((s) => {
      const next = new Set(s)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })
  }

  const visible = filtered.slice(0, limit)
  const readyCount = basket ? basket.filter((b) => b.assignable).length : 0

  // Only assignable rows can be selected, and only drawn ones: a site inside
  // an open check is refused by the server (409), and selecting rows that are
  // not drawn would assign sites nobody has looked at. The assignment
  // endpoint caps a request at 500 ids.
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
    else setSelected(new Set(assignable.slice(0, 500).map((b) => b.work_item_id)))
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
      setAssigned((n) => n + 1)
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
    <>
      <Card
        className="card-fill queue-card"
        icon={ClipboardList}
        title={
          <>
            Health Check Pool <span className="count-chip tnum">{basket.length.toLocaleString('en-US')}</span>
          </>
        }
        description="Tick the sites to check, then choose a subcontractor below."
        actions={
          <>
            <label className="search-box">
              <Search size={16} aria-hidden="true" />
              <input
                className="input"
                placeholder="Search site ID or type…"
                aria-label="Search site ID or type"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
            </label>
            <ProvinceFilter
              options={provinceOptions}
              selected={provinceSel}
              onToggle={toggleProvince}
              onClear={() => setProvinceSel(new Set())}
            />
          </>
        }
      >
        <div className="queue-toolbar">
          <SegmentedControl label="Pool state" options={stateOptions} value={state} onChange={setState} />
          {/* What the figure counts, said next to it: every on-air site whose
              drive test is not Done -- not the subset that can be assigned
              this minute, which is the second number. */}
          <span className="queue-meta">
            on-air sites without a completed drive test · {readyCount.toLocaleString('en-US')} ready to assign ·
            Sorted: waiting longest first
          </span>
        </div>

        {filtered.length === 0 ? (
          <EmptyState
            title="No sites in the health check pool"
            hint="On-air sites appear here once imported, and leave only when their drive test is Done."
          />
        ) : (
          <div className="table-scroll">
            <table className="table table-compact queue-table">
              <thead>
                <tr>
                  <th className="col-check">
                    <input
                      type="checkbox"
                      checked={selected.size === assignable.length && assignable.length > 0}
                      onChange={toggleAll}
                      disabled={assignable.length === 0}
                      aria-label="Select every site that can be assigned"
                    />
                  </th>
                  <th>Site ID</th>
                  <th>Province</th>
                  <th>Type</th>
                  <th>Requested tech</th>
                  <th>DT status</th>
                  <th>Waiting</th>
                </tr>
              </thead>
              <tbody>
                {visible.map((b) => (
                  <PoolRow
                    key={b.work_item_id}
                    site={b}
                    selected={selected.has(b.work_item_id)}
                    onToggle={() => toggle(b.work_item_id)}
                  />
                ))}
              </tbody>
            </table>
          </div>
        )}

        <div className="queue-foot">
          <span className="tnum">
            {visible.length.toLocaleString('en-US')} of {filtered.length.toLocaleString('en-US')} loaded
          </span>
          {visible.length < filtered.length && (
            <button type="button" className="btn btn-sm" onClick={() => setLimit((n) => n + PAGE)}>
              Load {Math.min(PAGE, filtered.length - visible.length)} more
            </button>
          )}
        </div>
      </Card>

      {basket.length > 0 && (
        <AssignDock
          kind="hc"
          selectedCount={selected.size}
          onClear={() => setSelected(new Set())}
          contractors={contractors}
          contractorId={contractorId}
          onSelectContractor={setContractorId}
          onAssign={assign}
          busy={busy}
          actionLabel="Assign health check"
          hint="Choose who does the checks: each shows the work they already hold."
          reloadKey={assigned}
        />
      )}
    </>
  )
}

function PoolRow({ site: b, selected, onToggle }) {
  const returning = b.hc_state === 'Ready for re-check' && b.round_no > 1
  const pill = STATE_PILL[b.hc_state]
  return (
    <tr
      onClick={onToggle}
      className={`${selected ? 'row-selected' : ''} ${b.assignable ? 'row-action' : 'row-muted'}`.trim()}
    >
      <td className="col-check">
        <input
          type="checkbox"
          checked={selected}
          disabled={!b.assignable}
          title={b.assignable ? undefined : pill?.title}
          aria-label={`Select ${b.site_code || 'site'}`}
          onChange={onToggle}
          onClick={(e) => e.stopPropagation()}
        />
      </td>
      <td>
        <span className="queue-site">
          <span className="queue-code">{b.site_code || '—'}</span>
          {/* Why this site reads the way it does: a returning site names its
              round and what was fixed; any state but the ordinary "New"
              says itself. */}
          {returning ? (
            <span className="pill pill-dim" title={`Round ${b.round_no} — returned after its fixes were closed`}>
              {b.returning_reason || `Round ${b.round_no}`}
            </span>
          ) : (
            pill && (
              <span className={`pill ${pill.cls}`} title={pill.title}>
                {b.hc_state}
              </span>
            )
          )}
        </span>
      </td>
      <td className="text-farsi">{b.province || '—'}</td>
      <td>{b.site_type || '—'}</td>
      <td>
        <span className="tech-chips">
          {b.requested_technologies.map((t) => (
            <span key={t} className="pill pill-dim">{t}</span>
          ))}
        </span>
      </td>
      {/* Why this site is in the pool: only a Done drive test takes a site
          out, and no status yet is a drive test not started. */}
      <td>
        <span className={`pill ${DT_PILL[b.dt_status] || 'pill-dim'}`}>{b.dt_status || 'Not started'}</span>
      </td>
      <td><WaitingPill days={b.days_waiting} thresholds={HC_POOL_WAITING} /></td>
    </tr>
  )
}
