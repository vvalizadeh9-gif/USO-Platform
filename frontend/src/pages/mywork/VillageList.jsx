import { useEffect, useRef } from 'react'
import { Search, X } from 'lucide-react'
import { BarLegend, MiniBar } from './StatusBar'
import { SORTS } from './useMyWork'

/** Loads the next page when the end of the list scrolls into view. */
function useEndOfList(onEnd, enabled) {
  const ref = useRef(null)
  useEffect(() => {
    const node = ref.current
    if (!node || !enabled || typeof IntersectionObserver === 'undefined') return undefined
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((e) => e.isIntersecting)) onEnd()
    })
    observer.observe(node)
    return () => observer.disconnect()
  }, [onEnd, enabled])
  return ref
}

function VillageRow({ row, view, focused, ticked, onFocus, onTick, statusFor }) {
  const meta = view === 'staff' && row.contractor_name
    ? `${row.village_code} · ${row.contractor_name}`
    : row.village_code
  return (
    <div className={`mw-row${focused ? ' is-focus' : ''}${ticked ? ' is-ticked' : ''}`}>
      <input
        type="checkbox"
        className="mw-check"
        checked={ticked}
        onChange={() => onTick(row.village_id)}
        aria-label={`Tick ${row.village_name}`}
      />
      <button type="button" className="mw-row-main" aria-current={focused ? 'true' : undefined} onClick={() => onFocus(row.village_id)}>
        <span className="mw-row-text">
          <span className="mw-row-name">
            <span className="mw-village-name" dir="auto">{row.village_name}</span>
            {row.refiling_round && <span className="mw-round-tag">Round {row.refiling_round}</span>}
          </span>
          <span className="mw-row-meta">
            <span className="mw-meta-text">{meta}</span>
            <span className={row.long_wait ? 'mw-days is-long' : 'mw-days'}>{'\u00a0· '}{row.days_waiting ?? '—'} d</span>
          </span>
        </span>
        {['ICT', 'CRA'].map((authority) => (
          <MiniBar key={authority} authority={authority} status={statusFor(row, authority)} view={view} />
        ))}
      </button>
    </div>
  )
}

/** The queue card on the left: the only part of the page that scrolls. */
export default function VillageList({
  view, rows, total, sort, onSort, query, onQuery, paste, onTickPasted,
  focusId, ticked, onFocus, onTick, onTickAll, statusFor, hasMore, onMore, emptyHint, onReset, resetLabel, error,
}) {
  const endRef = useEndOfList(onMore, hasMore)
  const allTicked = rows.length > 0 && rows.every((r) => ticked.includes(r.village_id))
  const multi = ticked.length > 1
  return (
    <section className="ui-card mw-list" aria-label="Villages">
      <div className="mw-list-head">
        <div className="mw-list-title-row">
          <h2 className="mw-card-title">Villages</h2>
          <span className="count-chip tnum">{total}</span>
          <span className="mw-grow" />
          <select className="mw-select" aria-label="Sort" value={sort} onChange={(e) => onSort(e.target.value)}>
            {SORTS.map((s) => <option key={s.key} value={s.key}>{s.label}</option>)}
          </select>
        </div>
        <label className="mw-search">
          <Search size={16} aria-hidden="true" />
          <input
            aria-label="Search, or paste village codes"
            placeholder="Search or paste codes"
            value={query}
            onChange={(e) => onQuery(e.target.value)}
          />
          {query && (
            <button type="button" className="mw-icon-btn" aria-label="Clear search" onClick={() => onQuery('')}>
              <X size={16} aria-hidden="true" />
            </button>
          )}
        </label>
        {paste && (
          <div className="mw-paste" role="status">
            <span>
              {paste.matched.length} of {paste.total} codes found
              {paste.unmatched.length > 0 && ` · ${paste.unmatched.length} not in your list`}
            </span>
            <button type="button" className="btn btn-sm" onClick={onTickPasted} disabled={!paste.ids.length}>Tick</button>
          </div>
        )}
      </div>
      <div className="mw-list-header">
        <input
          type="checkbox"
          className="mw-check"
          checked={allTicked}
          onChange={() => onTickAll(allTicked)}
          aria-label="Tick every village in this list"
        />
        <span className="mw-grow">{ticked.length ? `${ticked.length} ticked` : 'Village'}</span>
        <span className="mw-col-auth">ICT</span>
        <span className="mw-col-auth">CRA</span>
      </div>
      <div className="mw-list-scroll table-scroll">
        {error && <div className="mw-list-empty">{error}</div>}
        {!error && rows.length === 0 && (
          <div className="mw-list-empty">
            <span className="mw-strong">{emptyHint}</span>
            <button type="button" className="btn btn-sm" onClick={onReset}>{resetLabel}</button>
          </div>
        )}
        {rows.map((row) => (
          <VillageRow
            key={row.village_id}
            row={row}
            view={view}
            focused={!multi && row.village_id === focusId}
            ticked={ticked.includes(row.village_id)}
            onFocus={onFocus}
            onTick={onTick}
            statusFor={statusFor}
          />
        ))}
        {hasMore && <div ref={endRef} className="mw-list-more" aria-hidden="true" />}
      </div>
      <BarLegend view={view} />
    </section>
  )
}
