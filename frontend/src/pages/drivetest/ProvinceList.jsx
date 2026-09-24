import { ChevronRight, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { count, percent } from './format'
import { doneLink, onairLink, ongoingLink, problematicLink, remainingLink } from './links'
import { DrillLink } from './DrillPanel'

const COLUMNS = [
  { key: 'rank', label: '#', numeric: true },
  { key: 'name', label: 'Province' },
  { key: 'onair', label: 'On air', numeric: true },
  { key: 'done', label: 'DT Done', numeric: true },
  { key: 'remaining', label: 'Gap', numeric: true },
  { key: 'done_percent', label: 'DT completion', numeric: true },
  { key: 'ongoing', label: 'Ongoing', numeric: true },
  { key: 'problematic', label: 'Problematic', numeric: true },
  { key: 'action', label: '', numeric: false },
]

export default function ProvinceList({ rows, provinces, onProvince }) {
  const [sort, setSort] = useState({ key: 'remaining', dir: 'desc' })
  const [search, setSearch] = useState('')

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
      <div className="dt-province-search-wrap">
        <Search size={14} strokeWidth={2} aria-hidden="true" />
        <input
          type="text"
          className="dt-province-search"
          placeholder="Search province…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          aria-label="Search provinces"
        />
      </div>

      <div className="table-wrap dt-table-scroll">
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
            {sorted.map((row, idx) => {
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
                  <td className="dt-action-cell">
                    {id && (
                      <ChevronRight size={15} strokeWidth={2} className="dt-action-arrow" />
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      <p className="dt-note">
        Gap = On air − DT Done. Ongoing + Problematic can be lower than
        Gap, because on-air sites with no DT status yet are counted in
        Gap only.
      </p>
      <p className="dt-note">Completion rate in red is below the {percent(average)} programme average.</p>
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
