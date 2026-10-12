import { useEffect, useMemo, useState } from 'react'
import api from '../../api/client'
import { coveredProvinces, orderContractors, suggestContractor } from '../../lib/suggestContractor'
import { ActionNotice, Fa } from './parts'
import { useWork } from './WorkContext'

const PROCESS = {
  hc: { url: '/hc/contractors/load', holding: 'in check now', noun: 'in check' },
  dt: { url: '/drive-test/contractors/load', holding: 'with them', noun: 'with them' },
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

const plural = (n, one) => `${n} ${n === 1 ? one : `${one}s`}`

/**
 * The band at the foot of a site list (UEP-06 §4.2): one card per
 * contractor, lowest open load first. Selecting sites and clicking a card
 * assigns them -- one click. While sites are selected the contractor whose
 * recent work covers most of their provinces is suggested and moved first.
 *
 * After assigning, the band shows the confirmation with Undo until it is
 * dismissed or a new selection starts.
 *
 * @param {{ process: 'hc'|'dt', selectedCount: number, selectedProvinces: string[],
 *   onClear: () => void, onAssign: (c: object) => Promise<void>, busyId: number | null }} props
 */
export default function AssignPanel({ process, selectedCount, selectedProvinces, onClear, onAssign, busyId }) {
  const { version, notice } = useWork()
  const load = useContractorLoad(process, version)
  const words = PROCESS[process]
  const active = selectedCount > 0

  const suggested = useMemo(
    () => (active && load ? suggestContractor(load, selectedProvinces) : null),
    [active, load, selectedProvinces],
  )
  const cards = useMemo(() => orderContractors(load || [], suggested), [load, suggested])
  const maxOpen = Math.max(1, ...cards.map((c) => c.open))
  const where = suggested ? coveredProvinces(suggested, selectedProvinces) : []

  return (
    <div className={`uw-assign ${active ? 'is-active' : ''}`.trim()}>
      <div className="uw-assign-lead">
        {active ? (
          <>
            <b>Assign {plural(selectedCount, 'site')} to</b>
            <span>
              {suggested ? (
                <>Suggested: works in <Fa>{where.join('، ')}</Fa></>
              ) : (
                'Pick a contractor'
              )}
            </span>
            <button type="button" className="uw-link" onClick={onClear}>Clear selection</button>
          </>
        ) : notice ? (
          <ActionNotice />
        ) : (
          <>
            <b>Contractors</b>
            <span>Number: sites {words.holding}. Avg: days to submit.</span>
          </>
        )}
      </div>
      <div className="uw-assign-cards" style={{ '--n': Math.max(1, cards.length) }}>
        {load === null
          ? [0, 1, 2, 3].map((i) => <span key={i} className="uw-assign-card is-skel" aria-hidden="true" />)
          : cards.map((c) => {
              const isSuggested = suggested?.contractor_id === c.contractor_id
              const busy = busyId === c.contractor_id
              const facts = [
                `${c.open} ${words.noun}`,
                c.late > 0 ? `${c.late} late` : null,
                c.avg_submit_days != null ? `about ${Math.round(c.avg_submit_days)} days to submit` : null,
              ].filter(Boolean).join(', ')
              const name = active
                ? `Assign ${plural(selectedCount, 'site')} to ${c.name}. ${facts}.${isSuggested ? ` Suggested: works in ${where.join(', ')}` : ''}`
                : `${c.name}. ${facts}. Select sites to assign.`
              return (
                <button
                  key={c.contractor_id}
                  type="button"
                  className={`uw-assign-card ${isSuggested ? 'is-suggested' : ''}`.trim()}
                  aria-disabled={!active || busyId != null || undefined}
                  aria-busy={busy || undefined}
                  aria-label={name}
                  onClick={() => active && busyId == null && onAssign(c)}
                >
                  <span className="uw-assign-line">
                    <Fa className="uw-assign-name">{c.name}</Fa>
                    <span className="uw-assign-open">{c.open}</span>
                  </span>
                  <span className="uw-assign-bar" aria-hidden="true">
                    <i style={{ width: `${(100 * c.open) / maxOpen}%` }} />
                  </span>
                  <span className="uw-assign-meta" aria-hidden="true">
                    {isSuggested && <b className="uw-suggested">Suggested · </b>}
                    {c.late > 0 && <b className="uw-late">{c.late} late · </b>}
                    {c.avg_submit_days != null && <span>avg {Math.round(c.avg_submit_days)} d</span>}
                  </span>
                </button>
              )
            })}
      </div>
    </div>
  )
}
