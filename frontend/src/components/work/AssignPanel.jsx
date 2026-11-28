import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import api from '../../api/client'
import Icon from '../Icon'
import { useAuth } from '../../context/AuthContext'
import { useToast } from '../../context/ToastContext'
import { FEATURE, can } from '../../lib/access'
import { suggestContractor } from '../../lib/suggestContractor'
import { formatNumber } from '../../lib/numbers'
import { Fa } from './parts'
import { useWork } from './WorkContext'

const PROCESS = {
  hc: { url: '/hc/contractors/load' },
  dt: { url: '/drive-test/contractors/load' },
}

/** Each contractor's load for this process, reloaded after every action. A
 * load that cannot be read leaves the column empty rather than blocking. */
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
 * The Contractors column beside the Assign list (UEP-31 §2.2).
 *
 * One button per contractor shown in Drive test, A to Z: the name and one
 * number, their basket (sites with them now). A single-select radio group.
 * For a re-check the previous contractor is pre-selected; otherwise the one
 * covering the selection's provinces with the most remaining capacity. The
 * footer holds the selection and the one button that assigns; clicking a
 * contractor never assigns. After an assign the load reloads and the chosen
 * contractor's number bumps.
 *
 * @param {{ process: 'hc'|'dt', selectedCount: number, villageCount: number,
 *   selectedProvinces: string[], previousContractorId?: number | null,
 *   onClear: () => void, onAssign: (c: object) => Promise<void>, busy: boolean }} props
 */
export default function AssignPanel({
  process, selectedCount, villageCount, selectedProvinces, previousContractorId, onClear, onAssign, busy,
}) {
  const { version } = useWork()
  const { user } = useAuth()
  const toast = useToast()
  const load = useContractorLoad(process, version)
  const [picked, setPicked] = useState(null)
  const [bump, setBump] = useState(null)
  const sent = useRef(null)
  const active = selectedCount > 0

  const cards = useMemo(() => [...(load || [])].sort((a, b) => a.name.localeCompare(b.name)), [load])
  const previous = useMemo(
    () => (previousContractorId ? cards.find((c) => c.contractor_id === previousContractorId) || null : null),
    [previousContractorId, cards],
  )
  const suggested = useMemo(
    () => (active ? previous || suggestContractor(cards, selectedProvinces) : null),
    [active, cards, previous, selectedProvinces],
  )

  // A new selection pre-selects the suggestion; clearing it clears the pick.
  useEffect(() => {
    setPicked(active ? suggested?.contractor_id ?? null : null)
  }, [active, suggested])

  // The load that arrives after an assign bumps the chosen contractor's number.
  useEffect(() => {
    if (!load || sent.current == null) return
    setBump({ id: sent.current, key: Date.now() })
    sent.current = null
  }, [load])

  const chosen = cards.find((c) => c.contractor_id === picked) || null
  const ready = active && chosen && !busy

  const pick = (id) => {
    if (!active) {
      toast.info('Select sites first')
      return
    }
    setPicked(id)
  }

  const onKeyDown = (event) => {
    const step = { ArrowDown: 1, ArrowRight: 1, ArrowUp: -1, ArrowLeft: -1 }[event.key]
    if (!step || !cards.length) return
    event.preventDefault()
    const index = cards.findIndex((c) => c.contractor_id === picked)
    const next = cards[(index + step + cards.length) % cards.length]
    document.getElementById(`assign-card-${next.contractor_id}`)?.focus()
    if (active) setPicked(next.contractor_id)
  }

  const assign = () => {
    if (!ready) return
    sent.current = chosen.contractor_id
    onAssign(chosen)
  }

  return (
    <aside className="uw-contractors" aria-label="Contractors">
      <header className="uw-contractors-head">
        <h2>Contractors</h2>
        {can(user, FEATURE.CONTRACTORS) && <Link className="uw-contractors-manage" to="/admin/contractors">Manage</Link>}
      </header>
      <div className="uw-contractors-list" role="radiogroup" aria-label="Contractor" onKeyDown={onKeyDown}>
        {load === null
          ? [0, 1, 2, 3].map((i) => <span key={i} className="uw-contractor is-skel" aria-hidden="true" />)
          : cards.map((c, i) => {
              const isPicked = picked === c.contractor_id
              return (
                <button
                  key={c.contractor_id}
                  id={`assign-card-${c.contractor_id}`}
                  type="button"
                  role="radio"
                  aria-checked={isPicked}
                  aria-label={`${c.name}, ${plural(c.open, 'site')} in basket`}
                  tabIndex={isPicked || (picked == null && i === 0) ? 0 : -1}
                  className="uw-contractor"
                  onClick={() => pick(c.contractor_id)}
                >
                  {isPicked && (
                    <span className="uw-contractor-check" aria-hidden="true"><Icon name="checkmark" size={14} /></span>
                  )}
                  <Fa className="uw-contractor-name">{c.name}</Fa>
                  <span
                    key={bump?.id === c.contractor_id ? bump.key : undefined}
                    className={`uw-contractor-open ${bump?.id === c.contractor_id ? 'is-bump' : ''}`.trim()}
                  >
                    {formatNumber(c.open)}
                  </span>
                </button>
              )
            })}
      </div>
      <footer className="uw-contractors-foot">
        <span className="uw-contractors-sel">
          {active ? (
            <>
              <b>{plural(selectedCount, 'site')}</b> · {plural(villageCount, 'village')}
              <button type="button" className="uw-link" onClick={onClear}>Clear</button>
            </>
          ) : (
            'No sites selected'
          )}
        </span>
        <button
          type="button"
          className="uw-btn uw-btn-primary uw-btn-lg"
          disabled={!ready}
          aria-busy={busy || undefined}
          onClick={assign}
        >
          {active && chosen ? <>Assign to <Fa>{chosen.name}</Fa></> : 'Assign'}
        </button>
      </footer>
    </aside>
  )
}
