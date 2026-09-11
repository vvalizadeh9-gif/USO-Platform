import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronUp, Filter } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PROVINCE_LIMIT } from './constants'
import { count, percent, progressColor } from './format'
import { ongoingLink, problematicLink } from './links'

/**
 * Every province's full picture, sortable, worst first by default.
 *
 * This table now replaces three views the old dashboard also had: ongoing by
 * province, problematic by province, and a second "progress per province"
 * table in the bottom corner. All three were strict subsets of these columns,
 * and a reader asking "how is Kerman doing" had four places to look and no
 * reason to prefer one.
 *
 * The default sort is remaining descending, which is where the outstanding
 * work is. Sorting is now the reader's to change — the old table fixed the
 * order on the grounds that re-sorting by name would bury the answer, which
 * is true of *that* sort and not of sorting in general.
 */

const COLUMNS = [
  { key: 'name', label: 'Province', align: 'left', numeric: false },
  { key: 'onair', label: 'On-air', align: 'right', numeric: true },
  { key: 'done', label: 'Done', align: 'right', numeric: true },
  { key: 'remaining', label: 'Remaining', align: 'right', numeric: true },
  { key: 'ongoing', label: 'Ongoing', align: 'right', numeric: true },
  { key: 'problematic', label: 'Problematic', align: 'right', numeric: true },
  { key: 'done_percent', label: 'Progress', align: 'right', numeric: true },
]

export default function ProvinceTable({ rows, provinces, onProvince }) {
  const reduced = useReducedMotion()
  const [expanded, setExpanded] = useState(false)
  const [sort, setSort] = useState({ key: 'remaining', dir: 'desc' })

  const byName = useMemo(() => {
    const map = new Map()
    for (const p of provinces || []) map.set(p.name, p.id)
    return map
  }, [provinces])

  const sorted = useMemo(() => {
    const copy = [...rows]
    copy.sort((a, b) => {
      const av = a[sort.key]
      const bv = b[sort.key]
      const cmp =
        typeof av === 'string' ? av.localeCompare(bv, 'fa') : (av ?? 0) - (bv ?? 0)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sort])

  if (!rows || rows.length === 0) return <div className="dt-empty">No provinces to show.</div>

  const visible = expanded ? sorted : sorted.slice(0, PROVINCE_LIMIT)
  const hidden = sorted.length - visible.length

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )

  return (
    <>
      <div className="table-wrap scroll-x">
        <table className="dt-province-table">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{ textAlign: col.align }}
                  aria-sort={
                    sort.key === col.key
                      ? sort.dir === 'asc'
                        ? 'ascending'
                        : 'descending'
                      : 'none'
                  }
                >
                  <button
                    type="button"
                    className="dt-sort-btn"
                    onClick={() => toggleSort(col.key)}
                  >
                    {col.label}
                    {sort.key === col.key &&
                      (sort.dir === 'asc' ? (
                        <ChevronUp size={12} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={12} aria-hidden="true" />
                      ))}
                  </button>
                </th>
              ))}
              <th scope="col" className="dt-col-action">
                <span className="dt-sr-only">Filter</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {visible.map((row, i) => {
              const id = byName.get(row.name)
              return (
                <motion.tr
                  key={row.name}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.02, 0.2), duration: 0.25 }}
                >
                  <td className="dt-farsi" style={{ fontWeight: 500 }}>{row.name}</td>
                  <td className="tnum" style={{ textAlign: 'right' }}>{count(row.onair)}</td>
                  <td className="tnum dt-good" style={{ textAlign: 'right' }}>{count(row.done)}</td>
                  <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>
                    {count(row.remaining)}
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    {id ? (
                      <Link to={ongoingLink({ provinceId: id })} className="dt-cell-link">
                        {count(row.ongoing)}
                      </Link>
                    ) : (
                      count(row.ongoing)
                    )}
                  </td>
                  <td
                    className="tnum"
                    style={{ textAlign: 'right', color: row.problematic > 0 ? 'var(--red)' : undefined }}
                  >
                    {id && row.problematic > 0 ? (
                      <Link to={problematicLink({ provinceId: id })} className="dt-cell-link dt-cell-link-bad">
                        {count(row.problematic)}
                      </Link>
                    ) : (
                      count(row.problematic)
                    )}
                  </td>
                  <td>
                    <span className="dt-progress-cell">
                      <span className="dt-progress-track" aria-hidden="true">
                        <motion.span
                          data-testid="dt-bar"
                          style={{
                            width: `${row.done_percent}%`,
                            background: progressColor(row.done_percent),
                            transformOrigin: 'left center',
                          }}
                          initial={reduced ? false : { scaleX: 0 }}
                          animate={{ scaleX: 1 }}
                          transition={{ duration: 0.5, delay: Math.min(i * 0.03, 0.25) }}
                        />
                      </span>
                      <span className="tnum dt-progress-pct">{percent(row.done_percent)}</span>
                    </span>
                  </td>
                  <td className="dt-col-action">
                    {id && (
                      <button
                        type="button"
                        className="dt-row-filter"
                        onClick={() => onProvince(id)}
                        title={`Narrow the whole dashboard to ${row.name}`}
                        aria-label={`Narrow the whole dashboard to ${row.name}`}
                      >
                        <Filter size={13} aria-hidden="true" />
                      </button>
                    )}
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {sorted.length > PROVINCE_LIMIT && (
        <div className="dt-expand">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? `Show top ${PROVINCE_LIMIT}` : `Show all ${sorted.length} provinces`}
          </button>
          {!expanded && <span className="dt-note-inline">{hidden} more not shown</span>}
        </div>
      )}
    </>
  )
}
