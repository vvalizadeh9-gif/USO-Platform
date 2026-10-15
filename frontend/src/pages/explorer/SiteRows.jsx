import { useEffect, useRef } from 'react'
import { Link } from 'react-router-dom'
import Icon from '../../components/Icon'
import { Fa } from '../../components/work/parts'
import { siteRecordPath } from '../../lib/explorerLinks'
import { formatNumber } from '../../lib/numbers'
import { FIELD_ICONS } from './explorerModel'
import { COLUMNS, isNewSite, splitMatch, typeLabel } from './listModel'

const RISE_CAP = 20
const SKELETON_ROWS = 12

/** A column's line icon: the record tile's hue, no tile (UEP-11a §B4). */
function FieldIcon({ field, muted = false }) {
  const { icon, hue } = FIELD_ICONS[field]
  return (
    <span className={`exl-field-icon ${muted ? 'is-muted' : ''}`.trim()} style={muted ? undefined : { color: `var(${hue})` }} aria-hidden="true">
      <Icon name={icon} size={16} />
    </span>
  )
}

/** Text with the search match marked. */
function Marked({ text, term }) {
  return splitMatch(text, term).map((p, i) => (p.match ? <mark key={i}>{p.text}</mark> : <span key={i}>{p.text}</span>))
}

/** The sticky header: select-all, then a sort button per column. */
function HeaderRow({ sort, dir, onSort, allChecked, someChecked, onSelectAll, loaded }) {
  const all = useRef(null)
  useEffect(() => {
    if (all.current) all.current.indeterminate = someChecked && !allChecked
  }, [someChecked, allChecked])
  return (
    <div role="row" className="exl-row exl-head" aria-rowindex={1}>
      <span role="columnheader" className="exl-check-cell">
        <input
          ref={all}
          type="checkbox"
          className="exl-check"
          checked={allChecked}
          disabled={loaded === 0}
          aria-label="Select all loaded sites"
          onChange={(e) => onSelectAll(e.target.checked)}
        />
      </span>
      {COLUMNS.map((c) => {
        const active = sort === c.key
        return (
          <span key={c.key} role="columnheader" aria-sort={active ? (dir === 'asc' ? 'ascending' : 'descending') : undefined}>
            <button type="button" className={`exl-sort ${active ? 'is-active' : ''}`.trim()} onClick={() => onSort(c.key)}>
              {c.label}
              {active && <Icon name={dir === 'asc' ? 'arrow--up' : 'arrow--down'} size={16} />}
            </button>
          </span>
        )
      })}
      <span role="columnheader" className="exl-chev-cell"><span className="uw-sr-only">Open</span></span>
    </div>
  )
}

/** One site. The site code is the row's link, stretched over the row; the
 * checkbox and the villages pill sit above it and keep their own clicks. */
function SiteRow({ row, index, term, checked, onSelect, expanded, onToggle, rise }) {
  const count = row.hadaf_villages
  const stripId = `exl-villages-${row.id}`
  return (
    <div
      role="row"
      aria-rowindex={index + 2}
      className={`exl-row exl-site-row ${checked ? 'is-selected' : ''} ${rise ? 'is-rising' : ''}`.trim()}
      style={rise ? { '--exl-i': index } : undefined}
    >
      <span role="cell" className="exl-check-cell">
        <input
          type="checkbox"
          className="exl-check"
          checked={checked}
          aria-label={`Select ${row.site_code}`}
          onChange={(e) => onSelect(row.id, e.target.checked)}
        />
      </span>
      <span role="cell">
        <Link className="exl-site" to={siteRecordPath(row.id, row.village_match?.code)}>
          <Marked text={row.site_code} term={term} />
        </Link>
      </span>
      <span role="cell" className="exl-with-icon">
        <FieldIcon field="province" muted={!row.province} />
        <Fa>{row.province}</Fa>
      </span>
      <span role="cell" className={`exl-type ${isNewSite(row.type) ? 'is-new' : ''}`.trim()}>
        {typeLabel(row.type) || <span className="uw-none">—</span>}
      </span>
      <span role="cell" className="exl-with-icon">
        <FieldIcon field="technology" muted={row.requested_technology.length === 0} />
        {row.requested_technology.length ? (
          <span className="exl-techs">
            {row.requested_technology.map((t) => <span key={t} className="exl-tech">{t}</span>)}
          </span>
        ) : (
          <span className="uw-none">—</span>
        )}
      </span>
      <span role="cell">
        <button
          type="button"
          className="exl-villages-pill"
          aria-expanded={expanded}
          aria-controls={expanded ? stripId : undefined}
          aria-label={`${expanded ? 'Hide' : 'Show'} ${count} ${count === 1 ? 'village' : 'villages'} of ${row.site_code}`}
          disabled={count === 0}
          onClick={() => onToggle(row.id)}
        >
          <FieldIcon field="villages" />
          <span className="uw-num">{formatNumber(count)}</span>
          <Icon name="chevron--down" size={16} />
        </button>
      </span>
      <span role="cell" className="exl-with-icon">
        {row.dt_contractor ? (
          <>
            <FieldIcon field="dt_contractor" />
            <Fa>{row.dt_contractor.name}</Fa>
          </>
        ) : (
          <>
            <FieldIcon field="dt_contractor" muted />
            <span className="exl-unassigned">Not assigned</span>
          </>
        )}
      </span>
      <span role="cell" className="exl-chev-cell" aria-hidden="true">
        <Icon name="chevron--right" size={16} />
      </span>
    </div>
  )
}

/** The hadaf villages under a row, loaded when first opened. */
function VillageStrip({ row, villages }) {
  const match = row.village_match?.code
  return (
    <div role="row" className="exl-strip" id={`exl-villages-${row.id}`}>
      <span role="cell" aria-colspan={COLUMNS.length + 2} className="exl-strip-cell">
        {villages?.status === 'error' ? (
          <span className="uw-muted">Couldn't load the villages.</span>
        ) : !villages || villages.status === 'loading' ? (
          <span className="exl-strip-chips" aria-busy="true" aria-label="Loading villages">
            {[0, 1, 2].map((i) => <span key={i} className="h-skel exl-skel-chip" />)}
          </span>
        ) : (
          <ul className="exl-strip-chips" aria-label={`Hadaf villages of ${row.site_code}`}>
            {villages.list.map((v) => (
              <li key={v.code ?? v.name} className={`exl-village ${v.code && v.code === match ? 'is-match' : ''}`.trim()}>
                <Fa className="exl-village-name">{v.name}</Fa>
                <span className="exl-village-code uw-num">{v.code}</span>
              </li>
            ))}
          </ul>
        )}
      </span>
    </div>
  )
}

function SkeletonRow() {
  return (
    <div role="row" className="exl-row exl-skel-row" aria-hidden="true">
      <span />
      {COLUMNS.map((c) => <span key={c.key}><span className="h-skel exl-skel-line" /></span>)}
      <span />
    </div>
  )
}

/** Watches the end of the list and asks for the next page as it comes into view. */
function Sentinel({ root, onVisible, active }) {
  const ref = useRef(null)
  useEffect(() => {
    if (!active || typeof IntersectionObserver === 'undefined' || !ref.current) return undefined
    const observer = new IntersectionObserver(
      (entries) => entries.some((e) => e.isIntersecting) && onVisible(),
      { root: root.current, rootMargin: '200px 0px' },
    )
    observer.observe(ref.current)
    return () => observer.disconnect()
  }, [active, onVisible, root])
  return <div ref={ref} className="exl-sentinel" aria-hidden="true" />
}

/** ↑ and ↓ move between row links; Enter on a link opens it natively. */
function moveFocus(e) {
  if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
  if (!e.target.classList?.contains('exl-site')) return
  const links = [...e.currentTarget.querySelectorAll('.exl-site')]
  const next = links[links.indexOf(e.target) + (e.key === 'ArrowDown' ? 1 : -1)]
  if (!next) return
  e.preventDefault()
  next.focus()
  next.closest('[role="row"]')?.scrollIntoView?.({ block: 'nearest' })
}

/**
 * The list as a table (UEP-11a §B3–B6, §B8): header, rows, the open row's
 * villages, skeletons while the first page loads, and the line at the end
 * while the next page does.
 */
export default function SiteRows({
  list, state, onSort, selected, onSelect, onSelectAll, expanded, villages, onToggle, scrollRef,
}) {
  const loaded = list.items.length
  const checkedCount = list.items.filter((r) => selected.has(r.id)).length
  const animate = list.fresh > 0
  return (
    <div
      className="exl-table"
      role="table"
      aria-label="Sites"
      aria-rowcount={list.total != null ? list.total + 1 : -1}
      aria-busy={list.status === 'loading' || undefined}
    >
      <div role="rowgroup" className="exl-head-group">
        <HeaderRow
          sort={state.sort}
          dir={state.dir}
          onSort={onSort}
          loaded={loaded}
          allChecked={loaded > 0 && checkedCount === loaded}
          someChecked={checkedCount > 0}
          onSelectAll={onSelectAll}
        />
      </div>
      {list.status === 'loading' ? (
        <div role="rowgroup">
          {Array.from({ length: SKELETON_ROWS }, (_, i) => <SkeletonRow key={i} />)}
        </div>
      ) : (
        <div role="rowgroup" key={list.fresh} onKeyDown={moveFocus}>
          {list.items.map((row, i) => (
            <SiteRowGroup
              key={row.id}
              row={row}
              index={i}
              term={state.q}
              checked={selected.has(row.id)}
              onSelect={onSelect}
              expanded={expanded === row.id}
              villages={villages[row.id]}
              onToggle={onToggle}
              rise={animate && i < RISE_CAP}
            />
          ))}
        </div>
      )}
      {list.status === 'ready' && (
        <>
          <Sentinel root={scrollRef} onVisible={list.loadMore} active={Boolean(list.nextCursor) && !list.more && !list.moreError} />
          {list.more && (
            <p className="exl-more" role="status">
              <span className="exl-spinner" aria-hidden="true" /> Loading more sites
            </p>
          )}
          {list.moreError && (
            <p className="exl-more" role="alert">
              Couldn't load more sites.
              <button type="button" className="uw-btn uw-btn-sm" onClick={list.loadMore}>Retry</button>
            </p>
          )}
        </>
      )}
    </div>
  )
}

function SiteRowGroup({ row, expanded, villages, ...rest }) {
  return (
    <>
      <SiteRow row={row} expanded={expanded} {...rest} />
      {expanded && <VillageStrip row={row} villages={villages} />}
    </>
  )
}
