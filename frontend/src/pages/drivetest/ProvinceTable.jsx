import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { PROVINCE_LIMIT, STATE_COLOR } from './constants'
import { bookScale, count, percent, progressColor } from './format'
import { doneLink, onairLink, ongoingLink, problematicLink, remainingLink } from './links'
import BookBar from './charts/BookBar'

/**
 * Every province's full picture, sortable, worst first by default.
 *
 * This grid now replaces three views the old dashboard also had: ongoing by
 * province, problematic by province, and a second "progress per province"
 * table in the bottom corner. All three were strict subsets of these figures,
 * and a reader asking "how is Kerman doing" had four places to look and no
 * reason to prefer one.
 *
 * The default sort is remaining descending, which is where the outstanding
 * work is. Sorting is the reader's to change, through the controls above the
 * grid — the old table fixed the order on the grounds that re-sorting by
 * name would bury the answer, which is true of *that* sort and not of
 * sorting in general.
 *
 * CARDS, NOT A TABLE. A table row that is also a filter control is an odd
 * thing for a table to be — a click anywhere on the row narrows the whole
 * dashboard to it, which a `<tr>` never signals it can do. A card can: the
 * whole card is now that control, and the figures a reader actually drills
 * through from — on air, remaining, problematic — sit in it as their own
 * links, which stop the click from bubbling to the card's own.
 *
 * THE BAR. It used to be a same-width track filled to the completion rate,
 * which meant a province with 900 on-air sites and one with 14 drew bars of
 * identical length. The bar is sized to the province's on-air count and
 * split by state instead, so it carries where the work *is* as well as how
 * far along it is — the same encoding the contractor scorecard uses, so the
 * two read alike. See `charts/BookBar`.
 */

const COLUMNS = [
  { key: 'name', label: 'Province' },
  { key: 'onair', label: 'On air' },
  { key: 'done', label: 'DT done' },
  { key: 'remaining', label: 'Remaining' },
  { key: 'ongoing', label: 'Ongoing' },
  { key: 'problematic', label: 'Problematic' },
  { key: 'done_percent', label: 'Done %' },
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
  const scale = bookScale(rows.map((r) => r.onair))
  const hidden = sorted.length - visible.length

  const toggleSort = (key) =>
    setSort((s) =>
      s.key === key
        ? { key, dir: s.dir === 'asc' ? 'desc' : 'asc' }
        : { key, dir: key === 'name' ? 'asc' : 'desc' },
    )

  // A click on a figure's own link opens that figure's sites; it must never
  // also fire the card's whole-card scope handler underneath it.
  const stop = (e) => e.stopPropagation()

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
        <span className="dt-key-item">
          <i style={{ background: STATE_COLOR.problematic }} />
          Problematic
        </span>
        <span className="dt-key-note">bar length is the province&rsquo;s on-air count</span>
      </div>

      <div className="dt-sort-controls" role="group" aria-label="Sort provinces by">
        {COLUMNS.map((col) => (
          <button
            key={col.key}
            type="button"
            className="dt-sort-chip"
            aria-pressed={sort.key === col.key}
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
        ))}
      </div>

      <div className="dt-province-grid">
        {visible.map((row, i) => {
          const id = byName.get(row.name)
          const hasProblem = row.problematic > 0
          return (
            <motion.div
              key={row.name}
              className={`dt-province-card${hasProblem ? ' dt-province-card-problem' : ''}`}
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
              initial={reduced ? false : { opacity: 0 }}
              animate={{ opacity: 1 }}
              transition={{ delay: Math.min(i * 0.02, 0.2), duration: 0.25 }}
            >
              <div className="dt-province-head">
                <span className="dt-farsi dt-province-name">{row.name}</span>
                <span className="dt-province-rate tnum" style={{ color: progressColor(row.done_percent) }}>
                  {percent(row.done_percent)}
                </span>
              </div>

              <BookBar
                label={row.name}
                total={row.onair}
                scaleMax={scale}
                index={i}
                height={8}
                segments={[
                  { key: 'done', label: 'DT done', value: row.done, color: STATE_COLOR.done },
                  { key: 'ongoing', label: 'Ongoing', value: row.ongoing, color: STATE_COLOR.ongoing },
                  {
                    key: 'problematic',
                    label: 'Problematic',
                    value: row.problematic,
                    color: STATE_COLOR.problematic,
                  },
                ]}
              />

              <div className="dt-province-chips">
                <Cell id={id} href={onairLink} value={row.onair} suffix="on air" onClick={stop} />
                <span className="dt-chip-sep" aria-hidden="true">·</span>
                <Cell id={id} href={remainingLink} value={row.remaining} suffix="remaining" onClick={stop} />
                {hasProblem && (
                  <>
                    <span className="dt-chip-sep" aria-hidden="true">·</span>
                    {id ? (
                      <Link
                        to={problematicLink({ provinceId: id })}
                        className="dt-cell-link-bad"
                        onClick={stop}
                      >
                        {count(row.problematic)} problem
                      </Link>
                    ) : (
                      <span className="dt-cell-link-bad">{count(row.problematic)} problem</span>
                    )}
                  </>
                )}
              </div>

              {/* Done and Ongoing keep their own drill-through too, folded
                  into a second, quieter chip line rather than given their
                  own column — the bar above already carries their split. */}
              <div className="dt-province-chips dt-province-chips-muted">
                <Cell id={id} href={doneLink} value={row.done} suffix="done" onClick={stop} />
                <span className="dt-chip-sep" aria-hidden="true">·</span>
                <Cell id={id} href={ongoingLink} value={row.ongoing} suffix="ongoing" onClick={stop} />
              </div>
            </motion.div>
          )
        })}
      </div>

      <p className="dt-note">
        Remaining = On air − DT done. Ongoing + Problematic can be lower than
        Remaining, because on-air sites with no DT status yet are counted in
        Remaining only.
      </p>

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

/** One figure on a province card, as a link where the province is known.
 *
 * A province the payload names but the filter list does not know has no id
 * to build a link from — it stays plain text rather than becoming a link
 * that would open the whole programme and look like that province's list.
 */
function Cell({ id, href, value, suffix, onClick }) {
  const text = suffix ? `${count(value)} ${suffix}` : count(value)
  if (!id) return <span>{text}</span>
  return (
    <Link to={href({ provinceId: id })} className="dt-cell-link" onClick={onClick}>
      {text}
    </Link>
  )
}
