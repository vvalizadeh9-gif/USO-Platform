import { useMemo, useState } from 'react'
import { count, percent } from './format'
import { doneLink, onairLink, ongoingLink, problematicLink, remainingLink } from './links'
import { DrillLink } from './DrillPanel'

/**
 * Every province's full picture, sortable, worst first by default.
 *
 * This table replaces three views the old dashboard also had: ongoing by
 * province, problematic by province, and a second "progress per province"
 * table in the bottom corner. All three were strict subsets of these figures,
 * and a reader asking "how is Kerman doing" had four places to look and no
 * reason to prefer one.
 *
 * The default sort is remaining descending, which is where the outstanding
 * work is. Sorting is the reader's to change, through the column headers,
 * same as the contractor scorecard and SiteList.jsx.
 *
 * ALL 31 PROVINCES, IN ONE SCROLLING TABLE. There is no fold and no "Show
 * all" to click through any more: `.dt-table-scroll` caps the table's height
 * and scrolls internally instead, so the card does not grow unbounded and no
 * row is ever hidden behind a control.
 *
 * THE RATE IS COLOURED AGAINST THE PROGRAMME, not against fixed bands. A
 * province at 88% is doing badly in a programme averaging 95% and well in
 * one averaging 60%, and the absolute thresholds `progressColor` uses said
 * the same thing about both. Red here means "below the average", the average
 * is stated in the note under the table so the comparison is checkable, and
 * the figure is never only a colour.
 *
 * A TABLE ROW THAT IS ALSO A FILTER CONTROL is an odd thing for a table to
 * be -- a click anywhere on the row narrows the whole dashboard to it, which
 * a plain `<tr>` never signals it can do. The figures a reader actually
 * drills through from -- on air, DT done, remaining, ongoing, problematic --
 * sit in the row as their own links, which stop the click from bubbling to
 * the row's own.
 */

const COLUMNS = [
  { key: 'name', label: 'Province' },
  { key: 'onair', label: 'On air', numeric: true },
  { key: 'done', label: 'DT done', numeric: true },
  { key: 'remaining', label: 'Remaining', numeric: true },
  { key: 'ongoing', label: 'Ongoing', numeric: true },
  { key: 'problematic', label: 'Problematic', numeric: true },
  { key: 'done_percent', label: 'Done %', numeric: true },
]

export default function ProvinceList({ rows, provinces, onProvince }) {
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

  /** The programme's own completion rate, which every province's rate is
   * coloured against. Computed from the rows on screen rather than taken
   * from the KPI band: the band is the whole programme and this table can be
   * a province-scoped subset of it, and a row must be compared with the set
   * it is actually in. */
  const totalOnair = rows.reduce((sum, r) => sum + (r.onair ?? 0), 0)
  const totalDone = rows.reduce((sum, r) => sum + (r.done ?? 0), 0)
  const average = totalOnair ? (totalDone / totalOnair) * 100 : 0
  const rateColor = (value) =>
    value < average ? 'var(--dt-problem)' : 'var(--text)'

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )

  // A click on a figure's own link opens that figure's sites; it must never
  // also fire the row's whole-row scope handler underneath it.
  const stop = (e) => e.stopPropagation()

  return (
    <>
      <div className="table-wrap dt-table-scroll">
        <table>
          <thead>
            <tr>
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  style={{ textAlign: col.numeric ? 'right' : 'left' }}
                  aria-sort={
                    sort.key === col.key
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
              const id = byName.get(row.name)
              const hasProblem = row.problematic > 0
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
                  <td className="tnum" style={{ textAlign: 'right' }}>
                    <span className="dt-province-rate" style={{ color: rateColor(row.done_percent) }}>
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
        Remaining = On air − DT done. Ongoing + Problematic can be lower than
        Remaining, because on-air sites with no DT status yet are counted in
        Remaining only.
      </p>
      {/* The rule the red rate follows, stated where it can be checked -- a
          colour whose threshold is not on screen is one a reader has to
          guess the meaning of. */}
      <p className="dt-note">done % in red is below the {percent(average)} programme average.</p>
    </>
  )
}

/** One figure in a province row, as a link where the province is known.
 *
 * A province the payload names but the filter list does not know has no id
 * to build a link from — it stays plain text rather than becoming a link
 * that would open the whole programme and look like that province's list.
 */
function Cell({ id, href, value, onClick, label }) {
  const text = count(value)
  if (!id) return <span>{text}</span>
  return (
    <DrillLink to={href({ provinceId: id })} className="dt-cell-link" drillLabel={label} onClick={onClick}>
      {text}
    </DrillLink>
  )
}
