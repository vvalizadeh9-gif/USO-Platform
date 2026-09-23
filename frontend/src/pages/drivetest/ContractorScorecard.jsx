import { useMemo, useState } from 'react'
import { UNATTRIBUTED } from './constants'
import { count, percent } from './format'
import { assignedLink, doneLink, ongoingLink } from './links'
import { DrillLink } from './DrillPanel'

/**
 * Each contractor's assignment, and how much of it is finished.
 *
 * WHAT "ASSIGNMENT" MEANS HERE, because it is the whole basis of the ranking:
 * the drive tests a company has completed, plus the sites it is still
 * holding. Nothing else. It is deliberately not every on-air site that
 * carries the company's name — a site sitting in a problem category, or one
 * sent out for a health check, has not been committed to them, and dividing
 * by it would mark a company down for work the programme never handed over.
 * Problematic and Not started sites are outside the assignment for the same
 * reason and are not shown as a figure here — see the note under the table.
 * The backend computes the assignment the same way — see
 * `_contractor_scorecard`.
 *
 * A SORTABLE TABLE, matching the pattern SiteList.jsx already uses
 * (`.table-wrap`, `.dt-sort-btn`, `aria-sort`): a rank column, then
 * Contractor, Assignment, DT done, Ongoing and Achievement as one pill.
 *
 * The unattributed row sits last and is styled apart, in dimmed italic text.
 * It is not a company and cannot be beaten or beat anyone; the backend sorts
 * it out of the ranking for the same reason, and re-sorting here keeps it
 * there whichever column is chosen. Its links still open its sites, through
 * `contractor_id=none`: "nobody holds these" is a real list, and the one
 * most worth reading.
 *
 * TWO COLUMNS ARE MISSING AND ARE NOT AN OVERSIGHT: how many of a
 * contractor's ongoing sites have been held over a month, and the median age
 * of those they hold. Both are the question this table raises and cannot
 * answer -- a company 73% through its book looks the same here whether the
 * remainder is a week old or a year old. Neither is on
 * `ContractorScorecardRow`, and neither can be derived from what is: the
 * payload carries counts per contractor and ages per programme, never ages
 * per contractor. Adding them is a backend change (see the commit that
 * added this note for what it would take) and deliberately not made here.
 *
 * SORTING IS THE READER'S. The rows arrive ranked by completion, which is the
 * right default and the wrong thing to be stuck with: "who is holding the
 * most" and "who has the most problems" are the next two questions anybody
 * asks of this table, and both are a column already on screen.
 */

const COLUMNS = [
  { key: 'name', label: 'Contractor' },
  { key: 'assigned', label: 'Assignment', numeric: true },
  { key: 'done', label: 'DT done', numeric: true },
  { key: 'ongoing', label: 'Ongoing', numeric: true },
  // "Completion", not "Achievement". Achievement is taken, forty pixels up
  // the page, by the Plan and delivery card -- where it means delivered
  // against PIP, a different numerator over a different denominator across a
  // different period. Two figures on one screen under one word, meaning two
  // things, is a reader comparing Alfa's 37.5% there with its 73% here and
  // concluding something about neither. This one is how far a company is
  // through its own book, which is what `done_percent` is documented as.
  { key: 'done_percent', label: 'Completion', numeric: true },
]

/** A contractor's assignment: drive tests finished plus sites still held.
 *
 * Derived here rather than read straight off the row. It is the definition --
 * the backend computes the very same sum -- so there is nothing to disagree
 * with, and a payload that arrives without the field renders the figure
 * instead of a dash. A dash in this figure is the worst possible failure for
 * this table: it is the denominator every rate on the row divides by, so a
 * reader who cannot see it cannot check any of the others.
 */
function assignmentOf(row) {
  if (row.assigned != null) return row.assigned
  return (row.done ?? 0) + (row.ongoing ?? 0)
}

/** Which band a completion rate falls in, for the pill's colour. Same
 * thresholds `format.progressColor` uses elsewhere on this page. */
function completionBand(value) {
  if (value >= 70) return 'good'
  if (value >= 30) return 'mid'
  return 'bad'
}

export default function ContractorScorecard({ rows, provinceId }) {
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

  const toggleSort = (key) =>
    setSort((s) =>
      s && s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )

  // Rank is position among the companies actually being ranked -- the
  // unattributed row, wherever it lands, never counts as #1 or bumps anyone
  // else's number down.
  let rank = 0

  return (
    <>
      <div className="table-wrap">
        <table>
          <thead>
            <tr>
              <th scope="col" className="dt-col-rank">
                <span className="dt-sr-only">Rank</span>
              </th>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{ textAlign: col.numeric ? 'right' : 'left' }}
                  aria-sort={
                    sort?.key === col.key
                      ? sort.dir === 'asc' ? 'ascending' : 'descending'
                      : 'none'
                  }
                >
                  <button type="button" className="dt-sort-btn" onClick={() => toggleSort(col.key)}>
                    {col.label}
                  </button>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const unattributed = row.contractor_id == null
              if (!unattributed) rank += 1
              const cscope = { ...scope, contractorId: idFor(row) }
              return (
                <tr
                  key={row.contractor_id ?? 'unattributed'}
                  className={`dt-contractor-row${unattributed ? ' dt-row-unattributed' : ''}`}
                >
                  <td className="dt-col-rank">
                    {unattributed ? (
                      <span className="dt-rank-badge dt-rank-badge-empty" aria-hidden="true" />
                    ) : (
                      <span className={`dt-rank-badge${rank === 1 ? ' dt-rank-badge-1' : ''}`}>
                        {rank}
                      </span>
                    )}
                  </td>
                  <td className="dt-farsi">
                    <DrillLink
                      to={assignedLink(cscope)}
                      drillLabel={row.name}
                      className="dt-contractor-name"
                    >
                      {row.name}
                    </DrillLink>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <DrillLink to={assignedLink(cscope)} drillLabel={row.name} className="dt-cell-link">
                      {count(assignmentOf(row))}
                    </DrillLink>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <DrillLink to={doneLink(cscope)} drillLabel={row.name} className="dt-cell-link">
                      {count(row.done)}
                    </DrillLink>
                  </td>
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <DrillLink to={ongoingLink(cscope)} drillLabel={row.name} className="dt-cell-link">
                      {count(row.ongoing)}
                    </DrillLink>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    <span
                      className={`dt-pill dt-pill-${unattributed ? 'dim' : completionBand(row.done_percent)}`}
                    >
                      {percent(row.done_percent)}
                    </span>
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      <p className="dt-note">
        Assignment = DT done + Ongoing. Problematic sites are not part of a
        contractor&rsquo;s assignment.
      </p>
    </>
  )
}
