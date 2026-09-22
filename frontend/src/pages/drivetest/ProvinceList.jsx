import { motion, useReducedMotion } from 'framer-motion'
import { ChevronDown, ChevronUp } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PROVINCE_ROWS, STATE_COLOR } from './constants'
import { bookScale, count, percent } from './format'
import { doneLink, onairLink, ongoingLink, problematicLink, remainingLink } from './links'
import BookBar from './charts/BookBar'
import { DrillLink } from './DrillPanel'

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
 * FOUR SORTS, NOT SEVEN. One per question anybody actually asks of this
 * list: where is the work, who is behind, who is big, and where is a named
 * province. The other three — On air is Size, Ongoing and Problematic — were
 * offering to rank thirty-one provinces by figures that rank them in almost
 * the same order as the ones kept, which is a control that costs a decision
 * and returns nothing.
 *
 * THE RATE IS COLOURED AGAINST THE PROGRAMME, not against fixed bands. A
 * province at 88% is doing badly in a programme averaging 95% and well in
 * one averaging 60%, and the absolute thresholds `progressColor` uses said
 * the same thing about both. Red here means "below the average", the average
 * is stated in the key so the comparison is checkable, and the figure is
 * never only a colour.
 *
 * CARDS, NOT A TABLE -- and the file is named for that now, having spent a
 * while called ProvinceTable while drawing no table at all. A table row that
 * is also a filter control is an odd
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

/** The four sorts, each with the direction it should open in.
 *
 * "Remaining", not "Pending". The rest of the page says pending; this card
 * says remaining and keeps saying it, because here the word has a stated
 * arithmetic — On air minus DT done — that the footnote under the list
 * depends on, and because Remaining is deliberately *not* Ongoing plus
 * Problematic. Renaming it here alone would put two words on one figure;
 * renaming it everywhere is a page-wide vocabulary change and not this
 * card's to make.
 */
const SORTS = [
  { key: 'remaining', label: 'Remaining', dir: 'desc' },
  { key: 'done_percent', label: 'Done %', dir: 'desc' },
  { key: 'onair', label: 'Size', dir: 'desc' },
  { key: 'name', label: 'A–Z', dir: 'asc' },
]

export default function ProvinceList({ rows, provinces, onProvince }) {
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

  const visible = expanded ? sorted : sorted.slice(0, PROVINCE_ROWS)
  const scale = bookScale(rows.map((r) => r.onair))
  const hidden = sorted.length - visible.length

  /** The folded tail, as one row that makes the list sum again.
   *
   * Not decoration and not the same thing as "22 more not shown": that line
   * said how many rows were missing, this one says how many *sites* are, so
   * a reader adding the column up reaches the programme total instead of
   * falling short by whatever happened to sit below the fold. The breakdown
   * cards have carried exactly this row for the same reason.
   *
   * It carries no bar. A bar's length here is one province's on-air count
   * against the largest single province, and the tail of twenty is not a
   * province — drawn on that scale it would run off the end of the track and
   * read as the biggest thing on screen.
   */
  const remainder =
    hidden > 0
      ? sorted.slice(PROVINCE_ROWS).reduce(
          (acc, r) => ({
            provinces: acc.provinces + 1,
            onair: acc.onair + (r.onair ?? 0),
            done: acc.done + (r.done ?? 0),
            remaining: acc.remaining + (r.remaining ?? 0),
            ongoing: acc.ongoing + (r.ongoing ?? 0),
            problematic: acc.problematic + (r.problematic ?? 0),
          }),
          { provinces: 0, onair: 0, done: 0, remaining: 0, ongoing: 0, problematic: 0 },
        )
      : null

  /** The programme's own completion rate, which every province's rate is
   * coloured against. Computed from the rows on screen rather than taken
   * from the KPI band: the band is the whole programme and this list can be
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
        : { key, dir: SORTS.find((c) => c.key === key)?.dir ?? 'desc' },
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
        {/* The rule the red rate follows, stated where the rate is. A colour
            whose threshold is not on screen is a colour a reader has to
            guess the meaning of. */}
        <span className="dt-key-note">
          done % in red is below the {percent(average)} programme average
        </span>
      </div>

      <div className="dt-sort-controls" role="group" aria-label="Sort provinces by">
        {SORTS.map((col) => (
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
                <span className="dt-province-remaining tnum">
                  <Cell
                    id={id}
                    href={remainingLink}
                    value={row.remaining}
                    suffix="remaining"
                    onClick={stop} label={row.name}
                  />
                </span>
                <span
                  className="dt-province-rate tnum"
                  style={{ color: rateColor(row.done_percent) }}
                >
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

              {/* One quiet line, where there were two. Remaining and the
                  rate moved up to the name, and what is left is the split
                  the bar above already draws — kept because each figure is
                  a list somebody opens, not because the row needs to state
                  it twice. */}
              <div className="dt-province-chips dt-province-chips-muted">
                <Cell id={id} href={onairLink} value={row.onair} suffix="on air" onClick={stop} label={row.name} />
                <span className="dt-chip-sep" aria-hidden="true">·</span>
                <Cell id={id} href={doneLink} value={row.done} suffix="done" onClick={stop} label={row.name} />
                <span className="dt-chip-sep" aria-hidden="true">·</span>
                <Cell id={id} href={ongoingLink} value={row.ongoing} suffix="ongoing" onClick={stop} label={row.name} />
                {hasProblem && (
                  <>
                    <span className="dt-chip-sep" aria-hidden="true">·</span>
                    {id ? (
                      <DrillLink
                        to={problematicLink({ provinceId: id })}
                        className="dt-cell-link-bad"
                        drillLabel={row.name}
                        onClick={stop}
                      >
                        {count(row.problematic)} problem
                      </DrillLink>
                    ) : (
                      <span className="dt-cell-link-bad">{count(row.problematic)} problem</span>
                    )}
                  </>
                )}
              </div>
            </motion.div>
          )
        })}

        {remainder && (
          <div className="dt-province-card dt-province-card-rest" data-testid="dt-province-rest">
            <div className="dt-province-head">
              <span className="dt-province-name">
                {`${remainder.provinces} more provinces`}
              </span>
              <span className="dt-province-remaining tnum">
                {`${count(remainder.remaining)} remaining`}
              </span>
              <span
                className="dt-province-rate tnum"
                style={{ color: rateColor(pct(remainder.done, remainder.onair)) }}
              >
                {percent(pct(remainder.done, remainder.onair))}
              </span>
            </div>
            <div className="dt-province-chips dt-province-chips-muted">
              {`${count(remainder.onair)} on air · ${count(remainder.done)} done · ` +
                `${count(remainder.ongoing)} ongoing`}
              {remainder.problematic > 0 &&
                ` · ${count(remainder.problematic)} problem`}
            </div>
          </div>
        )}
      </div>

      <p className="dt-note">
        Remaining = On air − DT done. Ongoing + Problematic can be lower than
        Remaining, because on-air sites with no DT status yet are counted in
        Remaining only.
      </p>

      {sorted.length > PROVINCE_ROWS && (
        <div className="dt-expand">
          <button type="button" className="btn btn-sm btn-ghost" onClick={() => setExpanded((v) => !v)}>
            {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            {expanded ? `Show top ${PROVINCE_ROWS}` : `Show all ${sorted.length} provinces`}
          </button>
        </div>
      )}
    </>
  )
}

/** A completion rate from a part and a whole, or 0 where there is no whole. */
function pct(part, whole) {
  return whole ? (part / whole) * 100 : 0
}

/** One figure on a province card, as a link where the province is known.
 *
 * A province the payload names but the filter list does not know has no id
 * to build a link from — it stays plain text rather than becoming a link
 * that would open the whole programme and look like that province's list.
 */
function Cell({ id, href, value, suffix, onClick, label }) {
  const text = suffix ? `${count(value)} ${suffix}` : count(value)
  if (!id) return <span>{text}</span>
  return (
    <DrillLink
      to={href({ provinceId: id })}
      className="dt-cell-link"
      drillLabel={label}
      onClick={onClick}
    >
      {text}
    </DrillLink>
  )
}
