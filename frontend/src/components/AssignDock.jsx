import { Check } from 'lucide-react'
import { useEffect, useMemo, useRef, useState } from 'react'
import api from '../api/client'
import { dtLoadByContractor, hcLoadByContractor } from '../lib/contractorLoad'
import { PageDock } from './PageFrame'

/** Where each kind of assignment reads the contractors' open work from, and
 * how a tile says it. */
const KINDS = {
  hc: {
    url: '/hc/queues/in-progress',
    toLoad: hcLoadByContractor,
    words: ({ open, late }) => `${open} open · ${late} late`,
  },
  dt: {
    url: '/hc/queues/dt-in-progress',
    toLoad: dtLoadByContractor,
    words: ({ open }) => `${open} in progress`,
  },
}

/** Each contractor's open (and, for health checks, late) work, by id. A load
 * that cannot be read leaves the tiles without a meter rather than blocking
 * the assignment. */
function useContractorLoad(kind, reloadKey) {
  const [load, setLoad] = useState(() => new Map())
  useEffect(() => {
    let live = true
    const { url, toLoad } = KINDS[kind]
    api
      .get(url)
      .then((r) => live && setLoad(toLoad(r.data)))
      .catch(() => live && setLoad(new Map()))
    return () => {
      live = false
    }
  }, [kind, reloadKey])
  return load
}

/**
 * The assignment dock shared by HC Pool and DT Assignment: pinned to the
 * bottom of the main column (a PageDock), never inside the table and never
 * over it.
 *
 * Top row: how many sites are ticked, Clear, a hint, and the primary action,
 * which names the pick ("Assign health check to پیشرو فن"). Under it, every
 * contractor as a tile -- a radio group of real buttons, not a dropdown --
 * with the open work each already holds, so the choice is made against the
 * load. Arrow keys move the choice; the action is enabled only once there is
 * both a site and a contractor.
 */
export default function AssignDock({
  kind,
  selectedCount,
  onClear,
  contractors,
  contractorId,
  onSelectContractor,
  onAssign,
  busy,
  actionLabel,
  hint,
  reloadKey,
}) {
  const load = useContractorLoad(kind, reloadKey)
  const picked = contractors.find((c) => String(c.id) === String(contractorId))
  const ready = selectedCount > 0 && picked && !busy

  return (
    <PageDock>
      <section className="assign-dock" aria-label="Assign">
        <div className="assign-dock-top">
          <span className="assign-dock-count">
            <span className="assign-dock-badge tnum">{selectedCount}</span>{' '}
            site{selectedCount === 1 ? '' : 's'} selected
          </span>
          {selectedCount > 0 && (
            <button type="button" className="btn btn-ghost btn-sm" onClick={onClear}>
              Clear
            </button>
          )}
          <span className="assign-dock-hint">{hint}</span>
          <button type="button" className="btn btn-primary" disabled={!ready} onClick={onAssign}>
            {busy ? (
              'Assigning…'
            ) : picked ? (
              <>
                {actionLabel} to <span className="assign-dock-name">{picked.name}</span>
              </>
            ) : (
              actionLabel
            )}
          </button>
        </div>
        <ContractorTiles
          kind={kind}
          contractors={contractors}
          load={load}
          value={contractorId}
          onChange={onSelectContractor}
        />
      </section>
    </PageDock>
  )
}

/** The contractors as a radio group. One tab stop (the checked tile, or the
 * first); arrows move and select, as a radio group does. */
function ContractorTiles({ kind, contractors, load, value, onChange }) {
  const groupRef = useRef(null)
  const maxOpen = useMemo(
    () => Math.max(1, ...contractors.map((c) => load.get(c.id)?.open ?? 0)),
    [contractors, load],
  )

  if (contractors.length === 0) {
    return <p className="assign-dock-empty">No subcontractors available.</p>
  }

  const index = contractors.findIndex((c) => String(c.id) === String(value))
  const onKeyDown = (event) => {
    const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key]
    if (!step) return
    event.preventDefault()
    const n = contractors.length
    const next = index < 0 ? (step > 0 ? 0 : n - 1) : (index + step + n) % n
    onChange(String(contractors[next].id))
    groupRef.current?.querySelectorAll('[role="radio"]')[next]?.focus()
  }

  return (
    <div className="assign-tiles" role="radiogroup" aria-label="Contractor" ref={groupRef} onKeyDown={onKeyDown}>
      {contractors.map((c, i) => {
        const checked = i === index
        const l = load.get(c.id) ?? { open: 0, late: 0 }
        return (
          <button
            key={c.id}
            type="button"
            role="radio"
            aria-checked={checked}
            tabIndex={checked || (index < 0 && i === 0) ? 0 : -1}
            className="assign-tile"
            onClick={() => onChange(String(c.id))}
          >
            <span className="assign-tile-avatar" aria-hidden="true">{initial(c.name)}</span>
            <span className="assign-tile-body">
              <span className="assign-tile-name" dir="auto">{c.name}</span>
              <span className="assign-tile-meter" aria-hidden="true">
                <i className="assign-tile-open" style={{ width: `${(100 * l.open) / maxOpen}%` }} />
                {kind === 'hc' && l.late > 0 && (
                  <i className="assign-tile-late" style={{ width: `${(100 * l.late) / maxOpen}%` }} />
                )}
              </span>
              <span className="assign-tile-load tnum">{KINDS[kind].words(l)}</span>
            </span>
            {checked && (
              <span className="assign-tile-check" aria-hidden="true">
                <Check size={14} strokeWidth={3} />
              </span>
            )}
          </button>
        )
      })}
    </div>
  )
}

/** The first letter of a name, Farsi or Latin. */
function initial(name) {
  return (name || '?').trim().charAt(0).toUpperCase()
}
