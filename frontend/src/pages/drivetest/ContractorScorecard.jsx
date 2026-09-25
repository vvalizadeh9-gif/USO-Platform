import { useMemo, useState } from 'react'
import { UNATTRIBUTED } from './constants'
import { achievement, count, percent } from './format'
import { assignedLink, deliveredLink, doneLink, ongoingLink } from './links'
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
 * Contractor, Assignment, DT done, Ongoing, Completion, and this month's PIP
 * plan and what was achieved against it.
 *
 * THE PIP COLUMNS ARE THE OLD "PLAN AND DELIVERY" CARD'S CONTRACTOR LIST, in
 * the table that already names every company. They are the same rows
 * (`ContractorAchievementRow`), joined here by contractor, so the card could
 * go without its figures going with it. That promise has one hole to close:
 * this table lists the companies with drive tests done or in hand, and the
 * plan lists the companies with a PIP, and those are not the same set -- a
 * company can hold an approved PIP and have nothing done or ongoing yet. In
 * the unnarrowed view such a company is appended, unranked, with its true
 * zeros and its real PIP, rather than dropped. Narrowed to a province it is
 * not: a programme-wide PIP beside a company with no work in that province is
 * noise, and the note under the table says the PIP columns are programme-wide.
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
  // "Completion", not "Achieved". Achieved, two columns over, is delivered
  // against this month's PIP -- a different numerator over a different
  // denominator across a different period. This one is how far a company is
  // through its own book, which is what `done_percent` is documented as. Two
  // figures in one row under one word, meaning two things, is a reader
  // comparing Alfa's 37.5% with its 73% and concluding something about
  // neither.
  { key: 'done_percent', label: 'Completion', numeric: true },
  // This month's commitment, and what was delivered against it: the old Plan
  // and delivery card's contractor list, as two columns of the row that
  // already names the company.
  { key: 'pip', label: 'PIP plan', numeric: true },
  { key: 'achieved', label: 'Achieved', numeric: true },
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

/** Which band a this-month achievement rate falls in. Same thresholds
 * `format.bandColor` uses for the bullet chart this figure comes from. */
function achievementBand(value) {
  if (value >= 100) return 'good'
  if (value >= 80) return 'mid'
  return 'bad'
}

export default function ContractorScorecard({ rows, plan, provinceId }) {
  const planRows = plan?.rows
  // `null` means "as the server ranked them" — by completion, with the
  // unattributed row already last. Re-sorting is something the reader turns
  // on, not a default this component imposes over the one it was given.
  const [sort, setSort] = useState(null)

  // This month's PIP, by contractor — the same rows the Plan and delivery
  // card reads, joined in here rather than fetched twice. The PIP is
  // programme-wide with no contractor for the unattributed row, so it is
  // never in this map and always reads as "no PIP" below.
  const planByContractor = useMemo(() => {
    const map = new Map()
    for (const row of planRows ?? []) map.set(row.contractor_id, row)
    return map
  }, [planRows])
  /** A contractor's approved PIP for the month, or null. A plan row whose
   * achievement is null has nothing approved behind it, and reads as no PIP,
   * exactly as the card these columns replace read it. */
  const approvedPlan = (row) => {
    const p = planByContractor.get(row.contractor_id)
    return p && p.achievement_percent != null ? p : null
  }

  // Companies holding a PIP with nothing done or ongoing -- see the note at
  // the top. Appended only in the unnarrowed view, after every ranked
  // company and before the unattributed bucket, with their true zeros.
  const withPlanOnly = useMemo(() => {
    const base = rows ?? []
    if (provinceId != null || !planRows?.length) return base
    const listed = new Set(base.map((r) => r.contractor_id))
    const extra = planRows
      .filter((p) => p.contractor_id != null && !listed.has(p.contractor_id))
      .map((p) => ({
        contractor_id: p.contractor_id,
        name: p.name,
        assigned: 0,
        done: 0,
        ongoing: 0,
        done_percent: null,
        planOnly: true,
      }))
    if (extra.length === 0) return base
    const anon = base.filter((r) => r.contractor_id == null)
    return [...base.filter((r) => r.contractor_id != null), ...extra, ...anon]
  }, [rows, planRows, provinceId])

  const sorted = useMemo(() => {
    const all = withPlanOnly
    if (!sort) return all
    const copy = [...all]
    copy.sort((a, b) => {
      // The unattributed bucket is not a company and cannot out-rank or be
      // out-ranked by one. It stays last whichever column is chosen, exactly
      // as the server's own ranking keeps it.
      const anon = (a.contractor_id == null) - (b.contractor_id == null)
      if (anon !== 0) return anon
      const value = (row) => {
        if (sort.key === 'assigned') return assignmentOf(row)
        if (sort.key === 'pip' || sort.key === 'achieved') {
          // No approved PIP sorts below every company that has one, in
          // either direction's natural reading of "nothing".
          const p = planByContractor.get(row.contractor_id)
          if (!p || p.achievement_percent == null) return -1
          return sort.key === 'pip' ? p.pip : p.achievement_percent
        }
        return row[sort.key]
      }
      const av = value(a)
      const bv = value(b)
      const cmp =
        typeof av === 'string' ? av.localeCompare(bv, 'fa') : (av ?? 0) - (bv ?? 0)
      return sort.dir === 'asc' ? cmp : -cmp
    })
    return copy
  }, [withPlanOnly, sort, planByContractor])

  if (withPlanOnly.length === 0) {
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
              <th scope="col" className="dt-th-action">
                <span className="dt-sr-only">Action</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {sorted.map((row) => {
              const unattributed = row.contractor_id == null
              // A company with a PIP and no book in scope has no completion to
              // be ranked by, so it takes no number and moves nobody else's.
              if (!unattributed && !row.planOnly) rank += 1
              const cscope = { ...scope, contractorId: idFor(row) }
              return (
                <tr
                  key={row.contractor_id ?? 'unattributed'}
                  className={`dt-contractor-row${unattributed ? ' dt-row-unattributed' : ''}`}
                >
                  <td className="dt-col-rank">
                    {unattributed || row.planOnly ? (
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
                      className={`dt-pill dt-pill-${
                        unattributed || row.done_percent == null
                          ? 'dim'
                          : completionBand(row.done_percent)
                      }`}
                    >
                      {percent(row.done_percent)}
                    </span>
                  </td>
                  <PipCells
                    plan={approvedPlan(row)}
                    delivered={planByContractor.get(row.contractor_id)?.actual}
                    href={
                      plan && !unattributed
                        ? deliveredLink({
                            year: plan.shamsi_year,
                            month: plan.shamsi_month,
                            contractorId: row.contractor_id,
                          })
                        : null
                    }
                    name={row.name}
                  />
                  <td className="dt-action-cell">
                    {unattributed && (
                      <DrillLink
                        to={ongoingLink({ contractorId: UNATTRIBUTED })}
                        drillLabel={row.name}
                        className="dt-cell-link"
                      >
                        Assign
                      </DrillLink>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>
      {/* Only the notes that depend on what is on screen stay here. The
          standing definition of Assignment is behind the card's info icon. */}
      {(provinceId != null || (plan && !planRows?.some((p) => p.achievement_percent != null))) && (
        <p className="dt-note dt-table-foot">
          {provinceId != null && (
            <span>
              PIP plan and Achieved cover every province: a PIP is committed per contractor
              for the whole programme.
            </span>
          )}
          {plan && !planRows?.some((p) => p.achievement_percent != null) && (
            <span>No PIP is approved this month, so PIP plan and Achieved are empty.</span>
          )}
        </p>
      )}
    </>
  )
}

/** This month's two PIP columns for one row.
 *
 * With an approved PIP: the plan, then what was delivered against it and the
 * rate, banded the way the bullet chart these replace banded it. Without one:
 * a dash for the plan, because nothing was committed -- and for Achieved, a
 * dash too unless the company delivered drive tests anyway, in which case the
 * count stands on its own with no rate, since there is nothing to score it
 * against. The count opens the drive tests behind it.
 */
function PipCells({ plan, delivered, href, name }) {
  const actual = plan ? plan.actual : delivered
  const figure =
    actual > 0 || plan ? (
      href ? (
        <DrillLink to={href} drillLabel={name} className="dt-cell-link">
          {count(actual ?? 0)}
        </DrillLink>
      ) : (
        count(actual ?? 0)
      )
    ) : null
  return (
    <>
      <td className="tnum" style={{ textAlign: 'right' }}>
        {plan ? count(plan.pip) : <span className="dt-pip-none">—</span>}
      </td>
      <td className="tnum dt-pip-achieved" style={{ textAlign: 'right' }}>
        {figure ?? <span className="dt-pip-none">—</span>}
        {plan && (
          <span className={`dt-pill dt-pill-${achievementBand(plan.achievement_percent)}`}>
            {achievement(plan.achievement_percent)}
          </span>
        )}
      </td>
    </>
  )
}
