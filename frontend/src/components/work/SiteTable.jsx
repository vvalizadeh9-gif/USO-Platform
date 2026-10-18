import { useRef } from 'react'
import { SkeletonRows } from './parts'

/**
 * The selectable site list (UEP-06 §4.1).
 *
 * `table-layout: fixed` with a colgroup, so the table fills its card at every
 * width with no empty right side and no horizontal scroll. Clicking anywhere
 * on a row (except its buttons and links) toggles it, as does its checkbox;
 * Shift-click selects the range from the last row clicked. The header
 * checkbox selects every site in the current filter.
 *
 * A list nobody selects from can pass `onOpen` instead: a click on the row
 * then opens it. The row's own link stays the keyboard way in.
 *
 * @param {{
 *   rows: object[], rowId: (row: object) => number,
 *   columns: { key: string, label: React.ReactNode, width?: string, className?: string, render: (row: object) => React.ReactNode }[],
 *   selected?: Set<number>, onSelect?: (ids: number[], on: boolean) => void,
 *   label: string, siteLabel?: (row: object) => string, loading?: boolean, after?: React.ReactNode,
 *   filterIds?: number[], onOpen?: (row: object) => void,
 * }} props
 */
export default function SiteTable({ rows, rowId, columns, selected, onSelect, label, siteLabel, loading, after, filterIds, onOpen, leaving }) {
  const lastIndex = useRef(null)
  // A change event does not carry the Shift key; the click before it does.
  const shift = useRef(false)
  const selectable = Boolean(onSelect)
  const ids = rows.map(rowId)
  // The header box covers the whole filtered set, drawn or not.
  const scope = filterIds || ids
  const allOn = scope.length > 0 && scope.every((id) => selected.has(id))
  const someOn = !allOn && scope.some((id) => selected?.has(id))

  const toggle = (index, shift) => {
    const id = ids[index]
    const on = !selected.has(id)
    if (shift && lastIndex.current != null) {
      const [a, b] = [lastIndex.current, index].sort((x, y) => x - y)
      onSelect(ids.slice(a, b + 1), selected.has(ids[lastIndex.current]))
    } else {
      onSelect([id], on)
    }
    lastIndex.current = index
  }

  const openable = !selectable && Boolean(onOpen)
  const onRowClick = (event, index) => {
    // A button or link inside the row does its own thing.
    if (event.target.closest('button, a, input, select, textarea, label')) return
    if (selectable) toggle(index, event.shiftKey)
    else onOpen(rows[index])
  }

  return (
    <table className="uw-table" aria-label={label}>
      <colgroup>
        {selectable && <col style={{ width: 'var(--uep-col-check)' }} />}
        {columns.map((c) => (
          <col key={c.key} style={c.width ? { width: c.width } : undefined} />
        ))}
      </colgroup>
      <thead>
        <tr>
          {selectable && (
            <th className="uw-col-check" scope="col">
              <span className="uw-check-hit">
                <input
                  type="checkbox"
                  aria-label="Select every site shown"
                  checked={allOn}
                  ref={(el) => el && (el.indeterminate = someOn)}
                  disabled={scope.length === 0}
                  onChange={() => onSelect(scope, !allOn)}
                />
              </span>
            </th>
          )}
          {columns.map((c) => (
            <th key={c.key} scope="col" className={c.className}>{c.label}</th>
          ))}
        </tr>
      </thead>
      {loading ? (
        <SkeletonRows columns={columns.length + (selectable ? 1 : 0)} />
      ) : (
        <tbody>
          {rows.map((row, index) => {
            const id = ids[index]
            const on = selectable && selected.has(id)
            return (
              <tr
                key={id}
                className={`${selectable || openable ? 'is-selectable' : ''} ${on ? 'is-selected' : ''} ${leaving?.has(id) ? 'is-leaving' : ''}`.trim() || undefined}
                style={index < 14 ? { '--row-i': index } : undefined}
                onClick={selectable || openable ? (e) => onRowClick(e, index) : undefined}
              >
                {selectable && (
                  <td className="uw-col-check">
                    <label className="uw-check-hit">
                      <input
                        type="checkbox"
                        checked={on}
                        aria-label={`Select ${siteLabel ? siteLabel(row) : 'site'}`}
                        onClick={(e) => (shift.current = e.shiftKey)}
                        onChange={() => toggle(index, shift.current)}
                      />
                    </label>
                  </td>
                )}
                {columns.map((c) => (
                  <td key={c.key} className={c.className}>{c.render(row)}</td>
                ))}
              </tr>
            )
          })}
          {after}
        </tbody>
      )}
    </table>
  )
}
