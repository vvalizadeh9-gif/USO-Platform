import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { STATE_COLOR, UNATTRIBUTED } from './constants'
import { bookScale, count, percent, progressColor } from './format'
import {
  assignedLink,
  doneLink,
  notStartedLink,
  ongoingLink,
  problematicLink,
} from './links'
import BookBar from './charts/BookBar'

/**
 * Each contractor's assignment, and how much of it is finished.
 *
 * WHAT "ASSIGNMENT" MEANS HERE, because it is the whole basis of the ranking:
 * the drive tests a company has completed, plus the sites it is still
 * holding. Nothing else. It is deliberately not every on-air site that
 * carries the company's name — a site sitting in a problem category, or one
 * sent out for a health check, has not been committed to them, and dividing
 * by it would mark a company down for work the programme never handed over.
 * Problematic sites keep a column, because they are worth seeing; they are
 * simply not part of the book being scored. The backend computes it the same
 * way — see `_contractor_scorecard`.
 *
 * WHAT CHANGED IN THE CHART. The rate used to be a fixed-width track with a
 * fill, one per row. Every row was therefore the same width, so a company at
 * 62% of twelve sites drew the identical bar to one at 62% of four hundred,
 * and the column ranked two situations that call for opposite decisions as
 * though they were the same. The bar is now sized to the book as well as
 * filled by it — see `charts/BookBar`.
 *
 * The unattributed row sits last and is styled apart. It is not a company and
 * cannot be beaten or beat anyone; the backend sorts it out of the ranking
 * for the same reason, and re-sorting here keeps it there whichever column is
 * chosen. Its cells still open their sites, through `contractor_id=none`:
 * "nobody holds these" is a real list, and the one most worth reading.
 *
 * SORTING IS THE READER'S. The rows arrive ranked by completion, which is the
 * right default and the wrong thing to be stuck with: "who is holding the
 * most" and "who has the most problems" are the next two questions anybody
 * asks of this table, and both are a column already on screen. Same mechanics
 * as the province table, so the two tables behave alike.
 */

const COLUMNS = [
  { key: 'name', label: 'Contractor', align: 'left', numeric: false },
  { key: 'assigned', label: 'Assignment', align: 'right', numeric: true },
  { key: 'done', label: 'DT done', align: 'right', numeric: true },
  { key: 'ongoing', label: 'Ongoing', align: 'right', numeric: true },
  { key: 'problematic', label: 'Problematic', align: 'right', numeric: true },
  // Outside the assignment, like Problematic: a site nobody has begun a
  // drive test on is not work the company has been committed to. It is on
  // the row because "you carry forty sites nobody has started" is the kind
  // of thing this table exists to make visible.
  { key: 'not_started', label: 'Not started', align: 'right', numeric: true },
  { key: 'done_percent', label: 'Done', align: 'right', numeric: true },
]

/** A contractor's assignment: drive tests finished plus sites still held.
 *
 * Derived here rather than read straight off the row. It is the definition --
 * the backend computes the very same sum -- so there is nothing to disagree
 * with, and a payload that arrives without the field renders the figure
 * instead of a dash. A dash in this column is the worst possible failure for
 * this table: it is the denominator every rate on the row divides by, so a
 * reader who cannot see it cannot check any of the others.
 */
function assignmentOf(row) {
  if (row.assigned != null) return row.assigned
  return (row.done ?? 0) + (row.ongoing ?? 0)
}

export default function ContractorScorecard({ rows, provinceId }) {
  const reduced = useReducedMotion()
  // `null` means "as the server ranked them" — by completion, with the
  // unattributed row already last. Re-sorting is something the reader turns
  // on, not a default this component imposes over the one it was given.
  const [sort, setSort] = useState(null)

  const sorted = useMemo(() => {
    const all = rows ?? []
    if (!sort) return all
    const copy = [...all]
    copy.sort((a, b) => {
      // The unattributed bucket is not a company and cannot out-rank or be
      // out-ranked by one. It stays last whichever column is chosen, exactly
      // as the server's own ranking keeps it.
      const anon = (a.contractor_id == null) - (b.contractor_id == null)
      if (anon !== 0) return anon
      const av = sort.key === 'assigned' ? assignmentOf(a) : a[sort.key]
      const bv = sort.key === 'assigned' ? assignmentOf(b) : b[sort.key]
      const cmp =
        typeof av === 'string' ? av.localeCompare(bv, 'fa') : (av ?? 0) - (bv ?? 0)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [rows, sort])

  if (!rows || rows.length === 0) {
    return <div className="dt-empty">No contractor work to show.</div>
  }

  const scope = provinceId == null ? {} : { provinceId }
  /** The id a row's links carry: the company, or the unattributed bucket. */
  const idFor = (row) => (row.contractor_id == null ? UNATTRIBUTED : row.contractor_id)
  const scale = bookScale(rows.map(assignmentOf))

  const toggleSort = (key) =>
    setSort((s) =>
      s && s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )

  return (
    <>
      <div className="dt-key" aria-hidden="true">
        <span className="dt-key-item">
          <i style={{ background: STATE_COLOR.done }} />
          DT done
        </span>
        <span className="dt-key-item">
          <i style={{ background: STATE_COLOR.ongoing }} />
          Ongoing
        </span>
        <span className="dt-key-note">bar length is the size of the assignment</span>
      </div>

      <div className="table-wrap scroll-x">
        <table className="dt-scorecard">
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{ textAlign: col.align }}
                  aria-sort={
                    sort?.key === col.key
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
                    {sort?.key === col.key &&
                      (sort.dir === 'asc' ? (
                        <ChevronUp size={12} aria-hidden="true" />
                      ) : (
                        <ChevronDown size={12} aria-hidden="true" />
                      ))}
                  </button>
                </th>
              ))}
              <th scope="col" className="dt-col-book">Where the work is</th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row, i) => {
              const unattributed = row.contractor_id == null
              const cscope = { ...scope, contractorId: idFor(row) }
              return (
                <motion.tr
                  key={row.contractor_id ?? 'unattributed'}
                  className={unattributed ? 'dt-unattributed' : undefined}
                  initial={reduced ? false : { opacity: 0 }}
                  animate={{ opacity: 1 }}
                  transition={{ delay: Math.min(i * 0.03, 0.2), duration: 0.25 }}
                >
                  <td className="dt-farsi" style={{ fontWeight: unattributed ? 400 : 500 }}>
                    {row.name}
                  </td>
                  <td className="tnum" style={{ textAlign: 'right', fontWeight: 600 }}>
                    {/* The denominator the rate divides by, so it is the one
                        figure on this row a contractor will want to check. */}
                    <Link to={assignedLink(cscope)} className="dt-cell-link">
                      {count(assignmentOf(row))}
                    </Link>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <Link to={doneLink(cscope)} className="dt-cell-link">
                      {count(row.done)}
                    </Link>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <Link to={ongoingLink(cscope)} className="dt-cell-link">
                      {count(row.ongoing)}
                    </Link>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    {row.problematic > 0 ? (
                      <Link
                        to={problematicLink(cscope)}
                        className="dt-cell-link dt-cell-link-bad"
                      >
                        {count(row.problematic)}
                      </Link>
                    ) : (
                      count(row.problematic)
                    )}
                  </td>
                  <td className="tnum dim" style={{ textAlign: 'right' }}>
                    <Link to={notStartedLink(cscope)} className="dt-cell-link">
                      {count(row.not_started ?? 0)}
                    </Link>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span
                      className="dt-rate"
                      style={{
                        color: unattributed ? 'var(--text-dim)' : progressColor(row.done_percent),
                      }}
                    >
                      {percent(row.done_percent)}
                    </span>
                  </td>
                  <td className="dt-col-book">
                    <BookBar
                      label={row.name}
                      total={assignmentOf(row)}
                      scaleMax={scale}
                      index={i}
                      segments={[
                        {
                          key: 'done',
                          label: 'DT done',
                          value: row.done,
                          color: unattributed ? 'var(--text-dim)' : STATE_COLOR.done,
                        },
                        {
                          key: 'ongoing',
                          label: 'Ongoing',
                          value: row.ongoing,
                          color: unattributed ? 'var(--border)' : STATE_COLOR.ongoing,
                        },
                      ]}
                    />
                  </td>
                </motion.tr>
              )
            })}
          </tbody>
        </table>
      </div>
    </>
  )
}
