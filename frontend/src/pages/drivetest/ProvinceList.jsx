import { ChevronRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { useAuth } from '../../context/AuthContext'
import { count, percent } from './format'
import { doneLink, onairLink, ongoingLink, problematicLink, remainingLink } from './links'
import { DrillLink } from './DrillPanel'

const BASE_COLUMNS = [
  { key: 'rank', label: '#', numeric: true },
  { key: 'name', label: 'Province' },
  { key: 'onair', label: 'On air', numeric: true },
  { key: 'done', label: 'DT Done', numeric: true },
  { key: 'remaining', label: 'Gap', numeric: true },
  { key: 'done_percent', label: 'DT completion', numeric: true },
  { key: 'ongoing', label: 'Ongoing', numeric: true },
  { key: 'problematic', label: 'Problematic', numeric: true },
]
const ACTION_COLUMN = { key: 'action', label: '', numeric: false }

/** How many provinces the table shows before "View all".
 *
 * The table used to show all 31 inside a 480px box with its own scrollbar --
 * a scroll inside a scrolling page, where the wheel moved one or the other
 * depending on where the pointer happened to be. It now shows the eight with
 * the most left to do (or the first eight of whatever it is sorted by) and
 * the page scrolls. Eight is about the height of the scorecard beside it. A
 * search shows every match: a reader who typed a name is looking for that
 * row, wherever it ranks. */
export const PROVINCE_ROWS = 8

/** The province search box, for the card header. Its value lives with the
 * page, which passes it back to the table. */
export function ProvinceSearch({ value, onChange }) {
  return (
    <div className="dt-province-search-wrap">
      <Search size={14} strokeWidth={2} aria-hidden="true" />
      <input
        type="text"
        className="dt-province-search"
        placeholder="Search province…"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label="Search provinces"
      />
    </div>
  )
}

export default function ProvinceList({ rows, provinces, onProvince, search = '' }) {
  const [sort, setSort] = useState({ key: 'remaining', dir: 'desc' })
  const [showAll, setShowAll] = useState(false)
  const { user } = useAuth()
  // A Viewer reads the table but never scopes the dashboard from it -- the
  // chevron says "act on this row", which is not true for an account that
  // cannot act on anything here.
  const isViewer = user?.role?.name === 'Viewer'
  const COLUMNS = isViewer ? BASE_COLUMNS : [...BASE_COLUMNS, ACTION_COLUMN]

  const byName = useMemo(() => {
    const map = new Map()
    for (const p of provinces || []) map.set(p.name, p.id)
    return map
  }, [provinces])

  const filtered = useMemo(() => {
    if (!search.trim()) return rows
    const q = search.trim().toLowerCase()
    return rows.filter((r) => r.name.toLowerCase().includes(q))
  }, [rows, search])

  const sorted = useMemo(() => {
    const copy = [...filtered]
    const sortKey = sort.key === 'rank' ? 'remaining' : sort.key
    copy.sort((a, b) => {
      const av = a[sortKey]
      const bv = b[sortKey]
      const cmp =
        typeof av === 'string' ? av.localeCompare(bv, 'fa') : (av ?? 0) - (bv ?? 0)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [filtered, sort])

  if (!rows || rows.length === 0) return <div className="dt-empty">No provinces to show.</div>

  const searching = search.trim() !== ''
  const capped = !searching && !showAll && sorted.length > PROVINCE_ROWS
  const visible = capped ? sorted.slice(0, PROVINCE_ROWS) : sorted

  const totalOnair = rows.reduce((sum, r) => sum + (r.onair ?? 0), 0)
  const totalDone = rows.reduce((sum, r) => sum + (r.done ?? 0), 0)
  const average = totalOnair ? (totalDone / totalOnair) * 100 : 0
  const rateColor = (value) =>
    value < average ? 'var(--dt-problem)' : 'var(--text)'

  const toggleSort = (key) => {
    if (key === 'action') return
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )
  }

  const stop = (e) => e.stopPropagation()

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={col.key === 'action' ? 'dt-th-action' : undefined}
                  style={{ textAlign: col.numeric ? 'right' : 'left' }}
                  aria-sort={
                    col.key === 'action'
                      ? undefined
                      : sort.key === col.key
                        ? sort.dir === 'asc' ? 'ascending' : 'descending'
                        : 'none'
                  }
                >
                  {col.key !== 'action' ? (
                    <button type="button" className="dt-sort-btn" onClick={() => toggleSort(col.key)}>
                      {col.label}
                    </button>
                  ) : null}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {visible.map((row, idx) => {
              const id = byName.get(row.name)
              const hasProblem = row.problematic > 0
              const donePct = row.done_percent ?? 0
              return (
                <tr
                  key={row.name}
                  className={`dt-province-card${hasProblem ? ' dt-row-problem' : ''}`}
                  role={id ? 'button' : undefined}
                  tabIndex={id ? 0 : undefined}
                  onClick={id ? () => onProvince(id) : undefined}
                  onKeyDown={
                    id
                      ? (e) => {
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault()
                            onProvince(id)
                          }
                        }
                      : undefined
                  }
                  aria-label={id ? `Narrow the whole dashboard to ${row.name}` : undefined}
                >
                  <td className="tnum dt-rank" style={{ textAlign: 'right' }}>
                    {idx + 1}
                  </td>
                  <td className="dt-farsi">
                    <span className="dt-province-name">{row.name}</span>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <Cell id={id} href={onairLink} value={row.onair} onClick={stop} label={row.name} />
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <Cell id={id} href={doneLink} value={row.done} onClick={stop} label={row.name} />
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <Cell id={id} href={remainingLink} value={row.remaining} onClick={stop} label={row.name} />
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <div className="dt-province-pbar-cell">
                      <span
                        className="dt-province-rate tnum"
                        style={{ color: rateColor(donePct) }}
                      >
                        {percent(donePct)}
                      </span>
                      <div className="dt-province-pbar">
                        <div
                          className="dt-province-pbar-fill"
                          style={{
                            width: `${Math.min(donePct, 100)}%`,
                            background: donePct >= average ? 'var(--dt-done)' : 'var(--dt-problem)',
                          }}
                        />
                      </div>
                    </div>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <Cell id={id} href={ongoingLink} value={row.ongoing} onClick={stop} label={row.name} />
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    {id && hasProblem ? (
                      <DrillLink
                        to={problematicLink({ provinceId: id })}
                        className="dt-cell-link-bad"
                        drillLabel={row.name}
                        onClick={stop}
                      >
                        {count(row.problematic)}
                      </DrillLink>
                    ) : (
                      <span className={hasProblem ? 'dt-cell-link-bad' : undefined}>
                        {count(row.problematic)}
                      </span>
                    )}
                  </td>
                  {!isViewer && (
                    <td className="dt-action-cell">
                      {id && (
                        <ChevronRight size={15} strokeWidth={2} className="dt-action-arrow" />
                      )}
                    </td>
                  )}
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {/* The count, the colour key and the fold on one line. The colour key
          stays on the card rather than behind the info icon: red is on every
          row, and a key a reader has to go looking for is not a key. */}
      <div className="dt-table-foot">
        <span>
          {searching
            ? `${count(sorted.length)} of ${count(rows.length)} provinces match`
            : `Showing ${count(visible.length)} of ${count(rows.length)} provinces`}
        </span>
        <span>Completion rate in red is below the {percent(average)} programme average.</span>
        {!searching && sorted.length > PROVINCE_ROWS && (
          <button type="button" className="dt-link-btn" onClick={() => setShowAll((v) => !v)}>
            {showAll ? 'Show fewer' : 'View all'}
          </button>
        )}
      </div>
    </>
  )
}

function Cell({ id, href, value, onClick, label }) {
  const text = count(value)
  if (!id) return <span>{text}</span>
  return (
    <DrillLink to={href({ provinceId: id })} className="dt-cell-link" drillLabel={label} onClick={onClick}>
      {text}
    </DrillLink>
  )
}
