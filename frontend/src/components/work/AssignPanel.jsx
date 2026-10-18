import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { orderContractors, suggestContractor } from '../../lib/suggestContractor'
import { ActionNotice, Fa } from './parts'
import { useWork } from './WorkContext'
import { formatNumber } from '../../lib/numbers'

const PROCESS = {
  hc: { url: '/hc/contractors/load' },
  dt: { url: '/drive-test/contractors/load' },
}

/** Each contractor's load for this process, reloaded after every action. A
 * load that cannot be read leaves the panel empty rather than blocking. */
function useContractorLoad(process, version) {
  const [rows, setRows] = useState(null)
  useEffect(() => {
    let live = true
    api
      .get(PROCESS[process].url)
      .then((r) => live && setRows(r.data))
      .catch(() => live && setRows([]))
    return () => {
      live = false
    }
  }, [process, version])
  return rows
}

const plural = (n, one) => `${formatNumber(n)} ${n === 1 ? one : `${one}s`}`

/**
 * The assign bar docked under the list (UEP-14 §3.3).
 *
 * Left: the selection and Clear. Middle: the contractors as a single-select
 * radio group -- name, open load and a bar, overdue, average hours per day.
 * For a re-check the previous contractor is pre-selected; otherwise the one
 * covering the selection's provinces with the most remaining capacity is
 * suggested. The suggested card comes first. Right: the one button that
 * assigns, disabled until both sites and a contractor are chosen. Clicking a
 * card never assigns.
 *
 * @param {{ process: 'hc'|'dt', selectedCount: number, villageCount: number,
 *   selectedProvinces: string[], previousContractorId?: number | null,
 *   onClear: () => void, onAssign: (c: object) => Promise<void>, busy: boolean, readOnly?: boolean }} props
 */
export default function AssignPanel({
  process, selectedCount, villageCount, selectedProvinces, previousContractorId, onClear, onAssign, busy, readOnly,
}) {
  const { version, notice } = useWork()
  const load = useContractorLoad(process, version)
  const [picked, setPicked] = useState(null)
  const active = selectedCount > 0

  const previous = useMemo(
    () => (previousContractorId && load ? load.find((c) => c.contractor_id === previousContractorId) || null : null),
    [previousContractorId, load],
  )
  const suggested = useMemo(
    () => (active && load ? previous || suggestContractor(load, selectedProvinces) : null),
    [active, load, previous, selectedProvinces],
  )
  const cards = useMemo(() => orderContractors(load || [], suggested), [load, suggested])
  const maxOpen = Math.max(1, ...cards.map((c) => c.open))

  // A new selection pre-selects the suggestion; clearing it clears the pick.
  useEffect(() => {
    setPicked(active ? suggested?.contractor_id ?? null : null)
  }, [active, suggested])

  const chosen = cards.find((c) => c.contractor_id === picked) || null
  const ready = active && chosen && !busy && !readOnly

  const onKeyDown = (event) => {
    const index = cards.findIndex((c) => c.contractor_id === picked)
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step || !cards.length) return
    event.preventDefault()
    const next = cards[(index + step + cards.length) % cards.length]
    setPicked(next.contractor_id)
    document.getElementById(`assign-card-${next.contractor_id}`)?.focus()
  }

  return (
    <div className={`uw-assign ${active ? 'is-active' : ''}`.trim()}>
      <div className="uw-assign-lead">
        {active ? (
          <>
            <b>{plural(selectedCount, 'site')} selected</b>
            <button type="button" className="uw-link" onClick={onClear}>Clear selection</button>
          </>
        ) : notice ? (
          <ActionNotice />
        ) : (
          <>
            <b>Contractors</b>
            <span>Select sites, pick a contractor, then Assign.</span>
          </>
        )}
      </div>
      <div
        className="uw-assign-cards"
        role="radiogroup"
        aria-label="Contractor"
        style={{ '--n': Math.max(1, cards.length) }}
        onKeyDown={onKeyDown}
      >
        {load === null
          ? [0, 1, 2, 3].map((i) => <span key={i} className="uw-assign-card is-skel" aria-hidden="true" />)
          : cards.map((c, i) => {
              const isSuggested = suggested?.contractor_id === c.contractor_id
              const isPicked = picked === c.contractor_id
              const tag = isSuggested ? (previous ? 'Previous contractor' : 'Works here') : null
              const rate = c.avg_hours_per_day ?? (c.avg_submit_days ? 24 / c.avg_submit_days : null)
              return (
                <button
                  key={c.contractor_id}
                  id={`assign-card-${c.contractor_id}`}
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  tabIndex={isPicked || (picked == null && i === 0) ? 0 : -1}
                  className={`uw-assign-card ${isPicked ? 'is-picked' : ''} ${isSuggested ? 'is-suggested' : ''}`.trim()}
                  onClick={() => setPicked(c.contractor_id)}
                >
                  <span className="uw-assign-line">
                    <Fa className="uw-assign-name">{c.name}</Fa>
                    <span className="uw-assign-open">{formatNumber(c.open)}</span>
                  </span>
                  <span className="uw-assign-bar" aria-hidden="true">
                    <i style={{ width: `${(100 * c.open) / maxOpen}%` }} />
                  </span>
                  <span className="uw-assign-meta">
                    {tag && <b className="uw-suggested">{tag}</b>}
                    {c.late > 0 && <b className="uw-late">{formatNumber(c.late)} overdue</b>}
                    {rate != null && <span>avg {Math.round(rate * 10) / 10} h/d</span>}
                  </span>
                </button>
              )
            })}
      </div>
      <div className="uw-assign-go">
        <button
          type="button"
          className="uw-btn uw-btn-primary"
          disabled={!ready}
          aria-busy={busy || undefined}
          onClick={() => ready && onAssign(chosen)}
        >
          Assign {plural(selectedCount, 'site')} · {plural(villageCount, 'village')}
        </button>
      </div>
    </div>
  )
}
