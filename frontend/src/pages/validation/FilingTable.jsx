import { useEffect, useLayoutEffect, useRef, useState } from 'react'

const ROW_HEIGHT = 44
/** Above this many rows only the visible window is drawn (a letter can hold 500). */
const VIRTUAL_FROM = 60
const OVERSCAN = 8

/** "All 486 selected" / mixed: the header checkbox's state over every filing,
 * not only the rows drawn. */
// eslint-disable-next-line react-refresh/only-export-components -- shared with the page
export function allState(filings, selected) {
  const n = filings.filter((f) => selected.has(f.submission_id)).length
  return { checked: n > 0 && n === filings.length, mixed: n > 0 && n < filings.length, count: n }
}

function Checkbox({ checked, mixed = false, label, onChange }) {
  const ref = useRef(null)
  useEffect(() => { if (ref.current) ref.current.indeterminate = mixed }, [mixed])
  return (
    <input
      ref={ref}
      type="checkbox"
      className="vl-check"
      checked={checked}
      aria-checked={mixed ? 'mixed' : checked}
      aria-label={label}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
    />
  )
}

function useWindow(count) {
  const ref = useRef(null)
  const [range, setRange] = useState([0, count])
  const virtual = count > VIRTUAL_FROM
  useLayoutEffect(() => {
    const el = ref.current
    if (!virtual || !el) {
      setRange([0, count])
      return undefined
    }
    const update = () => {
      const first = Math.max(0, Math.floor(el.scrollTop / ROW_HEIGHT) - OVERSCAN)
      const shown = Math.ceil((el.clientHeight || ROW_HEIGHT * 20) / ROW_HEIGHT) + OVERSCAN * 2
      setRange([first, Math.min(count, first + shown)])
    }
    update()
    el.addEventListener('scroll', update, { passive: true })
    return () => el.removeEventListener('scroll', update)
  }, [count, virtual])
  return { ref, range, virtual }
}

/** "3G approved · 4G rejected" and an amber "2G not filed" per requested
 * technology that is missing. Green only for approved claims. */
function FiledResult({ claims, missing }) {
  return (
    <span className="vl-results">
      {claims.map((c) => (
        <span key={c.tech} className={`vl-claim is-${c.result}`} title={c.reason || undefined}>
          {c.tech} {c.result}
        </span>
      ))}
      {missing.map((t) => <span key={t} className="vl-chip is-amber">{t} not filed</span>)}
    </span>
  )
}

/**
 * One row per filing -- one village, one authority. Clicking a row ticks it;
 * the header box selects every filing in the group, drawn or not. Rejected or
 * incomplete rows come first (the server's order) with a red edge.
 */
export default function FilingTable({ authority, filings, selected, onToggle, onToggleAll, cursorId, column, onOpenLetter, label }) {
  const { ref, range, virtual } = useWindow(filings.length)
  const all = allState(filings, selected)
  const rows = filings.slice(range[0], range[1])
  const cursorIndex = filings.findIndex((f) => f.submission_id === cursorId)

  // Keep the cursor row in view when J / K move it.
  useEffect(() => {
    const el = ref.current
    if (!el || cursorIndex < 0) return
    const top = cursorIndex * ROW_HEIGHT
    const headed = top + 40
    if (headed < el.scrollTop + 40) el.scrollTop = top
    else if (headed + ROW_HEIGHT > el.scrollTop + el.clientHeight) el.scrollTop = headed + ROW_HEIGHT - el.clientHeight
  }, [cursorIndex, ref])

  return (
    <div className="vl-table-wrap" ref={ref}>
      <table className="vl-table" aria-label={label} aria-rowcount={filings.length + 1}>
        <thead>
          <tr>
            <th className="vl-col-check">
              <Checkbox
                checked={all.checked}
                mixed={all.mixed}
                label={`Select all ${filings.length} ${authority} filings`}
                onChange={() => onToggleAll(!all.checked)}
              />
            </th>
            <th>Village</th>
            <th>{column === 'letter' ? 'Letter' : 'Site'}</th>
            <th>Requested</th>
            <th>Filed result</th>
          </tr>
        </thead>
        <tbody>
          {virtual && range[0] > 0 && <tr aria-hidden="true" style={{ height: range[0] * ROW_HEIGHT }} />}
          {rows.map((f) => {
            const ticked = selected.has(f.submission_id)
            const attention = f.has_rejection || f.missing_techs.length > 0
            return (
              <tr
                key={f.submission_id}
                className={[
                  'vl-tr', ticked && 'is-selected', attention && 'is-attention',
                  f.submission_id === cursorId && 'is-cursor',
                ].filter(Boolean).join(' ')}
                aria-selected={ticked}
                data-submission={f.submission_id}
                onClick={() => onToggle(f.submission_id)}
              >
                <td className="vl-col-check">
                  <Checkbox
                    checked={ticked}
                    label={`Select ${f.village_code}`}
                    onChange={() => onToggle(f.submission_id)}
                  />
                </td>
                <td className="vl-village">
                  <b dir="ltr">{f.village_code}</b>
                  <bdi dir="rtl" lang="fa" className="vl-fa">{f.village_name}</bdi>
                </td>
                <td>
                  {column === 'letter' ? (
                    <button
                      type="button"
                      className="vl-link"
                      dir="ltr"
                      onClick={(e) => { e.stopPropagation(); onOpenLetter(f.letter_number, f.authority) }}
                    >
                      {f.letter_number}
                    </button>
                  ) : (
                    <span dir="ltr">{f.site_code}</span>
                  )}
                </td>
                <td>
                  <span className="vl-techs">
                    {f.requested_techs.map((t) => <span key={t} className="vl-tech">{t}</span>)}
                  </span>
                </td>
                <td><FiledResult claims={f.claims} missing={f.missing_techs} /></td>
              </tr>
            )
          })}
          {virtual && range[1] < filings.length && (
            <tr aria-hidden="true" style={{ height: (filings.length - range[1]) * ROW_HEIGHT }} />
          )}
        </tbody>
      </table>
    </div>
  )
}
